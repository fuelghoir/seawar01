'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import sdk from '@farcaster/miniapp-sdk';

const MINIAPP_INIT_TIMEOUT_MS = 1800;
const MINIAPP_READY_TIMEOUT_MS = 800;

interface MiniAppContextValue {
  context: Awaited<typeof sdk.context> | null;
  isReady: boolean;
  isInMiniApp: boolean;
}

export const MiniAppContext = createContext<MiniAppContextValue | null>(null);

export function useMiniApp() {
  const context = useContext(MiniAppContext);
  if (!context) {
    throw new Error('useMiniApp must be used within MiniAppProvider');
  }
  return context;
}

export function MiniAppProvider({ children }: { children: ReactNode }) {
  const [context, setContext] = useState<Awaited<typeof sdk.context> | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isInMiniApp, setIsInMiniApp] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const finish = () => {
      if (!cancelled) setIsReady(true);
    };

    const init = async () => {
      try {
        const inApp = await Promise.race([
          sdk.isInMiniApp(),
          waitFor(MINIAPP_INIT_TIMEOUT_MS, false),
        ]);
        if (cancelled) return;

        setIsInMiniApp(inApp);
        if (inApp) {
          const ctx = await Promise.race([
            sdk.context,
            waitFor<Awaited<typeof sdk.context> | null>(
              MINIAPP_INIT_TIMEOUT_MS,
              null
            ),
          ]);
          if (cancelled) return;

          if (ctx) setContext(ctx);

          try {
            await Promise.race([
              sdk.actions.ready(),
              waitFor<void>(MINIAPP_READY_TIMEOUT_MS, undefined),
            ]);
          } catch {
            // Mini app ready is best-effort; the UI should still open.
          }
        }
      } catch {
        if (!cancelled) setIsInMiniApp(false);
      } finally {
        finish();
      }
    };

    const hardStop = window.setTimeout(
      finish,
      MINIAPP_INIT_TIMEOUT_MS + MINIAPP_READY_TIMEOUT_MS + 500
    );

    init();
    return () => {
      cancelled = true;
      window.clearTimeout(hardStop);
    };
  }, []);

  return (
    <MiniAppContext.Provider value={{ context, isReady, isInMiniApp }}>
      {children}
    </MiniAppContext.Provider>
  );
}

function waitFor<T>(ms: number, value: T): Promise<T> {
  return new Promise((resolve) => {
    window.setTimeout(() => resolve(value), ms);
  });
}
