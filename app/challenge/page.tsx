"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { readContract, waitForTransactionReceipt as waitForReceipt } from "@wagmi/core";
import { decodeEventLog, formatUnits, parseUnits } from "viem";
import { useAccount, useConfig, useSwitchChain, useWriteContract } from "wagmi";
import { base } from "wagmi/chains";
import { Board } from "../components/Board";
import { ChallengeShipPlacement } from "../components/ChallengeShipPlacement";
import { CellState } from "../components/Cell";
import { challengeAbi, CHALLENGE_CONTRACT_ADDRESS } from "../contracts/challengeAbi";
import { erc20Abi, USDC_ADDRESS } from "../contracts/seaBattleAbi";
import {
  CHALLENGE_GRID_SIZE,
  CHALLENGE_TOTAL_SHIP_CELLS,
  ChallengeSettlement,
  ChallengeShot,
  PublicChallenge,
  calculateChallengePayouts,
  computeBoardCommitment,
  isFinalChallengeStatus,
} from "../lib/challengeShared";
import styles from "./page.module.css";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const CONTRACT_NOT_SET = CHALLENGE_CONTRACT_ADDRESS.toLowerCase() === ZERO_ADDRESS;

type ChallengeListResponse = { challenges: PublicChallenge[] };
type ChallengeResponse = {
  challenge: PublicChallenge;
  shots?: ChallengeShot[];
  settlement?: ChallengeSettlement | null;
};
type ShotResponse = ChallengeResponse & {
  shot: ChallengeShot;
};

function makeSalt() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `${Date.now().toString(36)}-${Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}

function parseUsdcInput(value: string) {
  const clean = value.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,6})?$/.test(clean)) throw new Error("Enter a valid USDC amount");
  const amount = parseUnits(clean, 6);
  if (amount <= BigInt(0)) throw new Error("Amount must be greater than zero");
  return amount;
}

function formatUsdc(value: string | bigint) {
  const amount = typeof value === "bigint" ? value : BigInt(value || "0");
  const formatted = Number(formatUnits(amount, 6));
  return `${formatted.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC`;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Request failed");
  return data as T;
}

function shotKey(x: number, y: number) {
  return `${x}:${y}`;
}

function buildTargetCells(shots: ChallengeShot[], final: boolean): CellState[][] {
  const shotMap = new Map(shots.map((shot) => [shotKey(shot.x, shot.y), shot]));
  return Array.from({ length: CHALLENGE_GRID_SIZE }, (_, y) =>
    Array.from({ length: CHALLENGE_GRID_SIZE }, (_, x) => {
      const shot = shotMap.get(shotKey(x, y));
      if (!shot) return "empty" as CellState;
      if (!shot.isHit) return "miss" as CellState;
      return final ? ("sunk" as CellState) : ("hit" as CellState);
    }),
  );
}

function challengeSubtitle(challenge: PublicChallenge) {
  const pot = BigInt(challenge.creatorAmount) + BigInt(challenge.entryFee);
  const prize = (pot * BigInt(90)) / BigInt(100);
  return `${formatUsdc(prize)} prize - ${challenge.maxMoves} moves - 10% to drops`;
}

export default function ChallengePage() {
  const { address, chainId, isConnected } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const config = useConfig();

  const [rewardAmount, setRewardAmount] = useState("1");
  const [entryFee, setEntryFee] = useState("0.1");
  const [maxMoves, setMaxMoves] = useState("12");
  const [openChallenges, setOpenChallenges] = useState<PublicChallenge[]>([]);
  const [myChallenges, setMyChallenges] = useState<PublicChallenge[]>([]);
  const [selected, setSelected] = useState<PublicChallenge | null>(null);
  const [shots, setShots] = useState<ChallengeShot[]>([]);
  const [settlement, setSettlement] = useState<ChallengeSettlement | null>(null);
  const [pendingPayout, setPendingPayout] = useState<bigint>(BigInt(0));
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const wallet = address?.toLowerCase() ?? "";
  const selectedFinal = selected ? isFinalChallengeStatus(selected.status) : false;
  const targetCells = useMemo(() => buildTargetCells(shots, selectedFinal), [shots, selectedFinal]);
  const shotCells = useMemo(() => new Set(shots.map((shot) => shotKey(shot.x, shot.y))), [shots]);
  const selectedCashout = useMemo(() => {
    if (!selected) return null;
    return calculateChallengePayouts(
      BigInt(selected.creatorAmount),
      BigInt(selected.entryFee),
      selected.hits,
    );
  }, [selected]);

  const loadLists = useCallback(async () => {
    try {
      const walletParam = wallet ? `?wallet=${wallet}` : "";
      const open = await requestJson<ChallengeListResponse>(`/api/challenges${walletParam}`);
      setOpenChallenges(open.challenges);
      if (wallet) {
        const mine = await requestJson<ChallengeListResponse>(`/api/challenges?wallet=${wallet}&mine=1`);
        setMyChallenges(mine.challenges);
      } else {
        setMyChallenges([]);
      }
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load challenges");
    }
  }, [wallet]);

  const loadChallenge = useCallback(
    async (challenge: PublicChallenge) => {
      try {
        const qs = wallet ? `?wallet=${wallet}` : "";
        const data = await requestJson<ChallengeResponse>(`/api/challenges/${challenge.id}${qs}`);
        setSelected(data.challenge);
        setShots(data.shots || []);
        setSettlement(data.settlement || null);
        setError("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load challenge");
      }
    },
    [wallet],
  );

  useEffect(() => {
    loadLists();
  }, [loadLists]);

  const loadPendingPayout = useCallback(async () => {
    if (!address || CONTRACT_NOT_SET) {
      setPendingPayout(BigInt(0));
      return;
    }
    try {
      const amount = (await readContract(config, {
        address: CHALLENGE_CONTRACT_ADDRESS,
        abi: challengeAbi,
        functionName: "pendingPayouts",
        args: [address],
      })) as bigint;
      setPendingPayout(amount);
    } catch {
      setPendingPayout(BigInt(0));
    }
  }, [address, config]);

  useEffect(() => {
    loadPendingPayout();
  }, [loadPendingPayout]);

  async function ensureReady() {
    if (!isConnected || !address) throw new Error("Connect wallet first");
    if (CONTRACT_NOT_SET) throw new Error("Challenge contract is not deployed");
    if (chainId && chainId !== base.id) {
      await switchChainAsync({ chainId: base.id });
    }
  }

  async function approveIfNeeded(amount: bigint) {
    if (!address) throw new Error("Connect wallet first");
    const allowance = (await readContract(config, {
      address: USDC_ADDRESS,
      abi: erc20Abi,
      functionName: "allowance",
      args: [address, CHALLENGE_CONTRACT_ADDRESS],
    })) as bigint;
    if (allowance >= amount) return;

    setMessage("Approve exact USDC amount...");
    const hash = await writeContractAsync({
      address: USDC_ADDRESS,
      abi: erc20Abi,
      functionName: "approve",
      args: [CHALLENGE_CONTRACT_ADDRESS, amount],
    });
    const receipt = await waitForReceipt(config, { hash });
    if (receipt.status !== "success") throw new Error("USDC approve reverted");
  }

  function extractCreatedId(logs: Awaited<ReturnType<typeof waitForReceipt>>["logs"]) {
    for (const log of logs) {
      if (log.address.toLowerCase() !== CHALLENGE_CONTRACT_ADDRESS.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({
          abi: challengeAbi,
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName === "ChallengeCreated") {
          return Number(decoded.args.challengeId);
        }
      } catch {
        // Ignore unrelated logs.
      }
    }
    throw new Error("ChallengeCreated event not found");
  }

  async function handleCreate(board: number[]) {
    try {
      await ensureReady();
      setBusy("create");
      setError("");
      setMessage("Preparing challenge...");

      const creatorAmount = parseUsdcInput(rewardAmount);
      const entryAmount = parseUsdcInput(entryFee);
      const moves = Number(maxMoves);
      if (!Number.isInteger(moves) || moves < 1 || moves > 25) {
        throw new Error("Max moves must be between 1 and 25");
      }

      const salt = makeSalt();
      const commitment = computeBoardCommitment(board, salt);
      await approveIfNeeded(creatorAmount);

      setMessage("Create challenge in wallet...");
      const hash = await writeContractAsync({
        address: CHALLENGE_CONTRACT_ADDRESS,
        abi: challengeAbi,
        functionName: "createChallenge",
        args: [creatorAmount, entryAmount, moves, commitment],
      });
      const receipt = await waitForReceipt(config, { hash });
      if (receipt.status !== "success") throw new Error("Create challenge reverted");
      const onchainChallengeId = extractCreatedId(receipt.logs);

      setMessage("Saving hidden board...");
      const data = await requestJson<ChallengeResponse>("/api/challenges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet,
          onchainChallengeId,
          creatorAmount: creatorAmount.toString(),
          entryFee: entryAmount.toString(),
          maxMoves: moves,
          board,
          salt,
        }),
      });

      setSelected(data.challenge);
      setShots([]);
      setSettlement(null);
      setMessage("Challenge is live. One challenger can enter.");
      await loadLists();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create challenge");
    } finally {
      setBusy(null);
    }
  }

  async function handleJoin(challenge: PublicChallenge) {
    try {
      await ensureReady();
      setBusy(`join:${challenge.id}`);
      setError("");
      setMessage("Joining challenge...");
      const amount = BigInt(challenge.entryFee);
      await approveIfNeeded(amount);

      const hash = await writeContractAsync({
        address: CHALLENGE_CONTRACT_ADDRESS,
        abi: challengeAbi,
        functionName: "joinChallenge",
        args: [BigInt(challenge.onchainChallengeId)],
      });
      const receipt = await waitForReceipt(config, { hash });
      if (receipt.status !== "success") throw new Error("Join challenge reverted");

      const data = await requestJson<ChallengeResponse>(`/api/challenges/${challenge.id}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet }),
      });
      setMessage("Challenge joined. Find all ships before moves run out.");
      setSelected(data.challenge);
      setShots([]);
      setSettlement(null);
      await loadChallenge(data.challenge);
      await loadLists();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not join challenge");
    } finally {
      setBusy(null);
    }
  }

  async function handleShot(x: number, y: number) {
    if (!selected || selected.status !== "joined" || shotCells.has(shotKey(x, y))) return;
    if (selected.challenger !== wallet) return;
    try {
      setBusy(`shot:${x}:${y}`);
      setError("");
      setMessage("Firing...");
      const data = await requestJson<ShotResponse>(`/api/challenges/${selected.id}/shot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet, x, y }),
      });
      setSelected(data.challenge);
      setShots(data.shots || []);
      setSettlement(data.settlement || null);
      setMessage(
        data.settlement
          ? "Battle finished. Settle onchain to move the USDC."
          : data.shot.isHit
            ? "Hit. Keep hunting."
            : "Miss. Move spent.",
      );
      await loadLists();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not fire shot");
    } finally {
      setBusy(null);
    }
  }

  async function handleSettle(nextSettlement = settlement) {
    if (!selected || !nextSettlement) return;
    try {
      await ensureReady();
      setBusy(`settle:${selected.id}`);
      setError("");
      setMessage("Settling payout...");
      const hash = await writeContractAsync({
        address: CHALLENGE_CONTRACT_ADDRESS,
        abi: challengeAbi,
        functionName: "settleChallenge",
        args: [
          BigInt(nextSettlement.onchainChallengeId),
          nextSettlement.movesUsed,
          nextSettlement.hits,
          nextSettlement.signature,
        ],
      });
      const receipt = await waitForReceipt(config, { hash });
      if (receipt.status !== "success") throw new Error("Settlement reverted");
      const data = await requestJson<ChallengeResponse>(`/api/challenges/${selected.id}/settled`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet, txHash: hash }),
      });
      setSelected(data.challenge);
      setSettlement(null);
      await loadPendingPayout();
      setMessage("Payout locked. Use Claim all payouts whenever you want.");
      await loadLists();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not settle challenge");
    } finally {
      setBusy(null);
    }
  }

  async function handleCashout() {
    if (!selected) return;
    try {
      setBusy(`cashout:${selected.id}`);
      setError("");
      setMessage("Calculating cashout...");
      const data = await requestJson<ChallengeResponse>(`/api/challenges/${selected.id}/cashout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet }),
      });
      setSelected(data.challenge);
      setSettlement(data.settlement || null);
      if (data.settlement) {
        await handleSettle(data.settlement);
      } else {
        setMessage("Cashout saved. Settlement signature is not ready.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not cash out");
    } finally {
      setBusy(null);
    }
  }

  async function handleClaimPayout() {
    try {
      await ensureReady();
      setBusy("claim");
      setError("");
      setMessage("Claiming all payouts...");
      const hash = await writeContractAsync({
        address: CHALLENGE_CONTRACT_ADDRESS,
        abi: challengeAbi,
        functionName: "claimPayout",
      });
      const receipt = await waitForReceipt(config, { hash });
      if (receipt.status !== "success") throw new Error("Claim reverted");
      await loadPendingPayout();
      setMessage("All available challenge payouts claimed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not claim payouts");
    } finally {
      setBusy(null);
    }
  }

  async function handleCancel(challenge: PublicChallenge) {
    try {
      await ensureReady();
      setBusy(`cancel:${challenge.id}`);
      setError("");
      setMessage("Cancelling open challenge...");
      const hash = await writeContractAsync({
        address: CHALLENGE_CONTRACT_ADDRESS,
        abi: challengeAbi,
        functionName: "cancelOpenChallenge",
        args: [BigInt(challenge.onchainChallengeId)],
      });
      const receipt = await waitForReceipt(config, { hash });
      if (receipt.status !== "success") throw new Error("Cancel reverted");
      await requestJson<ChallengeResponse>(`/api/challenges/${challenge.id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet, txHash: hash }),
      });
      if (selected?.id === challenge.id) setSelected(null);
      setMessage("Challenge cancelled and reward returned.");
      await loadLists();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not cancel challenge");
    } finally {
      setBusy(null);
    }
  }

  const renderChallengeCard = (challenge: PublicChallenge, scope: "open" | "mine") => {
    const mineCreator = challenge.creator === wallet;
    const mineChallenger = challenge.challenger === wallet;
    const active = selected?.id === challenge.id;
    return (
      <article key={challenge.id} className={`${styles.challengeCard} ${active ? styles.activeCard : ""}`}>
        <div>
          <span className={styles.cardKicker}>
            #{challenge.onchainChallengeId} - {challenge.status.replace("_", " ")}
          </span>
          <h3>{formatUsdc(challenge.creatorAmount)} reward</h3>
          <p>{challengeSubtitle(challenge)}</p>
        </div>
        <div className={styles.cardActions}>
          <button type="button" onClick={() => loadChallenge(challenge)}>
            Open
          </button>
          {scope === "open" && (
            <button
              type="button"
              className={styles.primarySmall}
              onClick={() => handleJoin(challenge)}
              disabled={!!busy || CONTRACT_NOT_SET}
            >
              {busy === `join:${challenge.id}` ? "Joining..." : `Join - ${formatUsdc(challenge.entryFee)}`}
            </button>
          )}
          {mineCreator && challenge.status === "open" && (
            <button
              type="button"
              className={styles.dangerSmall}
              onClick={() => handleCancel(challenge)}
              disabled={!!busy}
            >
              {busy === `cancel:${challenge.id}` ? "Cancel..." : "Cancel"}
            </button>
          )}
          {(mineCreator || mineChallenger) && isFinalChallengeStatus(challenge.status) && !challenge.settledAt && (
            <button type="button" className={styles.primarySmall} onClick={() => loadChallenge(challenge)}>
              Settle
            </button>
          )}
        </div>
      </article>
    );
  };

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <div>
          <span className={styles.eyebrow}>Async 5x5 bounty mode</span>
          <h1>Sea Challenge</h1>
          <p>
            Create a compact 5x5 hidden fleet, lock a reward, and let one challenger try to sink every ship.
            Winner gets 90% of the pot. Drops vault receives 10%.
          </p>
        </div>
        <div className={styles.heroStats}>
          <span>One challenger</span>
              <strong>90 / 10</strong>
          <span>Creator reward + entry fee</span>
        </div>
      </header>

      {wallet && (
        <section className={styles.claimPanel}>
          <div>
            <span className={styles.eyebrow}>Challenge vault</span>
            <strong>{formatUsdc(pendingPayout)}</strong>
            <p>Creator and challenger payouts stack here across all challenges.</p>
          </div>
          <button
            type="button"
            onClick={handleClaimPayout}
            disabled={!!busy || pendingPayout <= BigInt(0)}
          >
            {busy === "claim" ? "Claiming..." : "Claim all payouts"}
          </button>
        </section>
      )}

      {CONTRACT_NOT_SET && (
        <div className={styles.banner}>Challenge contract is not deployed yet.</div>
      )}
      {!isConnected && (
        <div className={styles.banner}>Connect wallet on the main screen to create or join challenges.</div>
      )}
      {(message || error) && (
        <div className={`${styles.banner} ${error ? styles.errorBanner : ""}`}>
          {error || message}
        </div>
      )}

      <section className={styles.layout}>
        <aside className={styles.leftColumn}>
          <section className={styles.panel}>
            <div className={styles.panelHead}>
              <span className={styles.eyebrow}>Create</span>
              <h2>Lock a bounty</h2>
            </div>
            <div className={styles.formGrid}>
              <label>
                Creator reward
                <input value={rewardAmount} onChange={(e) => setRewardAmount(e.target.value)} inputMode="decimal" />
              </label>
              <label>
                Challenger entry
                <input value={entryFee} onChange={(e) => setEntryFee(e.target.value)} inputMode="decimal" />
              </label>
              <label>
                Max moves
                <input value={maxMoves} onChange={(e) => setMaxMoves(e.target.value)} inputMode="numeric" />
              </label>
            </div>
            <div className={styles.economyBox}>
              <span>Example payout</span>
              <b>
                {(() => {
                  try {
                    const pot = parseUsdcInput(rewardAmount) + parseUsdcInput(entryFee);
                    return `${formatUsdc((pot * BigInt(90)) / BigInt(100))} winner / ${formatUsdc((pot * BigInt(10)) / BigInt(100))} drops`;
                  } catch {
                    return "Enter valid amounts";
                  }
                })()}
              </b>
            </div>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHead}>
              <span className={styles.eyebrow}>Your fleet</span>
              <h2>Place 5x5 ships</h2>
            </div>
            <ChallengeShipPlacement
              onConfirm={handleCreate}
              isPending={busy === "create"}
              isConfirming={busy === "create"}
            />
          </section>

          {wallet && (
            <section className={styles.panel}>
              <div className={styles.panelHead}>
                <span className={styles.eyebrow}>Reconnect</span>
                <h2>Your challenges</h2>
              </div>
              <div className={styles.list}>
                {myChallenges.length === 0 ? (
                  <p className={styles.empty}>No active challenges yet.</p>
                ) : (
                  myChallenges.map((challenge) => renderChallengeCard(challenge, "mine"))
                )}
              </div>
            </section>
          )}
        </aside>

        <section className={styles.rightColumn}>
          <section className={styles.panel}>
            <div className={styles.panelHeadRow}>
              <div>
                <span className={styles.eyebrow}>Targets</span>
                <h2>Open challenges</h2>
              </div>
              <button type="button" className={styles.refresh} onClick={loadLists}>
                Refresh
              </button>
            </div>
            <div className={styles.list}>
              {openChallenges.length === 0 ? (
                <p className={styles.empty}>No open challenges right now.</p>
              ) : (
                openChallenges.map((challenge) => renderChallengeCard(challenge, "open"))
              )}
            </div>
          </section>

          <section className={`${styles.panel} ${styles.attackPanel}`}>
            <div className={styles.panelHeadRow}>
              <div>
                <span className={styles.eyebrow}>Attack board</span>
                <h2>{selected ? `Challenge #${selected.onchainChallengeId}` : "Select a challenge"}</h2>
              </div>
              {selected && (
                <div className={styles.counter}>
                  <b>{selected.hits}</b> hits - <b>{selected.movesUsed}</b>/{selected.maxMoves} moves
                </div>
              )}
            </div>

            {selected ? (
              <>
                <div className={styles.boardStage}>
                  <Board
                    cells={targetCells}
                    onCellClick={handleShot}
                    isInteractive={selected.status === "joined" && selected.challenger === wallet && !busy}
                    label="Challenge Grid"
                    variant="target"
                    cellSize="48px"
                  />
                </div>
                <div className={styles.attackFooter}>
                  <p>{challengeSubtitle(selected)}</p>
                  {settlement && !selected.settledAt && (
                    <button
                      type="button"
                      className={styles.settleButton}
                      onClick={() => handleSettle()}
                      disabled={!!busy}
                    >
                      {busy === `settle:${selected.id}` ? "Locking..." : "Lock payout"}
                    </button>
                  )}
                  {selected.settledAt && <span className={styles.settledBadge}>Payout settled</span>}
                </div>
                <div className={styles.cashoutBox}>
                  <div className={styles.cashoutTop}>
                    <div>
                      <span className={styles.eyebrow}>Cashout curve</span>
                      <h3>Hits pay progressively</h3>
                    </div>
                    {selectedCashout && (
                      <strong>{formatUsdc(selectedCashout.challengerPayout)}</strong>
                    )}
                  </div>
                  <div className={styles.cashoutGrid}>
                    {Array.from({ length: CHALLENGE_TOTAL_SHIP_CELLS }, (_, index) => {
                      const hits = index + 1;
                      const payout = calculateChallengePayouts(
                        BigInt(selected.creatorAmount),
                        BigInt(selected.entryFee),
                        hits,
                      );
                      return (
                        <span
                          key={hits}
                          className={hits <= selected.hits ? styles.cashoutActive : ""}
                        >
                          {hits} hit: {formatUsdc(payout.challengerPayout)}
                        </span>
                      );
                    })}
                  </div>
                  {selected.status === "joined" && selected.challenger === wallet && (
                    <button
                      type="button"
                      className={styles.cashoutButton}
                      onClick={handleCashout}
                      disabled={!!busy || selected.movesUsed <= 0}
                    >
                      {busy === `cashout:${selected.id}` ? "Cashout..." : "Cash out now"}
                    </button>
                  )}
                  <p>
                    10% of the full pot goes to drops. The remaining 90% is split:
                    challenger gets the cashout amount, creator gets the rest.
                  </p>
                </div>
              </>
            ) : (
              <div className={styles.emptyState}>
                <b>No target selected</b>
                <span>Join one open challenge or reopen yours from the left panel.</span>
              </div>
            )}
          </section>
        </section>
      </section>
    </main>
  );
}
