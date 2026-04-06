import type { NormalizedVoucher, TallyVoucherEnvelope } from "./voucher.types";

const trimOrNull = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length ? s : null;
};

const asRecord = (v: unknown): Record<string, unknown> | null => {
  if (v && typeof v === "object" && !Array.isArray(v))
    return v as Record<string, unknown>;
  return null;
};

const pickString = (obj: Record<string, unknown>, key: string): string | null =>
  trimOrNull(obj[key]);

const pickFirstString = (
  obj: Record<string, unknown>,
  keys: string[],
): string | null => {
  for (const k of keys) {
    const v = pickString(obj, k);
    if (v) return v;
  }
  return null;
};

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const notNull = <T>(v: T | null | undefined): v is T => v != null;

// ✅ NEW: Extract total invoice amount from party ledger entry
const extractVoucherAmount = (obj: Record<string, unknown>): number | null => {
  const entries = asArray(obj["ledgerentries"]);
  for (const e of entries) {
    const entry = asRecord(e);
    if (!entry) continue;
    // Party ledger (ispartyledger: true) holds the full invoice total
    if (entry["ispartyledger"] === true) {
      const raw = entry["amount"];
      const n =
        typeof raw === "string"
          ? parseFloat(raw)
          : typeof raw === "number"
            ? raw
            : null;
      if (n !== null && !isNaN(n)) return Math.abs(n); // Always store as positive
    }
  }
  return null;
};

const extractCandidates = (raw: unknown): Record<string, unknown>[] => {
  const doc = raw as TallyVoucherEnvelope;
  const dataAny = (doc as any)?.data ?? doc;

  const msgs = asArray((dataAny as any)?.tallymessage);

  const out: Record<string, unknown>[] = [];
  for (const m of msgs) {
    const r = asRecord(m);
    if (r) out.push(r);

    if (r) {
      for (const key of ["vouchers", "voucher", "Voucher", "VOUCHER"]) {
        for (const n of asArray(r[key])) {
          const nr = asRecord(n);
          if (nr) out.push(nr);
        }
      }
    }
  }

  return out;
};

const looksLikeVoucherRow = (obj: Record<string, unknown>) => {
  const hasDate = Boolean(
    pickFirstString(obj, ["date", "voucherdate", "vchdate"]),
  );
  const hasType = Boolean(
    pickFirstString(obj, ["vouchertypename", "vouchertype", "vchtype"]),
  );
  const hasNo = Boolean(
    pickFirstString(obj, ["vouchernumber", "voucherno", "voucherNo"]),
  );
  return hasDate && (hasType || hasNo);
};

export const mapVouchersFromTally = (raw: unknown): NormalizedVoucher[] => {
  const rows = extractCandidates(raw);

  return rows
    .map((obj) => {
      if (!looksLikeVoucherRow(obj)) return null;

      const voucherType = pickFirstString(obj, [
        "vouchertypename",
        "vouchertype",
        "vchtype",
      ]);
      if (!voucherType) return null;

      const voucherNo = pickFirstString(obj, ["vouchernumber", "voucherno"]);
      const voucherDate = pickFirstString(obj, [
        "date",
        "voucherdate",
        "vchdate",
      ]);
      const narration = pickFirstString(obj, ["narration"]);

      const meta = asRecord(obj["metadata"]);
      const tallyGuid =
        pickFirstString(obj, ["guid", "remoteid", "remoteId"]) ??
        (meta ? pickFirstString(meta, ["remoteid", "guid"]) : null);

      // ✅ NEW: extract amount and partyName
      const amount = extractVoucherAmount(obj);
      const partyName = pickFirstString(obj, [
        "partyname",
        "partyledgername",
        "basicbuyername",
      ]);

      const mapped: NormalizedVoucher = {
        voucherType,
        voucherNo,
        voucherDate,
        narration,
        tallyGuid,
        amount, // ✅ NEW
        partyName, // ✅ NEW
      };

      return mapped;
    })
    .filter(notNull);
};
