/**
 * Breadcrumb: src/syncModules/sync/sync.controller.ts
 * Description: Handles Tally-agent sync trigger requests from BAS.
 */

import type { Request, Response } from "express";
import { SyncService } from "./sync.service";

export class SyncController {
  private readonly service = new SyncService();

  syncLedgers = async (req: Request, res: Response) => {
    try {
      const tenantId = String(req.body?.tenantId ?? "");
      const clientId = String(req.body?.clientId ?? "");
      const companyName = String(req.body?.companyName ?? "");

      const result = await this.service.syncLedgers({
        tenantId,
        clientId,
        companyName,
      });

      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e) });
    }
  };

  syncVouchers = async (req: Request, res: Response) => {
    try {
      const tenantId = String(req.body?.tenantId ?? "");
      const clientId = String(req.body?.clientId ?? "");
      const companyName = String(req.body?.companyName ?? "");
      const fromDate = req.body?.fromDate
        ? String(req.body.fromDate)
        : undefined;
      const toDate = req.body?.toDate ? String(req.body.toDate) : undefined;

      const result = await this.service.syncVouchers({
        tenantId,
        clientId,
        companyName,
        fromDate,
        toDate,
      });

      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e) });
    }
  };

  syncBalanceSheet = async (req: Request, res: Response) => {
    try {
      const tenantId = String(req.body?.tenantId ?? "");
      const clientId = String(req.body?.clientId ?? "");
      const companyName = String(req.body?.companyName ?? "");
      const fromDate = req.body?.fromDate
        ? String(req.body.fromDate)
        : undefined;
      const toDate = req.body?.toDate ? String(req.body.toDate) : undefined;

      const result = await this.service.syncBalanceSheet({
        tenantId,
        clientId,
        companyName,
        fromDate,
        toDate,
      });

      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e) });
    }
  };

  syncProfitLoss = async (req: Request, res: Response) => {
    try {
      const tenantId = String(req.body?.tenantId ?? "");
      const clientId = String(req.body?.clientId ?? "");
      const companyName = String(req.body?.companyName ?? "");
      const fromDate = req.body?.fromDate
        ? String(req.body.fromDate)
        : undefined;
      const toDate = req.body?.toDate ? String(req.body.toDate) : undefined;

      const result = await this.service.syncProfitLoss({
        tenantId,
        clientId,
        companyName,
        fromDate,
        toDate,
      });

      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e) });
    }
  };

  syncTrialBalance = async (req: Request, res: Response) => {
    try {
      const tenantId = String(req.body?.tenantId ?? "");
      const clientId = String(req.body?.clientId ?? "");
      const companyName = String(req.body?.companyName ?? "");
      const fromDate = req.body?.fromDate
        ? String(req.body.fromDate)
        : undefined;
      const toDate = req.body?.toDate ? String(req.body.toDate) : undefined;

      const result = await this.service.syncTrialBalance({
        tenantId,
        clientId,
        companyName,
        fromDate,
        toDate,
      });

      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e) });
    }
  };
}
