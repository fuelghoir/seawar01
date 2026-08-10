export const STARTER_PACK_WEEK_KEY = "onboarding-v2";
// The final Torpedo marker proves the ordered Radar -> Torpedo loadout is done.
// Kept as a named export for the onboarding state API.
export const STARTER_PACK_LEDGER_SLUG = "torpedo";
export const STARTER_PACK_ITEM_SLUGS = ["radar_scan", "torpedo"] as const;
const STARTER_PACK_TIMEOUT_MS = 4_500;

export type StarterPackItemSlug = (typeof STARTER_PACK_ITEM_SLUGS)[number];

export type StarterPackQuantities = Record<StarterPackItemSlug, number>;

export type StarterPackClaims = Record<StarterPackItemSlug, boolean>;

export type StarterPackStatus = {
  eligible: boolean;
  complete: boolean;
  nextItem: StarterPackItemSlug | null;
  claims: StarterPackClaims;
  quantities: StarterPackQuantities;
  alreadyClaimed?: boolean;
};

const WALLET_RE = /^0x[a-f0-9]{40}$/;

export function normalizeStarterPackWallet(value: unknown): string | null {
  const wallet = String(value ?? "").trim().toLowerCase();
  return WALLET_RE.test(wallet) ? wallet : null;
}

export function normalizeStarterPackItem(value: unknown): StarterPackItemSlug | null {
  const slug = String(value ?? "");
  return STARTER_PACK_ITEM_SLUGS.includes(slug as StarterPackItemSlug)
    ? slug as StarterPackItemSlug
    : null;
}

export async function getStarterPackStatus(
  wallet: string,
  signal?: AbortSignal,
): Promise<StarterPackStatus> {
  const normalized = normalizeStarterPackWallet(wallet);
  if (!normalized) throw new Error("Invalid wallet");

  return starterPackRequest(
    `/api/onboarding/starter-pack?wallet=${encodeURIComponent(normalized)}`,
    { method: "GET", signal },
  );
}

export async function claimStarterPackItem(
  wallet: string,
  itemSlug: StarterPackItemSlug,
): Promise<StarterPackStatus> {
  const normalized = normalizeStarterPackWallet(wallet);
  const item = normalizeStarterPackItem(itemSlug);
  if (!normalized) throw new Error("Invalid wallet");
  if (!item) throw new Error("Invalid starter item");

  return starterPackRequest("/api/onboarding/starter-pack", {
    method: "POST",
    body: JSON.stringify({ wallet: normalized, itemSlug: item }),
  });
}

async function starterPackRequest(
  url: string,
  init: RequestInit,
): Promise<StarterPackStatus> {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort();
  if (init.signal?.aborted) controller.abort();
  else init.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, STARTER_PACK_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.error || "Starter item is unavailable");
    }
    return payload as StarterPackStatus;
  } catch (error) {
    if (timedOut) throw new Error("Starter item request timed out");
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
    init.signal?.removeEventListener("abort", abortFromCaller);
  }
}
