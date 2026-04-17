"use client";
import { ReactNode, useState } from "react";
import { base } from "wagmi/chains";
import { createConfig, createStorage, cookieStorage, http, WagmiProvider } from "wagmi";
import { baseAccount, injected } from "wagmi/connectors";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Attribution } from "ox/erc8021";
import { MiniAppProvider } from "./providers/MiniAppProvider";

export const BUILDER_CODE_SUFFIX = Attribution.toDataSuffix({
  codes: ["bc_2pbrby2j"],
});

const config = createConfig({
  chains: [base],
  connectors: [
    injected(),
    baseAccount({ appName: "Sea Battle" }),
  ],
  storage: createStorage({ storage: cookieStorage }),
  ssr: true,
  transports: {
    [base.id]: http(),
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
