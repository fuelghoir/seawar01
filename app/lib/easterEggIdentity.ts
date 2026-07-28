import { normalizeReferralWallet } from "./referralIdentity";

export function buildEasterEggClaimMessage(
  walletValue: unknown,
  issuedAtValue: unknown,
): string | null {
  const wallet = normalizeReferralWallet(walletValue);
  const issuedAt = Number(issuedAtValue);
  if (!wallet || !Number.isSafeInteger(issuedAt) || issuedAt <= 0) return null;

  return [
    "Sea Battle Easter Egg claim",
    `Wallet: ${wallet}`,
    `Issued at: ${issuedAt}`,
  ].join("\n");
}
