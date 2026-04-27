import axios from 'axios';
import fs from 'fs';

class Database {
    config: any;
    endpoint: string;
    public targetClientId: string = "";     // Set dynamically via trigger
    public targetCompanyName: string = "";  // Set dynamically via trigger
    
    // ✨ ADDED: Date chunking trackers
    public currentFromDate: string = "";
    public currentToDate: string = "";

    constructor(config: any) {
        this.config = config.database || {};
        this.config.technology = 'postgres'; 
        // Points to your secure backend sync route
        this.endpoint = process.env.BACKEND_API_URL 
            ? `${process.env.BACKEND_API_URL}/tally/sync` 
            : "http://localhost:8000/api/tally/sync";
    }

    // Setter methods called by your server/trigger route
    public setTargetClient(id: string) {
        this.targetClientId = id;
    }

    public setTargetCompany(name: string) {
        this.targetCompanyName = name;
    }
    
    // ✨ ADDED: Called by the while loop in index.ts before extracting a chunk
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
        return ['mst_group', 'mst_ledger', 'mst_stockitem', 'trn_voucher', 'trn_accounting', 'trn_inventory', 'config'];
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

    async jsonToCsv(path: string, tableDef: any, rows: any[], writeHeader: boolean) {
        return "";
    }

    async uploadGoogleBigQuery(tableName: string) {
        return 0;
    }

    async bulkLoad(filePath: string, tableName: string, columnTypes: string[]) {
        if (!fs.existsSync(filePath)) return 0;
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n').filter(line => line.trim() !== '');
        if (lines.length <= 1) return 0;

        const headers = lines[0].split('\t').map(h => h.trim());
        const dataRows = [];

        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split('\t');
            let rowObject: any = {};
            headers.forEach((header, index) => {
                rowObject[header] = values[index] ? values[index].trim() : null;
            });
            dataRows.push(rowObject);
        }

        await this.transmitData(tableName, dataRows);
        return dataRows.length;
    }

    private async transmitData(tableName: string, data: any[]) {
        const chunkSize = 2000;
        for (let i = 0; i < data.length; i += chunkSize) {
            const chunk = data.slice(i, i + chunkSize);
            const isFirstBatch = (i === 0); 

            try {
                process.stdout.write(`[API Bridge] Transmitting ${chunk.length} rows to ${tableName} for ${this.targetCompanyName}... `);
                
                await axios.post(this.endpoint, {
                    clientId: this.targetClientId,
                    companyName: this.targetCompanyName, // ✅ DYNAMIC COMPANY NAME
                    tableName: tableName,
                    data: chunk,
                    // ✨ ADDED: Sending the dates to the Backend so Prisma doesn't crash!
                    fromDate: this.currentFromDate,
                    toDate: this.currentToDate,
                    isFirstBatch: isFirstBatch
                }, {
                    headers: { 
                        // ✅ USES PERMANENT AGENT KEY FROM .ENV
                        'Authorization': `Bearer ${process.env.AGENT_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    maxBodyLength: Infinity
                });
                console.log(`✅ Success`);
            } catch (err: any) {
                const errorDetail = err.response?.data?.error || err.message;
                console.log(`❌ Failed: ${errorDetail}`);
            }
        }
    }
}

// Safely instantiate for export
let appConfig = { database: {} };
try {
    appConfig = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
} catch (e) {}

export const database = new Database(appConfig);