import { isAddress } from "viem";

const DEFAULT_API_BASE = "https://dashboard.base.org/api/v1/notifications";
const MAX_USERS_PAGE_SIZE = 500;
export const MAX_NOTIFICATION_RECIPIENTS = 1000;

export interface BaseNotificationsConfig {
  apiKey: string;
  appUrl: string;
  apiBase: string;
}

export interface BaseNotificationUsersResult {
  wallets: string[];
  pages: number;
  hasMore: boolean;
}

export interface BaseNotificationSendResult {
  success: boolean;
  sentCount: number;
  failedCount: number;
  requestCount: number;
  results: BaseNotificationAddressResult[];
}

export interface BaseNotificationAddressResult {
  walletAddress: string;
  sent: boolean;
  failureReason?: string;
}

interface BaseUsersPayload {
  success?: boolean;
  users?: Array<{
    address?: unknown;
    notificationsEnabled?: boolean;
  }>;
  nextCursor?: unknown;
  error?: unknown;
  message?: unknown;
}

interface BaseSendPayload {
  success?: boolean;
  results?: BaseNotificationAddressResult[];
  sentCount?: number;
  failedCount?: number;
  error?: unknown;
  message?: unknown;
}

export function getBaseNotificationsConfig(): BaseNotificationsConfig {
  const apiKey = process.env.BASE_NOTIFICATIONS_API_KEY || "";
  const appUrl = process.env.BASE_NOTIFICATIONS_APP_URL || process.env.NEXT_PUBLIC_URL || "";
  const apiBase = process.env.BASE_NOTIFICATIONS_API_BASE || DEFAULT_API_BASE;

  if (!apiKey) {
    throw new Error("BASE_NOTIFICATIONS_API_KEY is required");
  }
  if (!appUrl) {
    throw new Error("BASE_NOTIFICATIONS_APP_URL or NEXT_PUBLIC_URL is required");
  }

  return {
    apiKey,
    appUrl,
    apiBase: apiBase.replace(/\/+$/, ""),
  };
}

export async function fetchBaseNotificationUsers(
  config: BaseNotificationsConfig,
  options: { pageSize?: number; maxPages?: number; maxUsers?: number } = {},
): Promise<BaseNotificationUsersResult> {
  const pageSize = clampInt(options.pageSize ?? MAX_USERS_PAGE_SIZE, 1, MAX_USERS_PAGE_SIZE);
  const maxPages = clampInt(options.maxPages ?? 100, 1, 1000);
  const maxUsers = options.maxUsers && options.maxUsers > 0 ? Math.floor(options.maxUsers) : Infinity;
  const wallets: string[] = [];
  const seen = new Set<string>();
  let cursor = "";
  let pages = 0;
  let hasMore = false;

  while (pages < maxPages && wallets.length < maxUsers) {
    const url = new URL(`${config.apiBase}/app/users`);
    url.searchParams.set("app_url", config.appUrl);
    url.searchParams.set("notification_enabled", "true");
    url.searchParams.set("limit", String(pageSize));
    if (cursor) url.searchParams.set("cursor", cursor);

    const response = await fetch(url, {
      headers: { "x-api-key": config.apiKey },
      cache: "no-store",
    });
    const payload = await readJson<BaseUsersPayload>(response);
    if (!response.ok || payload?.success === false) {
      throw new Error(formatBaseApiError("Could not fetch Base notification users", response, payload));
    }

    pages += 1;
    for (const user of payload?.users ?? []) {
      if (user.notificationsEnabled === false) continue;
      const wallet = normalizeWallet(user.address);
      if (!wallet || seen.has(wallet)) continue;
      seen.add(wallet);
      wallets.push(wallet);
      if (wallets.length >= maxUsers) break;
    }

    cursor = typeof payload?.nextCursor === "string" ? payload.nextCursor : "";
    hasMore = Boolean(cursor);
    if (!cursor) break;
  }

  return { wallets, pages, hasMore };
}

export async function sendBaseNotification(
  config: BaseNotificationsConfig,
  input: {
    walletAddresses: string[];
    title: string;
    message: string;
    targetPath?: string;
  },
): Promise<BaseNotificationSendResult> {
  const title = input.title.trim();
  const message = input.message.trim();
  const targetPath = input.targetPath?.trim();

  validateNotificationCopy(title, message, targetPath);

  const walletAddresses = uniqueWallets(input.walletAddresses);
  const batches = chunk(walletAddresses, MAX_NOTIFICATION_RECIPIENTS);
  const results: BaseNotificationAddressResult[] = [];
  let sentCount = 0;
  let failedCount = 0;

  for (const batch of batches) {
    const body: Record<string, unknown> = {
      app_url: config.appUrl,
      wallet_addresses: batch,
      title,
      message,
    };
    if (targetPath) body.target_path = targetPath;

    const response = await fetch(`${config.apiBase}/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
      },
      body: JSON.stringify(body),
    });
    const payload = await readJson<BaseSendPayload>(response);
    if (!response.ok) {
      throw new Error(formatBaseApiError("Could not send Base notification", response, payload));
    }

    const batchResults = payload?.results ?? [];
    results.push(...batchResults);
    sentCount += Number(payload?.sentCount ?? batchResults.filter((row) => row.sent).length);
    failedCount += Number(payload?.failedCount ?? batchResults.filter((row) => !row.sent).length);
  }

  return {
    success: failedCount === 0,
    sentCount,
    failedCount,
    requestCount: batches.length,
    results,
  };
}

export function uniqueWallets(values: string[]): string[] {
  const seen = new Set<string>();
  const wallets: string[] = [];
  for (const value of values) {
    const wallet = normalizeWallet(value);
    if (!wallet || seen.has(wallet)) continue;
    seen.add(wallet);
    wallets.push(wallet);
  }
  return wallets;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function validateNotificationCopy(title: string, message: string, targetPath?: string) {
  if (!title || charLength(title) > 30) {
    throw new Error("Base notification title must be 1-30 characters");
  }
  if (!message || charLength(message) > 200) {
    throw new Error("Base notification message must be 1-200 characters");
  }
  if (targetPath && (!targetPath.startsWith("/") || charLength(targetPath) > 500)) {
    throw new Error("Base notification targetPath must start with / and be <= 500 characters");
  }
}

function normalizeWallet(value: unknown): string | null {
  const wallet = String(value ?? "").trim().toLowerCase();
  return isAddress(wallet) ? wallet : null;
}

function charLength(value: string) {
  return Array.from(value).length;
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

async function readJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function formatBaseApiError(prefix: string, response: Response, payload: BaseUsersPayload | BaseSendPayload | null) {
  const detail = typeof payload?.message === "string"
    ? payload.message
    : typeof payload?.error === "string"
      ? payload.error
      : response.statusText;
  return `${prefix}: ${response.status} ${detail}`;
}
