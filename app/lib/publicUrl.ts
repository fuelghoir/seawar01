import {
  normalizeReferralToken,
  normalizeReferralWallet,
} from "./referralIdentity";

const DEFAULT_PUBLIC_URL = "https://seabattle.top";

export function getPublicAppUrl() {
  const configured =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_URL;

  if (configured) return configured.replace(/\/$/, "");
  if (process.env.VERCEL_ENV === "production") return DEFAULT_PUBLIC_URL;

  const vercelUrl =
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "") ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");

  if (vercelUrl) return vercelUrl.replace(/\/$/, "");
  if (typeof window !== "undefined") return window.location.origin;
  return DEFAULT_PUBLIC_URL;
}

export function buildPublicPromoUrl(code: string) {
  return new URL(`/promo/${encodeURIComponent(code)}`, getPublicAppUrl()).toString();
}

export function buildPublicPromoShopUrl(code: string) {
  const url = new URL("/shop", getPublicAppUrl());
  url.searchParams.set("code", code);
  return url.toString();
}

export function buildBaseAppMiniAppUrl(targetUrl: string) {
  const url = new URL(targetUrl, getPublicAppUrl());
  return `https://base.app/app/${encodeURIComponent(url.toString())}`;
}

export function normalizePublicWallet(value: string | null | undefined) {
  return normalizeReferralWallet(value);
}

export function buildPublicReferralUrl(refValue: string, path = "/") {
  const ref = normalizeReferralToken(refValue);
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
