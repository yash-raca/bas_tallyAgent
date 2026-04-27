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

    // ✨ UPDATED: Now accepts optional custom dates to support monthly looping
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

    public async sync(): Promise<void> {
        logger.logMessage("\n🚀 Starting Month-Wise Deep Outstandings Extraction...");
        const groupsToSync = ["Sundry Debtors", "Sundry Creditors"];
        const parser = new XMLParser({ ignoreAttributes: false, textNodeName: "_text" });

        const syncUrl = process.env.BACKEND_API_URL 
            ? `${process.env.BACKEND_API_URL}/tally/sync-export` 
            : "http://localhost:8000/api/tally/sync-export";

        const axiosConfig = {
            headers: { 'Authorization': `Bearer ${process.env.AGENT_API_KEY}`, 'Content-Type': 'application/json' },
            maxBodyLength: Infinity
        };

        // 1. Prepare Monthly Chunks for the selected period
        const startD = utility.Date.parse(tally.config.fromdate, 'yyyyMMdd') || new Date();
        const endD = utility.Date.parse(tally.config.todate, 'yyyyMMdd') || new Date();
        const monthsToSync: { from: string, to: string, name: string }[] = [];
        
        let curr = new Date(startD.getFullYear(), startD.getMonth(), 1);
        while (curr <= endD) {
            const y = curr.getFullYear();
            const m = curr.getMonth();
            const mStart = new Date(y, m, 1);
            const mEnd = new Date(y, m + 1, 0);
            
            // Constrain to user selection
            const actualStart = mStart < startD ? startD : mStart;
            const actualEnd = mEnd > endD ? endD : mEnd;

            const monthsList = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
            
            monthsToSync.push({
                from: `${actualStart.getFullYear()}${String(actualStart.getMonth() + 1).padStart(2, '0')}${String(actualStart.getDate()).padStart(2, '0')}`,
                to: `${actualEnd.getFullYear()}${String(actualEnd.getMonth() + 1).padStart(2, '0')}${String(actualEnd.getDate()).padStart(2, '0')}`,
                name: `${monthsList[m]} ${y}`
            });
            curr.setMonth(curr.getMonth() + 1);
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
            logger.logMessage(`🔍 Found ${ledgerArray.length} ledgers. Starting Monthly Drill-Down...`);

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

                    // B. ✨ SYNC VOUCHERS MONTH-BY-MONTH
                    for (const mChunk of monthsToSync) {
                        const vchXml = this.generateTallyXML("Ledger Vouchers", `<LEDGERNAME>${safeLedgerName}</LEDGERNAME>`, mChunk.from, mChunk.to);
                        const vchRaw = await this.postTallyXML(vchXml);
                        
                        await axios.post(syncUrl, {
                            companyName: tally.config.company,
                            tableName: 'tally_ledger_voucher_export',
                            payload: { 
                                ledgerName, 
                                month: mChunk.name, // Saved as "April 2025", "May 2025", etc.
                                reportData: parser.parse(vchRaw) 
                            }
                        }, axiosConfig);
                    }
                    logger.logMessage(`   ✅ Synced: ${ledgerName} (${monthsToSync.length} months)`);

                } catch (err: any) {
                    logger.logError(`   ❌ Failed: ${ledgerName}`, err.message);
                }
            }
        }
        logger.logMessage("✅ All Data Synced Month-Wise!");
    }
}

export const outstandingsExporter = new OutstandingsExporter();