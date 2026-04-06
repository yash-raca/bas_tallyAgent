/**
 * Breadcrumb: src/syncModules/sync/sync.service.ts
 * Description: Tally-agent sync service — exports data from Tally and posts normalized payloads to BAS ingest endpoints.
 */

import { env } from "../../config/env";
import {
  exportBalanceSheet,
  exportLedgers,
  exportProfitAndLoss,
  exportTrialBalance,
  exportVouchers,
} from "../../tallyModules/tally/tally.exports";
import { mapLedgersFromTally } from "../../tallyModules/tally/ledgers/ledger.mapper";
import { mapVouchersFromTally } from "../../tallyModules/tally/vouchers/voucher.mapper";

export type StartSyncInput = {
  tenantId: string;
  clientId: string;
  companyName: string;
};

export type StartVoucherSyncInput = StartSyncInput & {
  fromDate?: string;
  toDate?: string;
};

export type StartBalanceSheetSyncInput = StartSyncInput & {
  fromDate?: string;
  toDate?: string;
};

const YYYYMMDD_RE = /^\d{8}$/;

const assertRequired = (label: string, value: string | undefined | null) => {
  if (!value?.trim()) {
    throw new Error(`${label} is required`);
  }
};

const assertBase = (input: StartSyncInput) => {
  assertRequired("tenantId", input?.tenantId);
  assertRequired("clientId", input?.clientId);
  assertRequired("companyName", input?.companyName);
};

const assertDateRange = (input: { fromDate?: string; toDate?: string }) => {
  const { fromDate, toDate } = input;

  if ((fromDate && !toDate) || (!fromDate && toDate)) {
    throw new Error("Provide both fromDate and toDate, or neither");
  }

  if (fromDate && !YYYYMMDD_RE.test(fromDate)) {
    throw new Error("fromDate must be YYYYMMDD");
  }

  if (toDate && !YYYYMMDD_RE.test(toDate)) {
    throw new Error("toDate must be YYYYMMDD");
  }

  if (fromDate && toDate && fromDate > toDate) {
    throw new Error("fromDate must be <= toDate");
  }
};

export class SyncService {
  async syncLedgers(input: StartSyncInput) {
    assertBase(input);

    const normalizedInput: StartSyncInput = {
      tenantId: input.tenantId.trim(),
      clientId: input.clientId.trim(),
      companyName: input.companyName.trim(),
    };

    const raw = await exportLedgers();
    const ledgers = mapLedgersFromTally(raw);

    const resp = await fetch(
      `${env.CLOUD_BASE_URL}/api/tally/sync/ledgers/ingest`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenantId: normalizedInput.tenantId,
          clientId: normalizedInput.clientId,
          companyName: normalizedInput.companyName,
          ledgers,
        }),
      },
    );

    if (!resp.ok) {
      throw new Error(await resp.text());
    }

    const ingest = await resp.json();

    return {
      count: ledgers.length,
      ingest,
    };
  }

  async syncVouchers(input: StartVoucherSyncInput) {
    assertBase(input);
    assertDateRange(input);

    const normalizedInput: StartVoucherSyncInput = {
      tenantId: input.tenantId.trim(),
      clientId: input.clientId.trim(),
      companyName: input.companyName.trim(),
      fromDate: input.fromDate,
      toDate: input.toDate,
    };

    const raw = await exportVouchers({
      companyName: normalizedInput.companyName,
      fromDate: normalizedInput.fromDate,
      toDate: normalizedInput.toDate,
    });

    const tallymessageLen = Array.isArray((raw as any)?.data?.tallymessage)
      ? (raw as any).data.tallymessage.length
      : null;

    console.log("Tally voucher tallymessage length:", tallymessageLen);

    const vouchers = mapVouchersFromTally(raw);

    const resp = await fetch(
      `${env.CLOUD_BASE_URL}/api/tally/sync/vouchers/ingest`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenantId: normalizedInput.tenantId,
          clientId: normalizedInput.clientId,
          companyName: normalizedInput.companyName,
          fromDate: normalizedInput.fromDate,
          toDate: normalizedInput.toDate,
          vouchers,
        }),
      },
    );

    if (!resp.ok) {
      throw new Error(await resp.text());
    }

    const ingest = await resp.json();

    return {
      count: vouchers.length,
      ingest,
    };
  }

  async syncBalanceSheet(input: StartBalanceSheetSyncInput) {
    assertBase(input);
    assertDateRange(input);

    const normalizedInput: StartBalanceSheetSyncInput = {
      tenantId: input.tenantId.trim(),
      clientId: input.clientId.trim(),
      companyName: input.companyName.trim(),
      fromDate: input.fromDate,
      toDate: input.toDate,
    };

    const raw = await exportBalanceSheet({
      companyName: normalizedInput.companyName,
      fromDate: normalizedInput.fromDate,
      toDate: normalizedInput.toDate,
    });

    const resp = await fetch(
      `${env.CLOUD_BASE_URL}/api/tally/sync/balance-sheet/ingest`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenantId: normalizedInput.tenantId,
          clientId: normalizedInput.clientId,
          companyName: normalizedInput.companyName,
          fromDate: normalizedInput.fromDate,
          toDate: normalizedInput.toDate,
          raw,
        }),
      },
    );

    if (!resp.ok) {
      throw new Error(await resp.text());
    }

    const ingest = await resp.json();

    return { ingest };
  }

  async syncProfitLoss(input: StartBalanceSheetSyncInput) {
    assertBase(input);
    assertDateRange(input);

    const normalizedInput: StartBalanceSheetSyncInput = {
      tenantId: input.tenantId.trim(),
      clientId: input.clientId.trim(),
      companyName: input.companyName.trim(),
      fromDate: input.fromDate,
      toDate: input.toDate,
    };

    const raw = await exportProfitAndLoss({
      companyName: normalizedInput.companyName,
      fromDate: normalizedInput.fromDate,
      toDate: normalizedInput.toDate,
    });

    const resp = await fetch(
      `${env.CLOUD_BASE_URL}/api/tally/sync/profit-loss/ingest`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenantId: normalizedInput.tenantId,
          clientId: normalizedInput.clientId,
          companyName: normalizedInput.companyName,
          fromDate: normalizedInput.fromDate,
          toDate: normalizedInput.toDate,
          raw,
        }),
      },
    );

    if (!resp.ok) {
      throw new Error(await resp.text());
    }

    return await resp.json();
  }

  async syncTrialBalance(input: StartBalanceSheetSyncInput) {
    assertBase(input);
    assertDateRange(input);

    const normalizedInput: StartBalanceSheetSyncInput = {
      tenantId: input.tenantId.trim(),
      clientId: input.clientId.trim(),
      companyName: input.companyName.trim(),
      fromDate: input.fromDate,
      toDate: input.toDate,
    };

    const raw = await exportTrialBalance({
      companyName: normalizedInput.companyName,
      fromDate: normalizedInput.fromDate,
      toDate: normalizedInput.toDate,
    });

    const resp = await fetch(
      `${env.CLOUD_BASE_URL}/api/tally/sync/trial-balance/ingest`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenantId: normalizedInput.tenantId,
          clientId: normalizedInput.clientId,
          companyName: normalizedInput.companyName,
          fromDate: normalizedInput.fromDate,
          toDate: normalizedInput.toDate,
          raw,
        }),
      },
    );

    if (!resp.ok) {
      throw new Error(await resp.text());
    }

    return await resp.json();
  }
}
