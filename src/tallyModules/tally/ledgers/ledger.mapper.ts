import { NormalizedLedger, TallyLedgerExport } from "./ledger.types";

const trimOrNull = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length ? s : null;
};

export const mapLedgersFromTally = (raw: unknown): NormalizedLedger[] => {
  const doc = raw as TallyLedgerExport;
  const items = doc?.data?.collection ?? [];

  return items
    .map((x) => {
      const name = trimOrNull(x?.metadata?.name);
      if (!name) return null;

      return {
        name,
        parent: trimOrNull(x?.parent?.value),
        closingBalance: trimOrNull(x?.closingbalance?.value),
        openingBalance: trimOrNull(x?.ledopeningbalance?.value),
        reservedName: trimOrNull(x?.metadata?.reservedname),
      } satisfies NormalizedLedger;
    })
    .filter((x): x is NormalizedLedger => Boolean(x));
};
