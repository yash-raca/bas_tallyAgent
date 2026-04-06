export type NormalizedLedger = {
  name: string;
  parent: string | null;
  closingBalance: string | null;
  openingBalance: string | null;
  reservedName: string | null;
};

export type TallyLedgerExport = {
  status?: string;
  data?: {
    collection?: Array<{
      metadata?: { name?: string; reservedname?: string };
      parent?: { value?: string };
      closingbalance?: { value?: string };
      ledopeningbalance?: { value?: string };
    }>;
  };
};
