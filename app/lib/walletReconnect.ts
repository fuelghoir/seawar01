"use client";

const WALLET_RECONNECT_KEY = "sea-battle-wallet-reconnect";
const WAGMI_RECENT_CONNECTOR_COOKIE = "wagmi.recentConnectorId";

function hasCookie(name: string) {
  if (typeof document === "undefined") return false;
  return document.cookie.split("; ").some((part) => part.startsWith(`${name}=`));
}

function removeCookie(name: string) {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=;max-age=0;path=/;samesite=Lax`;
}

export function shouldReconnectWalletOnMount() {
  if (typeof window === "undefined") return false;

  try {
    const preference = window.localStorage.getItem(WALLET_RECONNECT_KEY);
    if (preference === "1") return true;
    if (preference === "0") return false;
  } catch {
    return hasCookie(WAGMI_RECENT_CONNECTOR_COOKIE);
  }

  // Existing users already have wagmi's cookie, but not our new preference yet.
  return hasCookie(WAGMI_RECENT_CONNECTOR_COOKIE);
}

export function rememberWalletReconnectPreference() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WALLET_RECONNECT_KEY, "1");
  } catch {
    // Storage can be blocked in some in-app browsers.
  }
}

export function forgetWalletReconnectPreference() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WALLET_RECONNECT_KEY, "0");
  } catch {
    // Storage can be blocked in some in-app browsers.
  }
  removeCookie(WAGMI_RECENT_CONNECTOR_COOKIE);
}
