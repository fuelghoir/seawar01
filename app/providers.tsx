"use client";
import { ReactNode, useEffect, useState } from "react";
import { base } from "wagmi/chains";
import { createConfig, createStorage, cookieStorage, http, fallback, useAccount, WagmiProvider } from "wagmi";
import { baseAccount, injected } from "wagmi/connectors";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Attribution } from "ox/erc8021";
import { MiniAppProvider, useMiniApp } from "./providers/MiniAppProvider";
import { WalletRequestRecovery } from "./components/WalletRequestRecovery";
import {
  rememberWalletReconnectPreference,
  shouldReconnectWalletOnMount,
} from "./lib/walletReconnect";

const DEFAULT_BUILDER_CODE = "bc_fsbovfq1";

export const BUILDER_CODE =
  process.env.NEXT_PUBLIC_BUILDER_CODE || DEFAULT_BUILDER_CODE;

export const BUILDER_CODE_SUFFIX = Attribution.toDataSuffix({
  codes: [BUILDER_CODE],
});

const CUSTOM_RPC = process.env.NEXT_PUBLIC_BASE_RPC_URL;

// Public Base RPCs to rotate through when no custom URL is configured.
// Keep mainnet.base.org last — it rate-limits hardest.
const BASE_RPCS = [
  CUSTOM_RPC,
  "https://base-rpc.publicnode.com",
  "https://base.meowrpc.com",
  "https://base.drpc.org",
  "https://mainnet.base.org",
  "https://1rpc.io/base",
].filter(Boolean) as string[];

const baseTransport = fallback(
  BASE_RPCS.map((url) => http(url, { batch: true, retryCount: 0, timeout: 3_000 })),
  { rank: false, retryCount: 0 }
);

const config = createConfig({
  chains: [base],
  connectors: [
    baseAccount({ appName: "Sea Battle" }),
    injected(),
  ],
  storage: createStorage({ storage: cookieStorage }),
  ssr: true,
  transports: {
    [base.id]: baseTransport,
  },
});

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <MiniAppProvider>
      <WalletProvider>
        <QueryClientProvider client={queryClient}>
          <WalletRequestRecovery />
          {children}
        </QueryClientProvider>
      </WalletProvider>
    </MiniAppProvider>
  );
}

function WalletProvider({ children }: { children: ReactNode }) {
  const { isInMiniApp } = useMiniApp();
  const [canReconnectOnDesktop] = useState(shouldReconnectWalletOnMount);
  const [isNarrowScreen, setIsNarrowScreen] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return false;
    }
    return window.matchMedia("(max-width: 720px)").matches;
  });

  useEffect(() => {
    const query = window.matchMedia("(max-width: 720px)");
    const sync = () => setIsNarrowScreen(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  const reconnectOnMount = isInMiniApp || isNarrowScreen || canReconnectOnDesktop;

  // First desktop visit still waits for Connect; refresh after a real connect restores silently.
  return (
    <WagmiProvider config={config} reconnectOnMount={reconnectOnMount}>
      <WalletSessionPersistence />
      {children}
    </WagmiProvider>
  );
}

function WalletSessionPersistence() {
  const { address, isConnected } = useAccount();

  useEffect(() => {
    if (!isConnected || !address) return;
    rememberWalletReconnectPreference();
  }, [address, isConnected]);

  return null;
}
