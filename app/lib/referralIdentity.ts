export const REFERRAL_WALLET_RE = /^0x[a-f0-9]{40}$/;
export const REFERRAL_CODE_RE = /^[a-z0-9][a-z0-9_-]{2,31}$/;

export function normalizeReferralWallet(value: unknown): string | null {
  const wallet = String(value ?? "").trim().toLowerCase();
  return REFERRAL_WALLET_RE.test(wallet) ? wallet : null;
}

export function normalizeReferralCode(value: unknown): string | null {
  const code = String(value ?? "").trim().toLowerCase();
  return REFERRAL_CODE_RE.test(code) ? code : null;
}

export function normalizeReferralToken(value: unknown): string | null {
  return normalizeReferralWallet(value) ?? normalizeReferralCode(value);
}

export function buildReferralRecordMessage(
  refValue: unknown,
  refereeValue: unknown,
  issuedAtValue: unknown,
): string | null {
  const ref = normalizeReferralToken(refValue);
  const referee = normalizeReferralWallet(refereeValue);
  const issuedAt = Number(issuedAtValue);
  if (!ref || !referee || !Number.isSafeInteger(issuedAt) || issuedAt <= 0) return null;

  return [
    "Sea Battle referral confirmation",
    `Ref: ${ref}`,
    `Referee: ${referee}`,
    `Issued at: ${issuedAt}`,
  ].join("\n");
}
