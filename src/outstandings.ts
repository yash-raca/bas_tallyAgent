import http from "http";
import { XMLParser } from "fast-xml-parser";
import axios from "axios";
import { utility } from "./utility";
import { logger } from "./logger";
import { tally } from "./tally";

class OutstandingsExporter {
  private getBackendBaseUrl(): string {
    const raw = (process.env.BACKEND_API_URL || "").trim().replace(/\/+$/, "");

    if (raw) return raw;

    const env = (process.env.NODE_ENV || "").toLowerCase();

    if (env === "production") {
      throw new Error("BACKEND_API_URL is missing in production environment.");
    }

    return "http://localhost:8000/api";
  }

  private async postTallyXML(msg: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const req = http.request(
        {
          hostname: tally.config.server,
          port: tally.config.port,
          path: "",
          method: "POST",
          headers: {
            "Content-Length": Buffer.byteLength(msg, "utf16le"),
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
            .on("end", () => resolve(data))
            .on("error", (err) => reject(err));
        },
      );

      req.on("error", (err) => reject(err));
      req.write(msg, "utf16le");
      req.end();
    });
  }

  private generateTallyXML(
    reportName: string,
    extraVars: string,
    customFrom?: string,
    customTo?: string,
  ): string {
    const fromStr = customFrom || tally.config.fromdate;
    const toStr = customTo || tally.config.todate;

    const fromD = utility.Date.parse(fromStr, "yyyyMMdd") || new Date();
    const toD = utility.Date.parse(toStr, "yyyyMMdd") || new Date();

    const dateFromStr = utility.Date.format(fromD, "d-MMM-yyyy");
    const dateToStr = utility.Date.format(toD, "d-MMM-yyyy");
    const companyTag = tally.config.company
      ? utility.String.escapeHTML(tally.config.company)
      : "##SVCurrentCompany";

    return `<?xml version="1.0" encoding="utf-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Data</TYPE>
    <ID>${reportName}</ID>
  </HEADER>
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

  private generateLedgerCollectionXML(groupName: string): string {
    const companyTag = tally.config.company
      ? utility.String.escapeHTML(tally.config.company)
      : "##SVCurrentCompany";

    const safeGroup = utility.String.escapeHTML(groupName);

    return `<?xml version="1.0" encoding="utf-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>Ledgers</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        <SVCURRENTCOMPANY>${companyTag}</SVCURRENTCOMPANY>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="Ledgers" ISMODIFY="No" ISFIXED="No" ISINITIALIZE="No" ISOPTION="No" ISINTERNAL="No">
            <TYPE>Ledger:Group</TYPE>
            <CHILDOF>${safeGroup}</CHILDOF>
            <BELONGSTO>Yes</BELONGSTO>
            <NATIVEMETHOD>Name,Parent,ClosingBalance</NATIVEMETHOD>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
  }

  private formatMonthYear(date: Date): string {
    return new Intl.DateTimeFormat("en-US", {
      month: "long",
      year: "numeric",
    }).format(date);
  }

  private cleanText(value: any): string {
    if (value == null) return "";
    if (typeof value === "string") return value.replace(/&amp;/g, "&").trim();
    if (typeof value === "object") {
      return (
        value.DSPDISPNAME ||
        value.dspdispname ||
        value.NAME ||
        value.Name ||
        value._text ||
        ""
      )
        .toString()
        .replace(/&amp;/g, "&")
        .trim();
    }
    return String(value).replace(/&amp;/g, "&").trim();
  }

  private collectLedgerNamesFromGroupSummary(root: any): string[] {
    const names = new Set<string>();
    const skipNames = new Set([
      "debtors export",
      "creditors export",
      "sundry debtors",
      "sundry creditors",
    ]);

    const scan = (node: any) => {
      if (!node) return;

      if (Array.isArray(node)) {
        node.forEach(scan);
        return;
      }

      if (typeof node !== "object") return;

      const accNodes = node.DSPACCNAME || node.dspaccname;
      if (accNodes) {
        const items = Array.isArray(accNodes) ? accNodes : [accNodes];
        for (const item of items) {
          const name = this.cleanText(item);
          const lower = name.toLowerCase();
          if (name && !lower.includes("grand total") && !skipNames.has(lower)) {
            names.add(name);
          }
        }
      }

      for (const key in node) {
        scan(node[key]);
      }
    };

    scan(root);
    return Array.from(names);
  }

  private collectLedgerNamesFromCollection(root: any): string[] {
    const names = new Set<string>();

    const scan = (node: any) => {
      if (!node) return;

      if (Array.isArray(node)) {
        node.forEach(scan);
        return;
      }

      if (typeof node !== "object") return;

      const directName =
        node.NAME || node.Name || node.MASTERNAME || node._text || "";

      const cleanedDirect = this.cleanText(directName);
      if (
        cleanedDirect &&
        !cleanedDirect.toLowerCase().includes("grand total") &&
        cleanedDirect !== "Ledgers"
      ) {
        names.add(cleanedDirect);
      }

      for (const key in node) {
        scan(node[key]);
      }
    };

    scan(root);
    return Array.from(names);
  }

  public async sync(interval: string = "Monthly"): Promise<void> {
    logger.logMessage(
      `\n🚀 Starting ${interval} Deep Outstandings Extraction...`,
    );

    const groupsToSync = ["Sundry Debtors", "Sundry Creditors"];

    const parser = new XMLParser({
      ignoreAttributes: false,
      textNodeName: "_text",
    });

    const syncUrl = `${this.getBackendBaseUrl()}/tally/sync-export`;

    logger.logMessage(`🌐 Using backend sync URL: ${syncUrl}`);

    const axiosConfig = {
      headers: {
        Authorization: `Bearer ${process.env.AGENT_API_KEY}`,
        "Content-Type": "application/json",
      },
      maxBodyLength: Infinity,
    };

    const safeInterval = interval.replace(/[^a-zA-Z]/g, "").toLowerCase();
    let monthStep = 1;

    if (
      safeInterval.includes("quarter") ||
      safeInterval.includes("quater") ||
      safeInterval.startsWith("q")
    ) {
      monthStep = 3;
    } else if (safeInterval.includes("half") || safeInterval.startsWith("h")) {
      monthStep = 6;
    } else if (safeInterval.includes("year") || safeInterval === "y") {
      monthStep = 12;
    }

    const startD =
      utility.Date.parse(tally.config.fromdate, "yyyyMMdd") || new Date();
    const endD =
      utility.Date.parse(tally.config.todate, "yyyyMMdd") || new Date();

    const monthsToSync: { from: string; to: string; name: string }[] = [];
    let curr = new Date(startD.getFullYear(), startD.getMonth(), 1);

    while (curr <= endD) {
      const y = curr.getFullYear();
      const m = curr.getMonth();

      const mStart = new Date(y, m, 1);
      const mEnd = new Date(y, m + monthStep, 0);

      const actualStart = mStart < startD ? startD : mStart;
      const actualEnd = mEnd > endD ? endD : mEnd;

      let chunkName = this.formatMonthYear(actualStart);
      if (monthStep > 1) {
        chunkName += ` to ${this.formatMonthYear(actualEnd)}`;
      }

      monthsToSync.push({
        from: `${actualStart.getFullYear()}${String(actualStart.getMonth() + 1).padStart(2, "0")}${String(actualStart.getDate()).padStart(2, "0")}`,
        to: `${actualEnd.getFullYear()}${String(actualEnd.getMonth() + 1).padStart(2, "0")}${String(actualEnd.getDate()).padStart(2, "0")}`,
        name: chunkName,
      });

      curr = new Date(curr.getFullYear(), curr.getMonth() + monthStep, 1);
    }

    for (const groupName of groupsToSync) {
      logger.logMessage(`\n📦 Fetching Group: ${groupName}...`);

      const level1Xml = this.generateTallyXML(
        "Group Summary",
        `<GROUPNAME>${utility.String.escapeHTML(groupName)}</GROUPNAME><EXPLODEFLAG>Yes</EXPLODEFLAG><EXPLODEALLLEVELS>Yes</EXPLODEALLLEVELS><ISITEMIZE>Yes</ISITEMIZE>`,
      );

      const level1Raw = await this.postTallyXML(level1Xml);

      let level1Data: any;
      try {
        level1Data = parser.parse(level1Raw);
      } catch (err: any) {
        logger.logError(
          `❌ Failed to parse Group Summary for ${groupName}`,
          err?.message || String(err),
        );
        continue;
      }

      await axios.post(
        syncUrl,
        {
          companyName: tally.config.company,
          tableName: "tally_outstandings_export",
          payload: { groupName, reportData: level1Data },
        },
        axiosConfig,
      );

      const level1Derived = this.collectLedgerNamesFromGroupSummary(
        level1Data?.ENVELOPE || level1Data,
      );

      let collectionDerived: string[] = [];
      try {
        const collectionXml = this.generateLedgerCollectionXML(groupName);
        const collectionRaw = await this.postTallyXML(collectionXml);
        const collectionData = parser.parse(collectionRaw);
        collectionDerived = this.collectLedgerNamesFromCollection(
          collectionData?.ENVELOPE || collectionData,
        );
      } catch (err: any) {
        logger.logError(
          `⚠️ Ledger collection fetch failed for ${groupName}`,
          err?.message || String(err),
        );
      }

      const targetLedgers = new Set<string>([
        ...level1Derived,
        ...collectionDerived,
      ]);

      const ledgerArray = Array.from(targetLedgers).filter(Boolean).sort();

      logger.logMessage(
        `🔍 Found ${ledgerArray.length} drill-down ledgers for ${groupName}. Starting Drill-Down...`,
      );

      for (const ledgerName of ledgerArray) {
        try {
          const safeLedgerName = utility.String.escapeHTML(ledgerName);

          const summaryXml = this.generateTallyXML(
            "Ledger Monthly Summary",
            `<LEDGERNAME>${safeLedgerName}</LEDGERNAME><EXPLODEFLAG>Yes</EXPLODEFLAG>`,
          );

          const summaryRaw = await this.postTallyXML(summaryXml);
          const summaryParsed = parser.parse(summaryRaw);

          await axios.post(
            syncUrl,
            {
              companyName: tally.config.company,
              tableName: "tally_ledger_monthly_export",
              payload: {
                ledgerName,
                reportData: summaryParsed,
              },
            },
            axiosConfig,
          );

          for (const mChunk of monthsToSync) {
            const vchXml = this.generateTallyXML(
              "Ledger Vouchers",
              `<LEDGERNAME>${safeLedgerName}</LEDGERNAME>
<EXPLODEFLAG>Yes</EXPLODEFLAG>
<EXPLODEALLLEVELS>Yes</EXPLODEALLLEVELS>
<ISITEMIZE>Yes</ISITEMIZE>
<ISBILLWISEON>Yes</ISBILLWISEON>`,
              mChunk.from,
              mChunk.to,
            );

            const vchRaw = await this.postTallyXML(vchXml);
            const vchParsed = parser.parse(vchRaw);

            await axios.post(
              syncUrl,
              {
                companyName: tally.config.company,
                tableName: "tally_ledger_voucher_export",
                payload: {
                  ledgerName,
                  month: mChunk.name,
                  reportData: vchParsed,
                },
              },
              axiosConfig,
            );
          }

          logger.logMessage(
            `   ✅ Synced: ${ledgerName} (${monthsToSync.length} chunks)`,
          );
        } catch (err: any) {
          logger.logError(
            `   ❌ Failed: ${ledgerName}`,
            err?.message || String(err),
          );
        }
      }
    }

    logger.logMessage("✅ All Data Synced Chunk-Wise!");
  }
}

export const outstandingsExporter = new OutstandingsExporter();
