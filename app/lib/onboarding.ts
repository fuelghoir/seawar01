import type { Lang } from "./settings";

export const ONBOARDING_TOUR_VERSION = 2;

export const ONBOARDING_STEPS = [
  "language",
  "checkin",
  "loadout",
  "battle",
  "debrief",
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
const REQUEST_TIMEOUT_MS = 4_500;

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
    if (remote.persistence !== "local") return remote;

    const saved = readLocalStatus(wallet);
    if (saved) return saved;
    return persistLocalStatus(wallet, remote);
  } catch {
    // Onboarding is an enhancement. A cold function or missing migration must
    // never prevent the player from reaching the game.
    return readLocalStatus(wallet) ?? FALLBACK_STATUS;
  }
}

export async function saveOnboardingProgress(
  wallet: string,
  step: OnboardingStep,
  language?: Lang,
): Promise<OnboardingStatus> {
  const saved = readLocalStatus(wallet);
  if (saved?.persistence === "local") assertLocalTransition(saved, step);

  try {
    return persistLocalStatus(wallet, await onboardingRequest("/api/onboarding", {
      method: "POST",
      body: JSON.stringify({ action: "progress", wallet, step, language }),
    }));
  } catch (error) {
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

export async function completeOnboarding(wallet: string): Promise<OnboardingStatus> {
  const saved = readLocalStatus(wallet);
  if (saved?.persistence === "local" && saved.step !== "debrief" && saved.step !== "complete") {
    throw new Error("Finish the training battle first");
  }

  try {
    return persistLocalStatus(wallet, await onboardingRequest("/api/onboarding", {
      method: "POST",
      body: JSON.stringify({ action: "complete", wallet }),
    }));
  } catch (error) {
    if (!saved || saved.persistence !== "local" || saved.step !== "debrief") throw error;
    return persistLocalStatus(wallet, {
      ...saved,
      required: false,
      status: "completed",
      step: "complete",
    });
  }
}

export async function dismissOnboarding(wallet: string): Promise<OnboardingStatus> {
  const saved = readLocalStatus(wallet);
  try {
    return persistLocalStatus(wallet, await onboardingRequest("/api/onboarding", {
      method: "POST",
      body: JSON.stringify({ action: "dismiss", wallet }),
    }));
  } catch (error) {
    if (!saved || saved.persistence !== "local") throw error;
    return persistLocalStatus(wallet, {
      ...saved,
      required: false,
      status: "completed",
      step: "complete",
      skippedGameplay: true,
    });
  }
}

/** @deprecated Use dismissOnboarding. Kept for older page bundles during rollout. */
export const skipOnboardingGameplay = dismissOnboarding;

async function onboardingRequest(url: string, init: RequestInit): Promise<OnboardingStatus> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
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
    return normalizeStatus(payload);
  } finally {
    window.clearTimeout(timeout);
  }
}

function normalizeStatus(value: unknown): OnboardingStatus {
  if (!value || typeof value !== "object") throw new Error("Invalid training status");
  const candidate = value as Partial<OnboardingStatus>;
  const step = candidate.step as OnboardingStep;
  const status = candidate.status as OnboardingStatusKind;
  if (
    candidate.version !== ONBOARDING_TOUR_VERSION ||
    !ONBOARDING_STEPS.includes(step) ||
    !["pending", "in_progress", "completed", "grandfathered", "unavailable"].includes(status)
  ) {
    throw new Error("Unsupported training status");
  }

  return {
    required: Boolean(candidate.required),
    version: ONBOARDING_TOUR_VERSION,
    status,
    step,
    language: candidate.language === "ru" || candidate.language === "en"
      ? candidate.language
      : null,
    skippedGameplay: Boolean(candidate.skippedGameplay),
    persistence: candidate.persistence === "local" ? "local" : "server",
  };
}

function assertLocalTransition(current: OnboardingStatus, next: OnboardingStep) {
  const currentIndex = ONBOARDING_STEPS.indexOf(current.step);
  const nextIndex = ONBOARDING_STEPS.indexOf(next);
  if (nextIndex < currentIndex) return;
  if (nextIndex > currentIndex + 1) {
    throw new Error("Training objectives must be completed in order");
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
      !["pending", "in_progress", "completed", "grandfathered"].includes(String(parsed.status))
    ) return null;
    return normalizeStatus(parsed);
  } catch {
    return null;
  }
}

function persistLocalStatus(wallet: string, status: OnboardingStatus) {
  if (status.persistence !== "local" || typeof window === "undefined") return status;
  try {
    window.localStorage.setItem(localStorageKey(wallet), JSON.stringify(status));
  } catch {
    // Private browsing or a full storage quota should not break the session.
  }
  return status;
}
