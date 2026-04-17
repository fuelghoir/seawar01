"use client";
import { ReactNode, useState } from "react";
import { base } from "wagmi/chains";
import { createConfig, createStorage, cookieStorage, http, fallback, WagmiProvider } from "wagmi";
import { baseAccount, injected } from "wagmi/connectors";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Attribution } from "ox/erc8021";
import { MiniAppProvider } from "./providers/MiniAppProvider";

export const BUILDER_CODE_SUFFIX = Attribution.toDataSuffix({
  codes: ["bc_2pbrby2j"],
});

const CUSTOM_RPC = process.env.NEXT_PUBLIC_BASE_RPC_URL;

// Public Base RPCs to rotate through when no custom URL is configured.
// Keep mainnet.base.org last — it rate-limits hardest.
const BASE_RPCS = [
  CUSTOM_RPC,
  "https://base.llamarpc.com",
  "https://base-rpc.publicnode.com",
  "https://base.drpc.org",
  "https://1rpc.io/base",
  "https://base.meowrpc.com",
  "https://mainnet.base.org",
].filter(Boolean) as string[];

const baseTransport = fallback(
  BASE_RPCS.map((url) => http(url, { batch: true, retryCount: 2 })),
  { rank: false, retryCount: 2 }
);

const config = createConfig({
  chains: [base],
  connectors: [
    injected(),
    baseAccount({ appName: "Sea Battle" }),
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
      <WagmiProvider config={config}>
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      </WagmiProvider>
    </MiniAppProvider>
  );
}
