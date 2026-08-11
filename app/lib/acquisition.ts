export type AcquisitionPlatform = "base_app" | "farcaster" | "web";

export type AcquisitionVisitInput = {
  ref?: string | null;
  source?: string | null;
  medium?: string | null;
  campaign?: string | null;
  content?: string | null;
  referrer?: string | null;
  landingPath?: string | null;
  platform?: AcquisitionPlatform | null;
};

let eventQueue: Promise<void> = Promise.resolve();
let latestVisitRequest: Promise<void> = Promise.resolve();
const ACQUISITION_REQUEST_TIMEOUT_MS = 3_500;
const ACQUISITION_VISIT_WAIT_MS = 3_000;
const ACQUISITION_MAX_RETRIES = 2;
const ACQUISITION_MAX_RETRY_DELAY_MS = 4_000;

class AcquisitionRequestError extends Error {
  readonly retryable: boolean;
  readonly retryAfterMs: number | null;

  constructor(
    message: string,
    retryable: boolean,
    retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = "AcquisitionRequestError";
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
  }
}

export async function recordAcquisitionVisit(input: AcquisitionVisitInput): Promise<void> {
  let settleFirstAttempt: ((error?: unknown) => void) | null = null;
  latestVisitRequest = new Promise<void>((resolve, reject) => {
    settleFirstAttempt = (error?: unknown) => {
      if (error === undefined) resolve();
      else reject(error);
    };
  });

  // Keep retries in the serialized background queue so a wallet event cannot
  // overtake the visit response that establishes its signed session cookie.
  const backgroundRequest = enqueueAcquisitionEvent(
    { event: "visit", ...input },
    (error) => settleFirstAttempt?.(error),
  );
  void backgroundRequest.catch(() => undefined);
  await latestVisitRequest;
}

export async function recordAcquisitionWallet(wallet: string): Promise<void> {
  await enqueueAcquisitionEvent({ event: "wallet", wallet });
}

export async function waitForAcquisitionVisit(): Promise<void> {
  // Referral signing only waits for the first visit attempt (or this short
  // ceiling), never for retry backoff in the background queue.
  await Promise.race([
    latestVisitRequest.catch(() => undefined),
    delay(ACQUISITION_VISIT_WAIT_MS),
  ]);
}

function enqueueAcquisitionEvent(
  payload: Record<string, unknown>,
  onFirstAttemptSettled?: (error?: unknown) => void,
) {
  const request = eventQueue
    .catch(() => undefined)
    .then(() => sendAcquisitionEventWithRetry(payload, onFirstAttemptSettled));
  eventQueue = request.catch(() => undefined);
  return request;
}

async function sendAcquisitionEventWithRetry(
  payload: Record<string, unknown>,
  onFirstAttemptSettled?: (error?: unknown) => void,
) {
  for (let attempt = 0; attempt <= ACQUISITION_MAX_RETRIES; attempt += 1) {
    try {
      await sendAcquisitionEvent(payload);
      if (attempt === 0) onFirstAttemptSettled?.();
      return;
    } catch (error) {
      if (attempt === 0) onFirstAttemptSettled?.(error);
      const requestError = normalizeRequestError(error);
      if (!requestError.retryable || attempt === ACQUISITION_MAX_RETRIES) {
        throw requestError;
      }

      const fallbackDelay = 700 * (2 ** attempt);
      await delay(Math.min(
        ACQUISITION_MAX_RETRY_DELAY_MS,
        Math.max(fallbackDelay, requestError.retryAfterMs ?? 0),
      ));
    }
  }
}

async function sendAcquisitionEvent(payload: Record<string, unknown>): Promise<void> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), ACQUISITION_REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch("/api/acquisition", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      keepalive: true,
      signal: controller.signal,
      body: JSON.stringify(payload),
    });
  } catch (error) {
    throw new AcquisitionRequestError(
      error instanceof Error ? error.message : "Acquisition request failed",
      true,
    );
  } finally {
    window.clearTimeout(timeout);
  }

  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    const body = isRecord(data) ? data : null;
    const code = typeof body?.code === "string" ? body.code : "";
    const message = typeof body?.error === "string"
      ? body.error
      : "Could not record acquisition event";
    const retryable = response.status === 429 || response.status === 502 || response.status === 504;
    // In particular, acquisition_unavailable/503 means the migration is not
    // installed and should not be hammered by retries.
    throw new AcquisitionRequestError(
      message,
      retryable && code !== "acquisition_unavailable",
      response.status === 429 ? parseRetryAfter(response.headers.get("retry-after")) : null,
    );
  }
}

function normalizeRequestError(error: unknown) {
  return error instanceof AcquisitionRequestError
    ? error
    : new AcquisitionRequestError(
        error instanceof Error ? error.message : "Acquisition request failed",
        true,
      );
}

function parseRetryAfter(value: string | null) {
  if (!value) return null;
  const seconds = Number(value);
  const milliseconds = Number.isFinite(seconds)
    ? seconds * 1000
    : Date.parse(value) - Date.now();
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return null;
  return Math.min(ACQUISITION_MAX_RETRY_DELAY_MS, milliseconds);
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
