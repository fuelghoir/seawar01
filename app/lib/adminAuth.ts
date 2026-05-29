import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { createHmac, timingSafeEqual } from "crypto";

const ADMIN_COOKIE = "sea_admin_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12;
const WALLET_RE = /^0x[a-f0-9]{40}$/;
const BUILT_IN_ADMIN_WALLETS = ["0xa4df87d8940ac70ac8a33db79bb1057238b490e4"];

type AdminSessionPayload = {
  address: string;
  exp: number;
};

export function normalizeAdminWallet(value: unknown) {
  const wallet = String(value ?? "").trim().toLowerCase();
  return WALLET_RE.test(wallet) ? wallet : null;
}

export function adminWallets() {
  const configuredWallets = (process.env.ADMIN_WALLETS || process.env.ADMIN_WALLET || "")
    .split(/[,\s]+/)
    .map((wallet) => normalizeAdminWallet(wallet))
    .filter(Boolean) as string[];

  return Array.from(new Set([...configuredWallets, ...BUILT_IN_ADMIN_WALLETS]));
}

export function isAdminWallet(wallet: string) {
  return adminWallets().includes(wallet.toLowerCase());
}

export function buildAdminLoginMessage(wallet: string) {
  return [
    "Sea Battle admin login",
    `Wallet: ${wallet.toLowerCase()}`,
    `Date: ${new Date().toISOString().slice(0, 10)}`,
  ].join("\n");
}

export function adminSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for admin actions");
  }
  return createClient(url, serviceKey);
}

export async function setAdminSession(address: string) {
  const payload: AdminSessionPayload = {
    address: address.toLowerCase(),
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };

  const cookieStore = await cookies();
  cookieStore.set(ADMIN_COOKIE, signPayload(payload), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearAdminSession() {
  const cookieStore = await cookies();
  cookieStore.set(ADMIN_COOKIE, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export async function getAdminSession() {
  const cookieStore = await cookies();
  const raw = cookieStore.get(ADMIN_COOKIE)?.value;
  const payload = raw ? readPayload(raw) : null;
  if (!payload) return null;
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  if (!isAdminWallet(payload.address)) return null;
  return payload;
}

export async function requireAdminSession() {
  const session = await getAdminSession();
  if (!session) throw new Error("Admin login required");
  return session;
}

function sessionSecret() {
  return process.env.ADMIN_SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
}

function signPayload(payload: AdminSessionPayload) {
  const secret = sessionSecret();
  if (!secret) throw new Error("ADMIN_SESSION_SECRET is required");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function readPayload(value: string): AdminSessionPayload | null {
  const secret = sessionSecret();
  if (!secret) return null;

  const [body, sig] = value.split(".");
  if (!body || !sig) return null;

  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const sigBuffer = Buffer.from(sig);
  const expectedBuffer = Buffer.from(expected);
  if (
    sigBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(sigBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    const address = normalizeAdminWallet(payload?.address);
    const exp = Number(payload?.exp);
    if (!address || !Number.isFinite(exp)) return null;
    return { address, exp };
  } catch {
    return null;
  }
}
