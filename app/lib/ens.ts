import { createPublicClient, http, fallback } from "viem";
import { mainnet, base } from "wagmi/chains";

// Mainnet client for ENS reverse lookup
const mainnetClient = createPublicClient({
  chain: mainnet,
  transport: fallback([
    http("https://eth.llamarpc.com"),
    http("https://cloudflare-eth.com"),
    http("https://rpc.ankr.com/eth"),
  ]),
});

// Base client for Basenames (*.base.eth) reverse lookup
const baseClient = createPublicClient({
  chain: base,
  transport: fallback([
    http("https://mainnet.base.org"),
    http("https://base.llamarpc.com"),
  ]),
});

// Base Universal Resolver (supports L2 reverse records / basenames)
const BASE_UNIVERSAL_RESOLVER = "0xC6d566A56A1aFf6508b41f6c90ce131Be9bE5B62" as const;

// Session-level cache
const cache = new Map<string, string | null>();

export async function getWalletName(address: string): Promise<string | null> {
  const addr = address.toLowerCase() as `0x${string}`;
  if (cache.has(addr)) return cache.get(addr)!;

  // 1. Try ENS on Ethereum mainnet
  try {
    const ensName = await mainnetClient.getEnsName({ address: addr });
    if (ensName) {
      cache.set(addr, ensName);
      return ensName;
    }
  } catch { /* no ENS name */ }

  // 2. Try Basename on Base (*.base.eth)
  try {
    const basename = await baseClient.getEnsName({
      address: addr,
      universalResolverAddress: BASE_UNIVERSAL_RESOLVER,
    });
    if (basename) {
      cache.set(addr, basename);
      return basename;
    }
  } catch { /* no basename */ }

  cache.set(addr, null);
  return null;
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
