"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  console.error(error);

  return (
    <html lang="en">
      <body>
        <main className="app-error-shell">
          <section className="app-error-card">
            <p className="app-error-kicker">SEA BATTLE ON-CHAIN</p>
            <h1>Fleet sync failed</h1>
            <p>
              The wallet action finished, but the game UI hit a client error. Your on-chain transaction is not
              lost. Try restoring the screen, or reload if the wallet overlay got stuck.
            </p>
            <div className="app-error-actions">
              <button type="button" onClick={reset}>
                Restore game
              </button>
              <button type="button" onClick={() => window.location.reload()}>
                Reload
              </button>
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}
