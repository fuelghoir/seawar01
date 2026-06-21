const DEFAULT_PUBLIC_URL = "https://seabattle.top";
const WALLET_RE = /^0x[a-f0-9]{40}$/;

export function getPublicAppUrl() {
  const configured =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "") ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");

  if (configured) return configured.replace(/\/$/, "");
  if (typeof window !== "undefined") return window.location.origin;
  return DEFAULT_PUBLIC_URL;
}

export function normalizePublicWallet(value: string | null | undefined) {
  const wallet = value?.trim().toLowerCase();
  return wallet && WALLET_RE.test(wallet) ? wallet : null;
}

export function buildPublicReferralUrl(wallet: string, path = "/") {
  const ref = normalizePublicWallet(wallet);
  const url = new URL(path, getPublicAppUrl());
  if (ref) url.searchParams.set("ref", ref);
  return url.toString();
}

export function buildPublicProfileShareUrl(wallet: string) {
  const ref = normalizePublicWallet(wallet);
  const path = ref ? `/share/profile/${ref}` : "/";
  return buildPublicReferralUrl(wallet, path);
}

export function shortWallet(wallet: string) {
  const normalized = normalizePublicWallet(wallet);
  return normalized ? `${normalized.slice(0, 6)}...${normalized.slice(-4)}` : "Captain";
}
