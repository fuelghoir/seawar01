export function isBaseAppUserAgent(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false;
  return /BaseApp|CoinbaseWallet/i.test(userAgent);
}
