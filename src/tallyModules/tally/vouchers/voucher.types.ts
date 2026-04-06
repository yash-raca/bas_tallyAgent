export type NormalizedVoucher = {
  voucherType: string;
  voucherNo: string | null;
  voucherDate: string | null;
  narration: string | null;
  tallyGuid: string | null;
  amount: number | null; // ✅ NEW
  partyName: string | null; // ✅ NEW (bonus)
};

export type TallyVoucherEnvelope = {
  status?: string;
  data?: {
    tallymessage?: Array<Record<string, unknown>>;
  };
};
