import type { Lang } from "./settings";

export const ONBOARDING_TOUR_VERSION = 1;

export const ONBOARDING_STEPS = [
  "language",
  "briefing",
  "deployment",
  "targeting",
  "result",
  "checkin",
  "complete",
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];
export type OnboardingStatusKind =
  | "pending"
  | "in_progress"
  | "completed"
  | "grandfathered"
  | "unavailable";

export type OnboardingStatus = {
  required: boolean;
  version: number;
  status: OnboardingStatusKind;
  step: OnboardingStep;
  language: Lang | null;
  skippedGameplay: boolean;
  persistence?: "server" | "local";
};

const LOCAL_STORAGE_PREFIX = "sea-battle-onboarding";

const FALLBACK_STATUS: OnboardingStatus = {
  required: false,
  version: ONBOARDING_TOUR_VERSION,
  status: "unavailable",
  step: "complete",
  language: null,
  skippedGameplay: false,
};

export async function getOnboardingStatus(wallet: string): Promise<OnboardingStatus> {
  try {
    const remote = await onboardingRequest(
      `/api/onboarding?wallet=${encodeURIComponent(wallet)}`,
      { method: "GET" },
    );
    if (remote.persistence === "local") {
      const saved = readLocalStatus(wallet);
      if (saved) return saved;
      return persistLocalStatus(wallet, remote);
    }
    return remote;
  } catch {
    // A missing migration must never lock an existing player out of the app.
    return readLocalStatus(wallet) ?? FALLBACK_STATUS;
  }
}

export async function saveOnboardingProgress(
  wallet: string,
  step: OnboardingStep,
  language?: Lang,
) {
  try {
    return persistLocalStatus(wallet, await onboardingRequest("/api/onboarding", {
      method: "POST",
      body: JSON.stringify({ action: "progress", wallet, step, language }),
    }));
  } catch (error) {
    const saved = readLocalStatus(wallet);
    if (!saved || saved.persistence !== "local") throw error;
    return persistLocalStatus(wallet, {
      ...saved,
      required: true,
      status: step === "language" ? "pending" : "in_progress",
      step,
      language: language ?? saved.language,
    });
  }
}

export async function skipOnboardingGameplay(wallet: string, language?: Lang) {
  return persistLocalStatus(wallet, await onboardingRequest("/api/onboarding", {
    method: "POST",
    body: JSON.stringify({ action: "skip", wallet, language }),
  }));
}

export async function completeOnboarding(wallet: string) {
  return persistLocalStatus(wallet, await onboardingRequest("/api/onboarding", {
    method: "POST",
    body: JSON.stringify({ action: "complete", wallet }),
  }));
}

export async function dismissOnboarding(wallet: string) {
  return persistLocalStatus(wallet, await onboardingRequest("/api/onboarding", {
    method: "POST",
    body: JSON.stringify({ action: "dismiss", wallet }),
  }));
}

async function onboardingRequest(url: string, init: RequestInit) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 3_500);
  try {
    const response = await fetch(url, {
      ...init,
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.error || "Could not save training progress");
    }
    return payload as OnboardingStatus;
  } finally {
    window.clearTimeout(timeout);
  }
}

function localStorageKey(wallet: string) {
  return `${LOCAL_STORAGE_PREFIX}:v${ONBOARDING_TOUR_VERSION}:${wallet.toLowerCase()}`;
}

function readLocalStatus(wallet: string): OnboardingStatus | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(localStorageKey(wallet));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OnboardingStatus>;
    if (
      parsed.version !== ONBOARDING_TOUR_VERSION ||
      !ONBOARDING_STEPS.includes(parsed.step as OnboardingStep) ||
      (parsed.status !== "pending" && parsed.status !== "in_progress" && parsed.status !== "completed")
    ) return null;
    return parsed as OnboardingStatus;
  } catch {
    return null;
  }
}

function persistLocalStatus(wallet: string, status: OnboardingStatus) {
  if (status.persistence !== "local" || typeof window === "undefined") return status;
  try {
    window.localStorage.setItem(localStorageKey(wallet), JSON.stringify(status));
  } catch {
    // Private browsing or a full storage quota should not break the tutorial session.
  }
  return status;
}
