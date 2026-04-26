import { createPublicClient, http } from "viem";
import { mainnet } from "wagmi/chains";

const client = createPublicClient({
  chain: mainnet,
  transport: http("https://eth.llamarpc.com"),
});

// Session-level cache: avoid re-fetching same address
const cache = new Map<string, string | null>();

export async function getWalletName(address: string): Promise<string | null> {
  const addr = address.toLowerCase() as `0x${string}`;
  if (cache.has(addr)) return cache.get(addr)!;

  try {
    const name = await client.getEnsName({ address: addr });
    cache.set(addr, name ?? null);
    return name ?? null;
  } catch {
    cache.set(addr, null);
    return null;
  }
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
