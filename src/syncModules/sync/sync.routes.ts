import { Router } from "express";
import { SyncController } from "./sync.controller";

export const syncRouter = () => {
  const r = Router();
  const c = new SyncController();
  r.post("/sync/ledgers", c.syncLedgers);
  r.post("/sync/vouchers", c.syncVouchers);
  r.post("/sync/balance-sheet", c.syncBalanceSheet);
  r.post("/sync/profit-loss", c.syncProfitLoss);
  r.post("/sync/trial-balance", c.syncTrialBalance);
  return r;
};
