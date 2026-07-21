export function isBaseAppUserAgent(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false;
  return /BaseApp|CoinbaseWallet|Farcaster|Warpcast|Base/i.test(userAgent);
}
