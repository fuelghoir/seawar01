"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { OffchainGameContent } from "./OffchainGame";
import { BotGameContent } from "./BotGame";

function GameContent() {
  const searchParams = useSearchParams();
  const gameIdStr = searchParams.get("id") || "0";
  const mode = searchParams.get("mode") || "offchain";
  const onchainGameId = searchParams.get("oid") || undefined;

  if (mode === "bot") {
    return <BotGameContent gameIdStr={gameIdStr} isOnchain={!!onchainGameId} />;
  }

  if (mode === "hybrid") {
    return (
      <OffchainGameContent
        gameIdStr={gameIdStr}
        mode="hybrid"
        onchainGameId={onchainGameId}
      />
    );
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

  // Default: free play (offchain)
  return <OffchainGameContent gameIdStr={gameIdStr} mode="offchain" />;
}

export default function GamePage() {
  return (
    <Suspense
      fallback={
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          minHeight: "100vh", background: "#0A1628", color: "#8ab4d4",
        }}>
          Loading...
        </div>
      }
    >
      <GameContent />
    </Suspense>
  );
}
