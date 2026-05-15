"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { OffchainGameContent } from "./OffchainGame";
import { BotGameContent } from "./BotGame";

function GameContent() {
  const searchParams = useSearchParams();
  const gameIdStr = searchParams.get("id") || "0";
  const mode = searchParams.get("mode") || "friend";
  const onchainGameId = searchParams.get("oid") || undefined;

  if (mode === "bot") {
    return <BotGameContent gameIdStr={gameIdStr} />;
  }

  if (mode === "wager") {
    return (
      <OffchainGameContent
        gameIdStr={gameIdStr}
        mode="wager"
        onchainGameId={onchainGameId}
      />
    );
  }

  // Default: free PvP friend match
  return <OffchainGameContent gameIdStr={gameIdStr} mode="friend" />;
}

export default function GamePage() {
  return (
    <Suspense
      fallback={
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          minHeight: "100vh", background: "transparent",
          color: "rgba(var(--accent-rgb), 0.75)",
          fontFamily: "var(--font-orbitron), Orbitron, monospace",
          fontSize: 12, letterSpacing: "0.24em", textTransform: "uppercase",
        }}>
          Loading…
        </div>
      }
    >
      <GameContent />
    </Suspense>
  );
}
