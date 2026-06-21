const STORAGE_KEY = "sea_battle_wallet_request";
export const WALLET_REQUEST_EVENT = "sea-battle-wallet-request";

type WalletRequestState = {
  reason: string;
  path: string;
  startedAt: number;
  reloadedAt?: number;
};

export function markWalletRequestStarted(reason: string) {
  if (typeof window === "undefined") return;

  const state: WalletRequestState = {
    reason,
    path: window.location.pathname + window.location.search,
    startedAt: Date.now(),
  };
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  document.documentElement.setAttribute("data-wallet-request", "true");
  window.dispatchEvent(new Event(WALLET_REQUEST_EVENT));
}

export function markWalletRequestReloaded(state: WalletRequestState) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ ...state, reloadedAt: Date.now() })
  );
}

export function clearWalletRequest() {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(STORAGE_KEY);
  document.documentElement.removeAttribute("data-wallet-request");
  window.dispatchEvent(new Event(WALLET_REQUEST_EVENT));
}

export function readWalletRequest(): WalletRequestState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const state = JSON.parse(raw) as Partial<WalletRequestState>;
    if (!state.startedAt || !state.reason || !state.path) return null;
    return {
      reason: String(state.reason),
      path: String(state.path),
      startedAt: Number(state.startedAt),
      reloadedAt: state.reloadedAt ? Number(state.reloadedAt) : undefined,
    };
  } catch {
    return null;
  }
}
