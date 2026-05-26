import http from 'http';
import { XMLParser } from 'fast-xml-parser';
import axios from 'axios';
import { utility } from './utility';
import { logger } from './logger';
import { tally } from './tally';

class OutstandingsExporter {

    private async postTallyXML(msg: string): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            const req = http.request({
                hostname: tally.config.server,
                port: tally.config.port,
                path: '',
                method: 'POST',
                headers: {
                    'Content-Length': Buffer.byteLength(msg, 'utf16le'),
                    'Content-Type': 'text/xml;charset=utf-16'
                }
            }, (res) => {
                let data = '';
                res.setEncoding('utf16le')
                   .on('data', (chunk) => { data += chunk; })
                   .on('end', () => { resolve(data); })
                   .on('error', (err) => { reject(err); });
            });
            req.on('error', (err) => { reject(err); });
            req.write(msg, 'utf16le');
            req.end();
        });
    }

    // ✨ Accepts optional custom dates to support dynamic chunking
    private generateTallyXML(reportName: string, extraVars: string, customFrom?: string, customTo?: string): string {
        const fromStr = customFrom || tally.config.fromdate;
        const toStr = customTo || tally.config.todate;

        const fromD = utility.Date.parse(fromStr, 'yyyyMMdd') || new Date();
        const toD = utility.Date.parse(toStr, 'yyyyMMdd') || new Date();

        let dateFromStr = utility.Date.format(fromD, 'd-MMM-yyyy');
        let dateToStr = utility.Date.format(toD, 'd-MMM-yyyy');
        let companyTag = tally.config.company ? utility.String.escapeHTML(tally.config.company) : '##SVCurrentCompany';

        return `<?xml version="1.0" encoding="utf-8"?>
        <ENVELOPE>
          <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Data</TYPE><ID>${reportName}</ID></HEADER>
          <BODY>
            <DESC>
              <STATICVARIABLES>
                <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT> 
                <SVFROMDATE>${dateFromStr}</SVFROMDATE>
                <SVTODATE>${dateToStr}</SVTODATE>
                <SVCURRENTCOMPANY>${companyTag}</SVCURRENTCOMPANY>
                ${extraVars}
              </STATICVARIABLES>
            </DESC>
          </BODY>
        </ENVELOPE>`;
    }

    // ✨ ADDED 'interval' parameter to support Quarterly/Half-Yearly
    public async sync(interval: string = 'Monthly'): Promise<void> {
        logger.logMessage(`\n🚀 Starting ${interval} Deep Outstandings Extraction...`);
        const groupsToSync = ["Sundry Debtors", "Sundry Creditors"];
        const parser = new XMLParser({ ignoreAttributes: false, textNodeName: "_text" });

        const syncUrl = process.env.BACKEND_API_URL 
            ? `${process.env.BACKEND_API_URL}/tally/sync-export` 
            : "http://localhost:8000/api/tally/sync-export";

        const axiosConfig = {
            headers: { 'Authorization': `Bearer ${process.env.AGENT_API_KEY}`, 'Content-Type': 'application/json' },
            maxBodyLength: Infinity
        };

        // ✨ 1. Check interval to determine how many months to jump
        const safeInterval = interval.replace(/[^a-zA-Z]/g, '').toLowerCase();
        let monthStep = 1;
        if (safeInterval.includes('quarter') || safeInterval.includes('quater') || safeInterval.startsWith('q')) monthStep = 3;
        else if (safeInterval.includes('half') || safeInterval.startsWith('h')) monthStep = 6;
        else if (safeInterval.includes('year') || safeInterval === 'y') monthStep = 12;

        const startD = utility.Date.parse(tally.config.fromdate, 'yyyyMMdd') || new Date();
        const endD = utility.Date.parse(tally.config.todate, 'yyyyMMdd') || new Date();
        const monthsToSync: { from: string, to: string, name: string }[] = [];
        
        let curr = new Date(startD.getFullYear(), startD.getMonth(), 1);
        while (curr <= endD) {
            const y = curr.getFullYear();
            const m = curr.getMonth();
            const mStart = new Date(y, m, 1);
            
            // ✨ Jump forward by 3 or 6 months based on user preference!
            const mEnd = new Date(y, m + monthStep, 0); 
            
            const actualStart = mStart < startD ? startD : mStart;
            const actualEnd = mEnd > endD ? endD : mEnd;

            const monthsList = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
            
            // Chunk Name logic (e.g. "Apr 2025 to Jun 2025")
            let chunkName = `${monthsList[actualStart.getMonth()]} ${actualStart.getFullYear()}`;
            if (monthStep > 1) {
                chunkName += ` to ${monthsList[actualEnd.getMonth()]} ${actualEnd.getFullYear()}`;
            }

            monthsToSync.push({
                from: `${actualStart.getFullYear()}${String(actualStart.getMonth() + 1).padStart(2, '0')}${String(actualStart.getDate()).padStart(2, '0')}`,
                to: `${actualEnd.getFullYear()}${String(actualEnd.getMonth() + 1).padStart(2, '0')}${String(actualEnd.getDate()).padStart(2, '0')}`,
                name: chunkName
            });
            curr.setMonth(curr.getMonth() + monthStep); // ✨ Move to next chunk
        }

        for (const groupName of groupsToSync) {
            logger.logMessage(`\n📦 Fetching Group: ${groupName}...`);
            
            const level1Xml = this.generateTallyXML("Group Summary", `<GROUPNAME>${groupName}</GROUPNAME><EXPLODEFLAG>Yes</EXPLODEFLAG><EXPLODEALLLEVELS>Yes</EXPLODEALLLEVELS><ISITEMIZE>Yes</ISITEMIZE>`);
            const level1Raw = await this.postTallyXML(level1Xml); 

            let level1Data;
            try { level1Data = parser.parse(level1Raw); } catch (e) { continue; }

            await axios.post(syncUrl, {
                companyName: tally.config.company,
                tableName: 'tally_outstandings_export',
                payload: { groupName, reportData: level1Data }
            }, axiosConfig);

            const targetLedgers = new Set<string>();
            const scanForLedgers = (node: any) => {
                if (!node) return;
                if (node.DSPACCNAME && Array.isArray(node.DSPACCNAME)) {
                    node.DSPACCNAME.forEach((n: any) => {
                        const name = n.DSPDISPNAME || n.dspdispname || n["_text"] || "";
                        if (name && !name.toLowerCase().includes("grand total")) targetLedgers.add(name);
                    });
                }
                if (Array.isArray(node)) { node.forEach(scanForLedgers); return; }
                if (typeof node === 'object') {
                    const nameObj = node.DSPACCNAME || node.dspaccname;
                    if (nameObj && !Array.isArray(nameObj)) {
                        const name = nameObj.DSPDISPNAME || nameObj.dspdispname || nameObj["_text"] || (typeof nameObj === 'string' ? nameObj : "");
                        if (name && !name.toLowerCase().includes("grand total")) targetLedgers.add(name);
                    }
                    for (const key in node) scanForLedgers(node[key]);
                }
            };
            scanForLedgers(level1Data?.ENVELOPE || level1Data);

            const ledgerArray = Array.from(targetLedgers);
            logger.logMessage(`🔍 Found ${ledgerArray.length} ledgers. Starting Drill-Down...`);

            for (const ledgerName of ledgerArray) {
                try {
                    const safeLedgerName = utility.String.escapeHTML(ledgerName);

                    // A. Sync Monthly Summary (Full Period)
                    const summaryXml = this.generateTallyXML("Ledger Monthly Summary", `<LEDGERNAME>${safeLedgerName}</LEDGERNAME><EXPLODEFLAG>Yes</EXPLODEFLAG>`);
                    const summaryRaw = await this.postTallyXML(summaryXml);
                    await axios.post(syncUrl, {
                        companyName: tally.config.company,
                        tableName: 'tally_ledger_monthly_export',
                        payload: { ledgerName, reportData: parser.parse(summaryRaw) }
                    }, axiosConfig);

                    // B. SYNC VOUCHERS CHUNK-BY-CHUNK
                    for (const mChunk of monthsToSync) {
                        const vchXml = this.generateTallyXML("Ledger Vouchers", `<LEDGERNAME>${safeLedgerName}</LEDGERNAME>`, mChunk.from, mChunk.to);
                        const vchRaw = await this.postTallyXML(vchXml);
                        
                        await axios.post(syncUrl, {
                            companyName: tally.config.company,
                            tableName: 'tally_ledger_voucher_export',
                            payload: { 
                                ledgerName, 
                                month: mChunk.name, // Saved as "Apr 2025 to Jun 2025"
                                reportData: parser.parse(vchRaw) 
                            }
                        }, axiosConfig);
                    }
                    logger.logMessage(`   ✅ Synced: ${ledgerName} (${monthsToSync.length} chunks)`);

                } catch (err: any) {
                    logger.logError(`   ❌ Failed: ${ledgerName}`, err.message);
                }
            }
        }
        logger.logMessage("✅ All Data Synced Chunk-Wise!");
    }
}

export const outstandingsExporter = new OutstandingsExporter();