import express from "express";
import { syncRouter } from "./syncModules/sync/sync.routes";

const PORT = Number(process.env.PORT ?? 4010);

const app = express();

// MUST be before routes
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

app.get("/health", (_req, res) =>
  res.json({ ok: true, service: "tally-agent" }),
);

// mount routes
app.use(syncRouter());

app.listen(PORT, () => console.log(`tally-agent listening on :${PORT}`));
