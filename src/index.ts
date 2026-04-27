import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { database } from './database'; 
import { tally } from './tally';
import { outstandingsExporter } from './outstandings';
import { XMLParser } from 'fast-xml-parser'; // Imported for the fast test

dotenv.config();
const app = express();

app.use(cors({ 
    origin: '*', 
    methods: ['POST', 'GET', 'OPTIONS'], 
    allowedHeaders: ['Content-Type', 'Authorization'] 
}));

app.use(express.json());

// Global state variables for frontend polling
let isSyncing = false;
let syncMessage = "Idle";

// ✨ HELPER: Formats Time Duration into minutes and seconds
const formatDuration = (ms: number) => {
    const seconds = Math.floor((ms / 1000) % 60);
    const minutes = Math.floor((ms / (1000 * 60)) % 60);
    return minutes > 0 ? `${minutes}m ${seconds}s` : `${(ms / 1000).toFixed(2)}s`;
};

// ✨ HELPER: Formats JS Date to Tally's YYYYMMDD
const formatTallyDate = (d: Date) => {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}${mm}${dd}`;
};

// ✨ HELPER: Parses Tally's YYYYMMDD to JS Date
const parseTallyDate = (dateStr: string) => {
    if (!dateStr || dateStr.length !== 8) return new Date();
    return new Date(
        parseInt(dateStr.substring(0, 4)), 
        parseInt(dateStr.substring(4, 6)) - 1, 
        parseInt(dateStr.substring(6, 8))
    );
};

// ✨ FIX: ADDED MISSING HELPER - Generates monthly chunks between two dates
const generateSyncPeriods = (start: Date, end: Date) => {
    const periods = [];
    let currentStart = new Date(start.getTime());

    while (currentStart <= end) {
        // Get the last day of the current month
        let currentEnd = new Date(currentStart.getFullYear(), currentStart.getMonth() + 1, 0);

        // If the calculated end of the month exceeds the overall end date, cap it
        if (currentEnd > end) {
            currentEnd = new Date(end.getTime());
        }

        periods.push({
            type: 'Monthly',
            from: new Date(currentStart.getTime()),
            to: new Date(currentEnd.getTime())
        });

        // Move to the first day of the next month
        currentStart = new Date(currentStart.getFullYear(), currentStart.getMonth() + 1, 1);
    }

    // Safety fallback
    if (periods.length === 0) {
        periods.push({ type: 'Range', from: start, to: end });
    }

    return periods;
};

// =========================================================
// MAIN SYNC ROUTE
// =========================================================
app.post('/full-sync', async (req: Request, res: Response): Promise<any> => {
    const authHeader = req.headers.authorization;
    const expectedToken = process.env.AGENT_API_KEY;

    if (!expectedToken) return res.status(500).json({ error: "Server Configuration Error: AGENT_API_KEY is missing in .env" });
    if (!authHeader || authHeader !== `Bearer ${expectedToken}`) return res.status(401).json({ error: "Unauthorized." });

    const { clientId, companyName, fromDate, toDate } = req.body;

    if (!companyName) return res.status(400).json({ error: "Missing companyName in request body." });
    if (isSyncing) return res.status(409).json({ error: "A sync is already in progress. Please wait." });

    res.status(202).json({ message: `Sync started for ${companyName}. Processing in background...`, clientId });

    isSyncing = true;
    syncMessage = "Initializing Connection...";

    const totalSyncStartTime = Date.now(); 

    try {
        console.log("\n=========================================");
        console.log(`🚀 STARTING SYNC FOR: ${companyName}`);
        console.log("=========================================\n");

        await database.openConnectionPool();
        database.setTargetCompany(companyName);

        // =========================================================
        // 🛑 COMMENTED OUT: PHASE 1 (Vouchers & Masters)
        // =========================================================
        
        const phase1StartTime = Date.now();
        const startD = fromDate !== 'auto' ? parseTallyDate(fromDate) : new Date(new Date().getFullYear(), 3, 1);
        const endD = toDate !== 'auto' ? parseTallyDate(toDate) : new Date();
        const masterFrom = formatTallyDate(startD);
        const masterTo = formatTallyDate(endD);

        syncMessage = `PHASE 1: Syncing Vouchers & Masters (${masterFrom} to ${masterTo})...`;
        console.log(`\n⏳ ${syncMessage}`);

        tally.config = {
            server: process.env.TALLY_SERVER || 'localhost',
            port: parseInt(process.env.TALLY_PORT || '9000'),
            company: companyName,
            fromdate: masterFrom,
            todate: masterTo,
            sync: 'vouchers,masters',
            definition: 'tally-export-config.yaml', 
            batchsize: 25000,
            frequency: 0
        };

        database.setSyncPeriod(masterFrom, masterTo);
        await tally.importData();
        
        const phase1Duration = Date.now() - phase1StartTime;
        console.log(`✅ PHASE 1 Complete in ${formatDuration(phase1Duration)}: All foundational data saved.`);
        
       console.log("⏭️ SKIPPING PHASE 1 (Commented out for fast testing)");

        // =========================================================
        // 🛑 COMMENTED OUT: PHASE 2 (Fast-Report Chunking)
        // =========================================================
        
        const phase2StartTime = Date.now();
        console.log(`\n=========================================`);
        console.log(`🚀 STARTING PHASE 2: FAST REPORT EXTRACTION`);
        console.log(`=========================================\n`);

        const periodsToSync = generateSyncPeriods(startD, endD);

        for (const period of periodsToSync) {
            const chunkFrom = formatTallyDate(period.from);
            const chunkTo = formatTallyDate(period.to);

            syncMessage = `PHASE 2: Extracting Reports [${period.type}]: ${chunkFrom} to ${chunkTo}...`;
            console.log(`⏳ ${syncMessage}`);

            tally.config = {
                server: process.env.TALLY_SERVER || 'localhost',
                port: parseInt(process.env.TALLY_PORT || '9000'),
                company: companyName,
                fromdate: chunkFrom,
                todate: chunkTo,
                sync: 'reports',
                definition: 'tally-export-config.yaml', 
                batchsize: 2000,
                frequency: 0
            };

            database.setSyncPeriod(chunkFrom, chunkTo);
            await tally.importData();
            console.log(`✅ ${period.type} Report Chunk Sent to Cloud.`);
        }
        
        const phase2Duration = Date.now() - phase2StartTime;
        console.log(`✅ PHASE 2 Complete in ${formatDuration(phase2Duration)}.`);
        
       console.log("⏭️ SKIPPING PHASE 2 (Commented out for fast testing)");

        // =========================================================
        // 🛑 COMMENTED OUT: PHASE 3 (Old Drill-Down Outstandings)
        // =========================================================
        
        const phase3StartTime = Date.now();
        console.log(`\n=========================================`);
        console.log(`🚀 STARTING PHASE 3: DEEP DRILL-DOWN (JSON EXPORTS)`);
        console.log(`=========================================\n`);

        syncMessage = `PHASE 3: Extracting Deep Ledgers from Tally...`;
        console.log(`⏳ ${syncMessage}`);

        tally.config.company = companyName;
        tally.config.server = process.env.TALLY_SERVER || 'localhost';
        tally.config.port = parseInt(process.env.TALLY_PORT || '9000');
        
        await outstandingsExporter.sync(); 
        
        const phase3Duration = Date.now() - phase3StartTime;
        console.log(`✅ PHASE 3 Complete in ${formatDuration(phase3Duration)}: All Drill-Downs saved to Cloud.`);
        
       console.log("⏭️ SKIPPING PHASE 3 (Commented out for fast testing)");


        // =========================================================
        // 🚀 FAST TEST: EXACT BILL-BY-BILL SYNC ONLY
        // =========================================================
        console.log(`\n=========================================`);
        console.log(`🚀 FAST TEST: FETCHING BILLS RECEIVABLE & PAYABLE`);
        console.log(`=========================================\n`);
        
        syncMessage = `Extracting exact Bills from Tally...`;
        console.log(`⏳ ${syncMessage}`);

        const tallyUrl = `http://${process.env.TALLY_SERVER || 'localhost'}:${process.env.TALLY_PORT || '9000'}`;
        const parser = new XMLParser({ ignoreAttributes: false });
        
        // Escape characters for Tally XML
        const companyTag = companyName.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        const billsToFetch = [
            { dbName: 'Bills Receivable', tableName: 'rpt_bills_receivable' },
            { dbName: 'Bills Payable', tableName: 'rpt_bills_payable' }
        ];

        for (const report of billsToFetch) {
            console.log(`  -> Fetching ${report.dbName}...`);
            const xmlPayload = `<?xml version="1.0" encoding="utf-8"?><ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Data</TYPE><ID>${report.dbName}</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>${companyTag}</SVCURRENTCOMPANY><EXPLODEFLAG>Yes</EXPLODEFLAG><ISBILLWISEON>Yes</ISBILLWISEON></STATICVARIABLES></DESC></BODY></ENVELOPE>`;

            try {
                // Fetch directly from Tally
                const response = await fetch(tallyUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/xml' },
                    body: xmlPayload
                });
                
                const xmlContent = await response.text();
                
                if (!xmlContent.includes('Unknown Request') && xmlContent.trim() !== '') {
                    const jsonObj = parser.parse(xmlContent);

                    if (jsonObj && jsonObj.ENVELOPE) {
                        let payload = [{
                            guid: `report_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
                            reportName: report.dbName,
                            reportData: JSON.stringify(jsonObj)
                        }];

                        // Save using your existing architecture!
                        await database.bulkLoadTableJson({ name: report.tableName }, payload);
                        console.log(`  ✅ Successfully saved ${report.dbName} to the database!`);
                    }
                } else {
                    console.log(`  ⚠️ Tally rejected the request for ${report.dbName}.`);
                }
            } catch(e: any) {
                console.error(`  ❌ Error fetching ${report.dbName}:`, e.message);
            }
        }


        // Wrap up
        const totalSyncDuration = Date.now() - totalSyncStartTime; 
        syncMessage = `Fast Sync Complete in ${formatDuration(totalSyncDuration)}!`;
        console.log(`\n🎉 Company '${companyName}' Fast Sync completely finished in ${formatDuration(totalSyncDuration)}!`);

    } catch (error: any) {
        syncMessage = `Sync Failed: ${error.message}`;
        console.error("\n❌ Critical Sync Error:", error.message);
    } finally {
        await database.closeConnectionPool(); 
        setTimeout(() => {
            isSyncing = false;
            syncMessage = "Idle";
        }, 3000);
    }
});

// =========================================================
// STATUS POLLING ROUTE
// =========================================================
app.get('/sync-status', (req: Request, res: Response) => {
    res.status(200).json({ 
        isSyncing: isSyncing, 
        message: syncMessage 
    });
});

const PORT = process.env.PORT || 4010;
app.listen(PORT, () => {
    console.log(`\n🛡️  Secure Single-Company Tally Agent is Online.`);
    console.log(`📡 Listening on: http://localhost:${PORT}/full-sync\n`);
});