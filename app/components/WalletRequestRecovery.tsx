"use client";

import { useEffect } from "react";
import {
  clearWalletRequest,
  markWalletRequestReloaded,
  readWalletRequest,
  WALLET_REQUEST_EVENT,
} from "../lib/walletRequestRecovery";

const WALLET_REQUEST_MAX_AGE_MS = 45_000;
const WALLET_REQUEST_RELOAD_AFTER_MS = 12_000;
const WALLET_REQUEST_CLEAR_AFTER_RELOAD_MS = 4_000;

export function WalletRequestRecovery() {
  useEffect(() => {
    let reloadTimer: number | null = null;

    const clearReloadTimer = () => {
      if (reloadTimer !== null) {
        window.clearTimeout(reloadTimer);
        reloadTimer = null;
      }
    };

    const sync = () => {
      const state = readWalletRequest();
      if (!state) {
        document.documentElement.removeAttribute("data-wallet-request");
        clearReloadTimer();
        return;
      }

      const age = Date.now() - state.startedAt;
      if (age > WALLET_REQUEST_MAX_AGE_MS) {
        clearWalletRequest();
        clearReloadTimer();
        return;
      }

      document.documentElement.setAttribute("data-wallet-request", "true");

      if (state.reloadedAt) {
        if (Date.now() - state.reloadedAt > WALLET_REQUEST_CLEAR_AFTER_RELOAD_MS) {
          clearWalletRequest();
        }
        return;
      }

      if (
        age >= WALLET_REQUEST_RELOAD_AFTER_MS &&
        document.visibilityState === "visible" &&
        document.hasFocus() &&
        reloadTimer === null
      ) {
        reloadTimer = window.setTimeout(() => {
          const latest = readWalletRequest();
          if (!latest?.reloadedAt) {
            markWalletRequestReloaded(latest ?? state);
            window.location.reload();
          }
        }, 800);
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") sync();
    };

    sync();
    const interval = window.setInterval(sync, 1_000);
    window.addEventListener("focus", sync);
    window.addEventListener("pageshow", sync);
    window.addEventListener(WALLET_REQUEST_EVENT, sync);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearInterval(interval);
      clearReloadTimer();
      window.removeEventListener("focus", sync);
      window.removeEventListener("pageshow", sync);
      window.removeEventListener(WALLET_REQUEST_EVENT, sync);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return null;
}
