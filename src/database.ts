import axios from "axios";
import fs from "fs";

class Database {
  config: any;
  endpoint: string;
  public targetClientId: string = "";
  public targetCompanyName: string = "";
  public currentFromDate: string = "";
  public currentToDate: string = "";

  constructor(config: any) {
    this.config = config.database || {};
    this.config.technology = "postgres";

    const rawBackendUrl = process.env.BACKEND_API_URL?.trim();

    this.endpoint =
      rawBackendUrl && rawBackendUrl.length > 0
        ? `${rawBackendUrl.replace(/\/+$/, "")}/tally/sync`
        : "https://finwellgrowth.cloud/api/tally/sync";

    console.log(`🌐 Phase 1/2 sync endpoint: ${this.endpoint}`);
  }

  public setTargetClient(id: string) {
    this.targetClientId = id;
  }

  public setTargetCompany(name: string) {
    this.targetCompanyName = name;
  }

  public setSyncPeriod(from: string, to: string) {
    this.currentFromDate = from;
    this.currentToDate = to;
  }

  async openConnectionPool() {}
  async closeConnectionPool() {}

  async executeScalar<T>(query: string): Promise<T | number> {
    return 0 as unknown as T;
  }

  async executeNonQuery(query: string): Promise<number> {
    return 0;
  }

  async listDatabaseTables() {
    return [
      "mst_group",
      "mst_ledger",
      "mst_stockitem",
      "trn_voucher",
      "trn_accounting",
      "trn_inventory",
      "config",
    ];
  }

  async createDatabaseTables(syncType: string) {}
  async truncateTables(tables: string[]) {}

  csvToJsonArray(content: string, tableName: string, fieldTypes: string[]) {
    return [];
  }

  convertCSV(content: string, fieldTypes: string[]) {
    return content;
  }

  async bulkLoadTableJson(tableDef: any, rows: any[]) {
    await this.transmitData(tableDef.name, rows);
    return rows.length;
  }

  async jsonToCsv(
    path: string,
    tableDef: any,
    rows: any[],
    writeHeader: boolean,
  ) {
    return "";
  }

  async uploadGoogleBigQuery(tableName: string) {
    return 0;
  }

  async bulkLoad(filePath: string, tableName: string, columnTypes: string[]) {
    if (!fs.existsSync(filePath)) return 0;

    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n").filter((line) => line.trim() !== "");
    if (lines.length <= 1) return 0;

    const headers = lines[0].split("\t").map((h) => h.trim());
    const dataRows: any[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split("\t");
      const rowObject: Record<string, any> = {};
      headers.forEach((header, index) => {
        rowObject[header] = values[index] ? values[index].trim() : null;
      });
      dataRows.push(rowObject);
    }

    await this.transmitData(tableName, dataRows);
    return dataRows.length;
  }

  private async transmitData(tableName: string, data: any[]) {
    if (!Array.isArray(data) || data.length === 0) return;

    const chunkSize = 2000;

    for (let i = 0; i < data.length; i += chunkSize) {
      const chunk = data.slice(i, i + chunkSize);
      const isFirstBatch = i === 0;

      try {
        process.stdout.write(
          `[API Bridge] Transmitting ${chunk.length} rows to ${tableName} for ${this.targetCompanyName}... `,
        );

        const response = await axios.post(
          this.endpoint,
          {
            clientId: this.targetClientId,
            companyName: this.targetCompanyName,
            tableName,
            data: chunk,
            fromDate: this.currentFromDate,
            toDate: this.currentToDate,
            isFirstBatch,
          },
          {
            headers: {
              Authorization: `Bearer ${process.env.AGENT_API_KEY}`,
              "Content-Type": "application/json",
            },
            maxBodyLength: Infinity,
            timeout: 120000,
          },
        );

        const message =
          response.data?.message ??
          response.data?.success ??
          `HTTP ${response.status}`;

        console.log(`✅ Success (${message})`);
      } catch (err: any) {
        const status = err.response?.status;
        const errorDetail =
          err.response?.data?.details ||
          err.response?.data?.error ||
          err.response?.data?.message ||
          err.message ||
          "Unknown error";

        console.log(`❌ Failed${status ? ` (${status})` : ""}: ${errorDetail}`);

        throw new Error(
          `[${tableName}] Upload failed${status ? ` with status ${status}` : ""}: ${errorDetail}`,
        );
      }
    }
  }
}

let appConfig = { database: {} };

try {
  appConfig = JSON.parse(fs.readFileSync("./config.json", "utf8"));
} catch (e) {}

export const database = new Database(appConfig);
