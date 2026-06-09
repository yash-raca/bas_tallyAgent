import express, { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import http from "http";
import { database } from "./database";
import { tally } from "./tally";
import { outstandingsExporter } from "./outstandings";
import { XMLParser } from "fast-xml-parser";

dotenv.config();
const app = express();

app.use(
  cors({
    origin: "*",
    methods: ["POST", "GET", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

app.use(express.json());

let isSyncing = false;
let syncMessage = "Idle";
let lastSyncError: string | null = null;
let lastSyncResult: "idle" | "running" | "success" | "failed" = "idle";
let lastSyncStartedAt: string | null = null;
let lastSyncEndedAt: string | null = null;

const getTallyHost = () => (process.env.TALLY_SERVER || "localhost").trim();
const getTallyPort = () => {
  const parsed = parseInt(process.env.TALLY_PORT || "9000", 10);
  return Number.isNaN(parsed) ? 9000 : parsed;
};

const formatDuration = (ms: number) => {
  const seconds = Math.floor((ms / 1000) % 60);
  const minutes = Math.floor((ms / (1000 * 60)) % 60);
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${(ms / 1000).toFixed(2)}s`;
};

const formatTallyDate = (d: Date) => {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
};

const parseTallyDate = (dateStr: string) => {
  if (!dateStr || dateStr.length !== 8) return null;

  const yyyy = parseInt(dateStr.substring(0, 4), 10);
  const mm = parseInt(dateStr.substring(4, 6), 10);
  const dd = parseInt(dateStr.substring(6, 8), 10);

  if (
    Number.isNaN(yyyy) ||
    Number.isNaN(mm) ||
    Number.isNaN(dd) ||
    mm < 1 ||
    mm > 12 ||
    dd < 1 ||
    dd > 31
  ) {
    return null;
  }

  return new Date(yyyy, mm - 1, dd);
};

const generateAllSyncPeriods = (start: Date, end: Date) => {
  const periods: { type: string; from: Date; to: Date }[] = [];

  const createChunks = (monthStep: number, typeLabel: string) => {
    let currentStart = new Date(start.getTime());

    while (currentStart <= end) {
      let currentEnd = new Date(
        currentStart.getFullYear(),
        currentStart.getMonth() + monthStep,
        0,
      );

      if (currentEnd > end) {
        currentEnd = new Date(end.getTime());
      }

      periods.push({
        type: typeLabel,
        from: new Date(currentStart.getTime()),
        to: new Date(currentEnd.getTime()),
      });

      currentStart = new Date(
        currentStart.getFullYear(),
        currentStart.getMonth() + monthStep,
        1,
      );
    }
  };

  createChunks(12, "Yearly");
  createChunks(3, "Quarterly");
  createChunks(1, "Monthly");

  return periods;
};

const checkTallyReachable = async (): Promise<{
  ok: boolean;
  error?: string;
}> => {
  return new Promise((resolve) => {
    const host = getTallyHost();
    const port = getTallyPort();

    const pingXml = `<?xml version="1.0" encoding="utf-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Function</TYPE>
    <ID>$$Version</ID>
  </HEADER>
</ENVELOPE>`;

    const req = http.request(
      {
        hostname: host,
        port,
        path: "",
        method: "POST",
        timeout: 3000,
        headers: {
          "Content-Length": Buffer.byteLength(pingXml, "utf16le"),
          "Content-Type": "text/xml;charset=utf-16",
        },
      },
      (res) => {
        let data = "";
        res
          .setEncoding("utf16le")
          .on("data", (chunk) => {
            data += chunk;
          })
          .on("end", () => {
            if (data && data.trim()) {
              resolve({ ok: true });
            } else {
              resolve({
                ok: false,
                error:
                  "Tally did not return a valid response. Please ensure Tally is open and XML port is enabled.",
              });
            }
          })
          .on("error", (err) => {
            resolve({
              ok: false,
              error: `Failed while reading Tally response: ${err.message}`,
            });
          });
      },
    );

    req.on("timeout", () => {
      req.destroy();
      resolve({
        ok: false,
        error:
          "Tally connection timed out. Please ensure Tally is open and reachable.",
      });
    });

    req.on("error", (err) => {
      resolve({
        ok: false,
        error: `Unable to connect to Tally on ${host}:${port}. Ensure Tally is open and XML port is enabled. (${err.message})`,
      });
    });

    req.write(pingXml, "utf16le");
    req.end();
  });
};

app.post("/full-sync", async (req: Request, res: Response): Promise<any> => {
  const authHeader = req.headers.authorization;
  const expectedToken = process.env.AGENT_API_KEY;

  if (!expectedToken) {
    return res.status(500).json({
      success: false,
      error: "Server Configuration Error: AGENT_API_KEY is missing in .env",
    });
  }

  if (!authHeader || authHeader !== `Bearer ${expectedToken}`) {
    return res.status(401).json({
      success: false,
      error: "Unauthorized.",
    });
  }

  const { clientId, companyName, fromDate, toDate } = req.body;

  const syncIntervalRaw =
    req.body.syncInterval ||
    req.body.syncinterval ||
    req.body.interval ||
    "Monthly";

  if (!companyName || typeof companyName !== "string" || !companyName.trim()) {
    return res.status(400).json({
      success: false,
      error: "Missing or invalid companyName in request body.",
    });
  }

  if (fromDate && fromDate !== "auto" && !parseTallyDate(fromDate)) {
    return res.status(400).json({
      success: false,
      error: "Invalid fromDate. Expected format: yyyyMMdd or 'auto'.",
    });
  }

  if (toDate && toDate !== "auto" && !parseTallyDate(toDate)) {
    return res.status(400).json({
      success: false,
      error: "Invalid toDate. Expected format: yyyyMMdd or 'auto'.",
    });
  }

  if (isSyncing) {
    return res.status(409).json({
      success: false,
      error: "A sync is already in progress. Please wait.",
    });
  }

  const tallyHealth = await checkTallyReachable();
  if (!tallyHealth.ok) {
    lastSyncResult = "failed";
    lastSyncError = tallyHealth.error || "Tally is not reachable.";
    syncMessage = "Failed";
    lastSyncEndedAt = new Date().toISOString();

    return res.status(503).json({
      success: false,
      error: lastSyncError,
      message: "Sync was not started because Tally is unavailable.",
    });
  }

  isSyncing = true;
  syncMessage = "Initializing Connection...";
  lastSyncError = null;
  lastSyncResult = "running";
  lastSyncStartedAt = new Date().toISOString();
  lastSyncEndedAt = null;

  res.status(202).json({
    success: true,
    message: `Sync started for ${companyName}. Processing in background...`,
    clientId,
    statusUrl: "/sync-status",
  });

  const totalSyncStartTime = Date.now();

  try {
    console.log("\n=========================================");
    console.log(`🚀 STARTING SYNC FOR: ${companyName}`);
    console.log("=========================================\n");

    await database.openConnectionPool();
    database.setTargetCompany(companyName);

    const startD =
      fromDate !== "auto" && fromDate
        ? (parseTallyDate(fromDate) as Date)
        : new Date(new Date().getFullYear(), 3, 1);

    const endD =
      toDate !== "auto" && toDate
        ? (parseTallyDate(toDate) as Date)
        : new Date();

    const phase1StartTime = Date.now();
    const masterFrom = formatTallyDate(startD);
    const masterTo = formatTallyDate(endD);

    syncMessage = `PHASE 1: Syncing Vouchers & Masters (${masterFrom} to ${masterTo})...`;
    console.log(`\n⏳ ${syncMessage}`);

    tally.config = {
      server: getTallyHost(),
      port: getTallyPort(),
      company: companyName,
      fromdate: masterFrom,
      todate: masterTo,
      sync: "vouchers,masters",
      definition: "tally-export-config.yaml",
      batchsize: 25000,
      frequency: 0,
    };

    database.setSyncPeriod(masterFrom, masterTo);
    await tally.importData();

    const phase1Duration = Date.now() - phase1StartTime;
    console.log(
      `✅ PHASE 1 Complete in ${formatDuration(phase1Duration)}: All foundational data saved.`,
    );

    const phase2StartTime = Date.now();
    console.log(`\n=========================================`);
    console.log(`🚀 STARTING PHASE 2: FAST REPORT EXTRACTION`);
    console.log(`=========================================\n`);

    const periodsToSync = generateAllSyncPeriods(startD, endD);

    for (const period of periodsToSync) {
      const chunkFrom = formatTallyDate(period.from);
      const chunkTo = formatTallyDate(period.to);

      syncMessage = `PHASE 2: Extracting Reports [${period.type}]: ${chunkFrom} to ${chunkTo}...`;
      console.log(`⏳ ${syncMessage}`);

      tally.config = {
        server: getTallyHost(),
        port: getTallyPort(),
        company: companyName,
        fromdate: chunkFrom,
        todate: chunkTo,
        sync: "reports",
        definition: "tally-export-config.yaml",
        batchsize: 2000,
        frequency: 0,
      };

      database.setSyncPeriod(chunkFrom, chunkTo);
      await tally.importData();

      console.log(
        `✅ ${period.type} Report Chunk Sent to Cloud. (${chunkFrom} - ${chunkTo})`,
      );
    }

    const phase2Duration = Date.now() - phase2StartTime;
    console.log(`✅ PHASE 2 Complete in ${formatDuration(phase2Duration)}.`);

    const phase3StartTime = Date.now();
    console.log(`\n=========================================`);
    console.log(`🚀 STARTING PHASE 3: DEEP DRILL-DOWN (JSON EXPORTS)`);
    console.log(`=========================================\n`);

    syncMessage = `PHASE 3: Extracting Deep Ledgers from Tally...`;
    console.log(`⏳ ${syncMessage}`);

    tally.config.company = companyName;
    tally.config.server = getTallyHost();
    tally.config.port = getTallyPort();
    tally.config.fromdate = formatTallyDate(startD);
    tally.config.todate = formatTallyDate(endD);

    await outstandingsExporter.sync(syncIntervalRaw);

    const phase3Duration = Date.now() - phase3StartTime;
    console.log(
      `✅ PHASE 3 Complete in ${formatDuration(phase3Duration)}: All Drill-Downs saved to Cloud.`,
    );

    console.log(`\n=========================================`);
    console.log(`🚀 FAST TEST: FETCHING BILLS RECEIVABLE & PAYABLE`);
    console.log(`=========================================\n`);

    syncMessage = `Extracting exact Bills from Tally...`;
    console.log(`⏳ ${syncMessage}`);

    const tallyUrl = `http://${getTallyHost()}:${getTallyPort()}`;
    const parser = new XMLParser({ ignoreAttributes: false });

    const companyTag = companyName
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    const billsToFetch = [
      { dbName: "Bills Receivable", tableName: "rpt_bills_receivable" },
      { dbName: "Bills Payable", tableName: "rpt_bills_payable" },
    ];

    for (const report of billsToFetch) {
      console.log(`  -> Fetching ${report.dbName}...`);

      const xmlPayload = `<?xml version="1.0" encoding="utf-8"?><ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Data</TYPE><ID>${report.dbName}</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>${companyTag}</SVCURRENTCOMPANY><EXPLODEFLAG>Yes</EXPLODEFLAG><ISBILLWISEON>Yes</ISBILLWISEON></STATICVARIABLES></DESC></BODY></ENVELOPE>`;

      try {
        const response = await fetch(tallyUrl, {
          method: "POST",
          headers: { "Content-Type": "text/xml" },
          body: xmlPayload,
        });

        const xmlContent = await response.text();

        if (
          !xmlContent.includes("Unknown Request") &&
          xmlContent.trim() !== ""
        ) {
          const jsonObj = parser.parse(xmlContent);

          if (jsonObj && jsonObj.ENVELOPE) {
            const payload = [
              {
                guid: `report_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
                reportName: report.dbName,
                reportData: JSON.stringify(jsonObj),
              },
            ];

            await database.bulkLoadTableJson(
              { name: report.tableName },
              payload,
            );

            console.log(
              `  ✅ Successfully saved ${report.dbName} to the database!`,
            );
          }
        } else {
          console.log(`  ⚠️ Tally rejected the request for ${report.dbName}.`);
        }
      } catch (e: any) {
        console.error(`  ❌ Error fetching ${report.dbName}:`, e.message);
        throw new Error(`Failed during ${report.dbName} fetch: ${e.message}`);
      }
    }

    const totalSyncDuration = Date.now() - totalSyncStartTime;
    syncMessage = `Completed in ${formatDuration(totalSyncDuration)}`;
    lastSyncResult = "success";
    lastSyncError = null;
    lastSyncEndedAt = new Date().toISOString();

    console.log(
      `\n🎉 Company '${companyName}' Fast Sync completely finished in ${formatDuration(totalSyncDuration)}!`,
    );
  } catch (error: any) {
    const errMsg =
      error?.response?.data?.message ||
      error?.response?.data?.error ||
      error?.message ||
      "Unknown sync failure";

    syncMessage = "Failed";
    lastSyncResult = "failed";
    lastSyncError = errMsg;
    lastSyncEndedAt = new Date().toISOString();

    console.error("\n❌ Critical Sync Error:", errMsg);

    if (error?.response?.status) {
      console.error("❌ HTTP Status:", error.response.status);
    }

    if (error?.response?.data) {
      console.error("❌ Response Data:", error.response.data);
    }
  } finally {
    await database.closeConnectionPool();
    isSyncing = false;
  }
});

app.get("/sync-status", (_req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    isSyncing,
    status: lastSyncResult,
    message: syncMessage,
    lastError: lastSyncError,
    lastSyncStartedAt,
    lastSyncEndedAt,
  });
});

const PORT = process.env.PORT || 4010;
app.listen(PORT, () => {
  console.log(`\n🛡️  Secure Single-Company Tally Agent is Online.`);
  console.log(`📡 Listening on: http://localhost:${PORT}/full-sync`);
  console.log(`🏢 Tally target: http://${getTallyHost()}:${getTallyPort()}\n`);
});
