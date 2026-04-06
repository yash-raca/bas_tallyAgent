export type TallyExportHeaders =
  | {
      "content-type": "application/json";
      version: "1";
      tallyrequest: "export";
      type: "collection";
      id: string;
    }
  | {
      "content-type": "application/json";
      version: "1";
      tallyrequest: "export";
      type: "data";
      id: string;
    };

export class TallyHttpClient {
  constructor(private readonly baseUrl: string) {}

  async post<T>(headers: TallyExportHeaders, body: unknown): Promise<T> {
    const resp = await fetch(this.baseUrl, {
      method: "POST",
      headers: headers as unknown as Record<string, string>,
      body: JSON.stringify(body ?? {}),
    });

    const text = await resp.text();
    if (!resp.ok) throw new Error(text);

    const parsed = JSON.parse(text) as any;
    return parsed as T;
  }
}
