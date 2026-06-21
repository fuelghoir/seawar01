"use client";

import { useEffect, useState } from "react";

const DEFAULT_TRANSACTION_WARMUP_MS = 2200;

export function useTransactionWarmup(
  isConnected: boolean,
  identity?: string | null,
  delayMs = DEFAULT_TRANSACTION_WARMUP_MS
) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!isConnected) {
      setReady(false);
      return;
    }

    setReady(false);
    const timer = window.setTimeout(() => setReady(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, identity, isConnected]);

  return ready;
}
