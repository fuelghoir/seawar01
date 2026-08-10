"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAccount } from "wagmi";
import {
  completeOnboarding,
  dismissOnboarding,
  getOnboardingStatus,
  saveOnboardingProgress,
  type OnboardingStatus,
  type OnboardingStep,
} from "../lib/onboarding";
import { useSettings, type Lang } from "../lib/settings";

const RETRY_DELAYS_MS = [1_200, 3_000] as const;

export type OnboardingContextValue = {
  status: OnboardingStatus | null;
  loaded: boolean;
  progress: (step: OnboardingStep, language?: Lang) => Promise<OnboardingStatus>;
  dismiss: () => Promise<OnboardingStatus>;
  complete: () => Promise<OnboardingStatus>;
  refresh: () => Promise<OnboardingStatus | null>;
  setStatus: (status: OnboardingStatus | null) => void;
};

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export function useOnboarding(): OnboardingContextValue {
  const context = useContext(OnboardingContext);
  if (!context) {
    throw new Error("useOnboarding must be used within OnboardingProvider");
  }
  return context;
}

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const { address } = useAccount();
  const { lang, setLang } = useSettings();
  const [status, setStatusState] = useState<OnboardingStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const addressRef = useRef(address);
  const statusRef = useRef(status);
  const langRef = useRef(lang);

  addressRef.current = address;
  statusRef.current = status;
  langRef.current = lang;

  const applyStatus = useCallback((next: OnboardingStatus | null) => {
    statusRef.current = next;
    setStatusState(next);
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (status?.language && status.language !== lang) setLang(status.language);
  }, [lang, setLang, status?.language]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | undefined;
    const wallet = address;

    if (!wallet) {
      applyStatus(null);
      return;
    }

    setLoaded(false);
    setStatusState(null);
    statusRef.current = null;

    const load = async (attempt = 0) => {
      const next = await getOnboardingStatus(wallet);
      if (cancelled || addressRef.current?.toLowerCase() !== wallet.toLowerCase()) return;
      applyStatus(next);

      const delay = RETRY_DELAYS_MS[attempt];
      if (next.status === "unavailable" && delay !== undefined) {
        retryTimer = window.setTimeout(() => void load(attempt + 1), delay);
      }
    };

    void load();
    return () => {
      cancelled = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [address, applyStatus]);

  const requireWallet = useCallback(() => {
    const wallet = addressRef.current;
    if (!wallet) throw new Error("Connect a wallet to continue training");
    return wallet;
  }, []);

  const progress = useCallback(async (step: OnboardingStep, language?: Lang) => {
    const wallet = requireWallet();
    const next = await saveOnboardingProgress(
      wallet,
      step,
      language ?? statusRef.current?.language ?? langRef.current,
    );
    if (addressRef.current?.toLowerCase() === wallet.toLowerCase()) applyStatus(next);
    return next;
  }, [applyStatus, requireWallet]);

  const dismiss = useCallback(async () => {
    const wallet = requireWallet();
    const next = await dismissOnboarding(wallet);
    if (addressRef.current?.toLowerCase() === wallet.toLowerCase()) applyStatus(next);
    return next;
  }, [applyStatus, requireWallet]);

  const complete = useCallback(async () => {
    const wallet = requireWallet();
    const next = await completeOnboarding(wallet);
    if (addressRef.current?.toLowerCase() === wallet.toLowerCase()) applyStatus(next);
    return next;
  }, [applyStatus, requireWallet]);

  const refresh = useCallback(async () => {
    const wallet = addressRef.current;
    if (!wallet) {
      applyStatus(null);
      return null;
    }
    const next = await getOnboardingStatus(wallet);
    if (addressRef.current?.toLowerCase() === wallet.toLowerCase()) applyStatus(next);
    return next;
  }, [applyStatus]);

  const value = useMemo<OnboardingContextValue>(() => ({
    status,
    loaded,
    progress,
    dismiss,
    complete,
    refresh,
    setStatus: applyStatus,
  }), [applyStatus, complete, dismiss, loaded, progress, refresh, status]);

  return (
    <OnboardingContext.Provider value={value}>
      {children}
    </OnboardingContext.Provider>
  );
}
