import { TallyHttpClient } from "./tally.http";
import { env } from "../../config/env";

const http = new TallyHttpClient(env.TALLY_BASE_URL);

const TALLY_HEADERS = {
  "content-type": "application/json",
  version: "1",
  tallyrequest: "export",
} as const;

const REPORT_DAY_BOOK = "Day Book" as const;
const COLLECTION_LEDGER = "Ledger" as const;
const COLLECTION_VOUCHERS = "Voucher" as const;

// Optional: keep Day Book export for manual debugging, but do not use for sync.
export const exportLedgers = async () => {
  return http.post(
    {
      ...TALLY_HEADERS,
      type: "collection",
      id: COLLECTION_LEDGER,
    },
    {},
  );
};

type VoucherExportInput = {
  companyName: string;
  fromDate?: string; // YYYYMMDD
  toDate?: string; // YYYYMMDD
};

const buildStaticVars = (
  input: VoucherExportInput,
): Record<string, unknown> => {
  const staticVars: Record<string, unknown> = {
    SVCURRENTCOMPANY: input.companyName,
  };

  if (input.fromDate && input.toDate) {
    // For collections, string YYYYMMDD works reliably in most setups.
    staticVars.SVFROMDATE = input.fromDate;
    staticVars.SVTODATE = input.toDate;
  }

  return staticVars;
};

/**
 * Production export: Vouchers via collection.
 * This avoids report-context issues where Day Book ignores SVFROMDATE/SVTODATE.
 */
export const exportVouchers = async (input: VoucherExportInput) => {
  return http.post(
    {
      ...TALLY_HEADERS,
      type: "data",
      id: "Voucher Register", // ← built-in range report
    },
    {
      ENVELOPE: {
        HEADER: {
          VERSION: "1",
          TALLYREQUEST: "Export",
          TYPE: "Data",
          ID: "Voucher Register",
        },
        BODY: {
          DESC: {
            STATICVARIABLES: buildStaticVars(input),
          },
        },
      },
    },
  );
};

/**
 * Debug-only: Day Book export.
 * Keep it if you want to compare outputs, but don’t use it for syncing.
 */
export const exportVouchersDayBook = async (input: VoucherExportInput) => {
  const staticVars: Record<string, unknown> = {
    ...buildStaticVars(input),

    // Report export options (works, but date range is not being honored in your environment)
    SVExportInPlainFormat: "Yes",
    EXPLODEFLAG: "Yes",
    SVEXPORTFORMAT: "$$SysName:JSON",
  };

  return http.post(
    {
      ...TALLY_HEADERS,
      type: "data",
      id: REPORT_DAY_BOOK,
    },
    {
      ENVELOPE: {
        HEADER: {
          VERSION: "1",
          TALLYREQUEST: "Export",
          TYPE: "Data",
          ID: REPORT_DAY_BOOK,
        },
        BODY: {
          DESC: {
            STATICVARIABLES: staticVars,
          },
        },
      },
    },
  );
};

type ReportExportInput = {
  companyName: string;
  fromDate?: string; // YYYYMMDD (optional; depends on report)
  toDate?: string; // YYYYMMDD
};

export const exportBalanceSheet = async (input: ReportExportInput) => {
  const staticVars: Record<string, unknown> = {
    SVCURRENTCOMPANY: input.companyName,
    // TallyHelp: enable plain JSON by setting SVExportInPlainFormat in static variables [web:1]
    SVExportInPlainFormat: "Yes",
    SVEXPORTFORMAT: "$$SysName:JSON",
  };

  if (input.fromDate && input.toDate) {
    staticVars.SVFROMDATE = input.fromDate;
    staticVars.SVTODATE = input.toDate;
  }

  return http.post(
    {
      "content-type": "application/json",
      version: "1",
      tallyrequest: "export",
      type: "data",
      id: "Balance Sheet",
    },
    {
      ENVELOPE: {
        HEADER: {
          VERSION: "1",
          TALLYREQUEST: "Export",
          TYPE: "Data",
          ID: "Balance Sheet",
        },
        BODY: {
          DESC: {
            STATICVARIABLES: staticVars,
          },
        },
      },
    },
  );
};

export const exportProfitAndLoss = async (input: ReportExportInput) => {
  const staticVars: Record<string, unknown> = {
    SVCURRENTCOMPANY: input.companyName,
    SVExportInPlainFormat: "Yes",
    SVEXPORTFORMAT: "$$SysName:JSON",
  };

  if (input.fromDate && input.toDate) {
    staticVars.SVFROMDATE = input.fromDate;
    staticVars.SVTODATE = input.toDate;
  }

  return http.post(
    {
      "content-type": "application/json",
      version: "1",
      tallyrequest: "export",
      type: "data",
      id: "Profit & Loss A/c",
    },
    {
      ENVELOPE: {
        HEADER: {
          VERSION: "1",
          TALLYREQUEST: "Export",
          TYPE: "Data",
          ID: "Profit & Loss A/c",
        },
        BODY: { DESC: { STATICVARIABLES: staticVars } },
      },
    },
  );
};

export const exportTrialBalance = async (input: ReportExportInput) => {
  const staticVars: Record<string, unknown> = {
    SVCURRENTCOMPANY: input.companyName,
    SVExportInPlainFormat: "Yes",
    SVEXPORTFORMAT: "$$SysName:JSON",
  };

  if (input.fromDate && input.toDate) {
    staticVars.SVFROMDATE = input.fromDate;
    staticVars.SVTODATE = input.toDate;
  }

  return http.post(
    {
      "content-type": "application/json",
      version: "1",
      tallyrequest: "export",
      type: "data",
      id: "Trial Balance",
    },
    {
      ENVELOPE: {
        HEADER: {
          VERSION: "1",
          TALLYREQUEST: "Export",
          TYPE: "Data",
          ID: "Trial Balance",
        },
        BODY: { DESC: { STATICVARIABLES: staticVars } },
      },
    },
  );
};
