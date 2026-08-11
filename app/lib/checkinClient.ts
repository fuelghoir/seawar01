"use client";

import { useEffect, useRef } from "react";
import {
  dailyCheckin,
  getCheckinStatus,
  type CheckinStatus,
} from "./offchainGame";
import { notifyPlayerDataRefresh } from "./playerDataEvents";

const CHECKIN_STORAGE_PREFIX = "sea-battle-checkin-confirmed";

type PendingCheckinRecoveryOptions = {
  wallet: string | null | undefined;
  enabled: boolean;
  onSettled: (status: CheckinStatus, wallet: string) => void;
  onExpired?: (wallet: string) => void;
};

type CheckinDayRolloverOptions = {
  wallet: string | null | undefined;
  onRollover: (wallet: string) => void;
};

export function markCheckinConfirmed(wallet: string) {
  writeMarker(wallet, `confirmed:${todayUtcKey()}`);
}

export function markCheckinPending(wallet: string) {
  writeMarker(wallet, `pending:${todayUtcKey()}`);
}

export function isCheckinPending(wallet: string) {
  return readMarker(wallet) === `pending:${todayUtcKey()}`;
}

export function applyConfirmedCheckin(
  wallet: string,
  status: CheckinStatus,
  confirmedTxKey: string | null = null,
): CheckinStatus {
  if (confirmedTxKey === checkinDayKey(wallet)) {
    return { ...status, canCheckin: false };
  }

  const marker = readMarker(wallet);
  if (
    marker === todayUtcKey() ||
    marker === `confirmed:${todayUtcKey()}` ||
    marker === `pending:${todayUtcKey()}`
  ) {
    return { ...status, canCheckin: false };
  }
  return status;
}

export function checkinDayKey(wallet: string) {
  return `${wallet.toLowerCase()}:${todayUtcKey()}`;
}

/**
 * Retries only the off-chain claim after the original request has failed or
 * after a reload finds a pending mined transaction. It never sends a wallet
 * transaction. Retries back off to once per minute while the tab stays open.
 */
export function usePendingCheckinRecovery({
  wallet,
  enabled,
  onSettled,
  onExpired,
}: PendingCheckinRecoveryOptions) {
  const settledRef = useRef(onSettled);
  const expiredRef = useRef(onExpired);
  const currentWalletRef = useRef(wallet?.toLowerCase() ?? null);
  currentWalletRef.current = wallet?.toLowerCase() ?? null;

  useEffect(() => {
    settledRef.current = onSettled;
    expiredRef.current = onExpired;
  }, [onExpired, onSettled]);

  useEffect(() => {
    if (!wallet || !enabled) return;

    const normalizedWallet = wallet.toLowerCase();
    const recoveryDay = todayUtcKey();
    let cancelled = false;
    let finished = false;
    let timer: number | null = null;
    let attempt = 0;

    const expire = () => {
      if (cancelled || finished) return;
      finished = true;
      expiredRef.current?.(normalizedWallet);
    };

    const hasCurrentPendingMarker = () => {
      if (cancelled || finished) return false;
      if (
        currentWalletRef.current !== normalizedWallet ||
        todayUtcKey() !== recoveryDay ||
        !isCheckinPending(normalizedWallet)
      ) {
        expire();
        return false;
      }
      return true;
    };

    const schedule = (delay: number) => {
      timer = window.setTimeout(run, delay);
    };

    const run = async () => {
      // A pending marker is written only after the wallet transaction has
      // mined. Never call the claim API without that proof for this wallet and
      // UTC day (for example after an account switch or another tab settling).
      if (!hasCurrentPendingMarker()) return;

      attempt += 1;
      let status: CheckinStatus | null = null;
      let settled = false;

      try {
        const result = await dailyCheckin(normalizedWallet);
        if (!hasCurrentPendingMarker()) return;
        status = await getCheckinStatus(normalizedWallet).catch(() => null);
        if (!hasCurrentPendingMarker()) return;
        status = status ?? {
          canCheckin: false,
          streak: result.streak,
          nextReward: 0,
        };
        settled = true;
      } catch {
        if (!hasCurrentPendingMarker()) return;
        status = await getCheckinStatus(normalizedWallet).catch(() => null);
        if (!hasCurrentPendingMarker()) return;
        settled = Boolean(status && !status.canCheckin);
      }

      if (!hasCurrentPendingMarker()) return;
      if (settled && status) {
        finished = true;
        markCheckinConfirmed(normalizedWallet);
        notifyPlayerDataRefresh();
        settledRef.current(
          applyConfirmedCheckin(normalizedWallet, status),
          normalizedWallet,
        );
        return;
      }

      const delay = Math.min(60_000, 4_000 * (2 ** Math.min(attempt, 4)));
      schedule(delay);
    };

    schedule(1_500);
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [enabled, wallet]);
}

/**
 * Keeps long-lived tabs aligned with the UTC day used by the check-in API.
 * The focus/visibility listeners also cover suspended mobile tabs whose
 * midnight timer did not run while the app was in the background.
 */
export function useCheckinDayRollover({
  wallet,
  onRollover,
}: CheckinDayRolloverOptions) {
  const rolloverRef = useRef(onRollover);

  useEffect(() => {
    rolloverRef.current = onRollover;
  }, [onRollover]);

  useEffect(() => {
    if (!wallet) return;

    const normalizedWallet = wallet.toLowerCase();
    let observedDay = todayUtcKey();
    let timer: number | null = null;

    const schedule = () => {
      if (timer !== null) window.clearTimeout(timer);
      const now = new Date();
      const nextUtcMidnight = Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + 1,
      );
      timer = window.setTimeout(checkDay, Math.max(250, nextUtcMidnight - Date.now() + 250));
    };

    const checkDay = () => {
      const currentDay = todayUtcKey();
      if (currentDay !== observedDay) {
        observedDay = currentDay;
        rolloverRef.current(normalizedWallet);
      }
      schedule();
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") checkDay();
    };

    schedule();
    window.addEventListener("focus", checkDay);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener("focus", checkDay);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [wallet]);
}

function markerKey(wallet: string) {
  return `${CHECKIN_STORAGE_PREFIX}:${wallet.toLowerCase()}`;
}

function writeMarker(wallet: string, value: string) {
  try {
    window.localStorage.setItem(markerKey(wallet), value);
  } catch {
    // The current page still keeps an in-memory guard when storage is blocked.
  }
}

function readMarker(wallet: string) {
  try {
    return window.localStorage.getItem(markerKey(wallet));
  } catch {
    return null;
  }
}

function todayUtcKey() {
  return new Date().toISOString().slice(0, 10);
}
