export const env = {
  PORT: Number(process.env.PORT ?? 4010),
  TALLY_BASE_URL: process.env.TALLY_BASE_URL ?? "http://127.0.0.1:9000",
  CLOUD_BASE_URL: process.env.CLOUD_BASE_URL || "http://127.0.0.1:8000",
  AGENT_TOKEN: process.env.AGENT_TOKEN ?? "dev-agent-token",
  TALLY_COMPANY_NAME: process.env.TALLY_COMPANY_NAME ?? "",
} as const;
