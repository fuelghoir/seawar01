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

const PRIZE_PRESETS = [
  { id: "bank-1", label: "Scout", amount: "1", note: "Quick low-risk bank" },
  { id: "bank-5", label: "Captain", amount: "5", note: "Main prize room" },
  { id: "bank-10", label: "Admiral", amount: "10", note: "Heavy prize bank" },
];

const MOVE_PRESETS = [
  { id: "blitz", label: "Blitz", moves: 8, entryFee: "0.08", note: "Hardest clear" },
  { id: "raid", label: "Raid", moves: 10, entryFee: "0.12", note: "Balanced hunt" },
  { id: "siege", label: "Siege", moves: 12, entryFee: "0.18", note: "More shots" },
];

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

function formatMultiplier(payout: bigint, ticket: bigint) {
  if (ticket <= BigInt(0)) return "0x";
  const value = Number((payout * BigInt(100)) / ticket) / 100;
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}x`;
}

function challengeSetupErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/challenge_games|schema cache|could not find the table/i.test(message)) {
    return "Challenge database is being activated. Run the Supabase challenge migration, then open challenges will load here.";
  }
  return /challenge contract is not deployed|contract is not deployed/i.test(message)
    ? "Challenge contract is being activated. The mode preview is visible now."
    : "";
}

function challengeDisplayError(error: unknown, fallback: string) {
  const setupMessage = challengeSetupErrorMessage(error);
  return setupMessage
    ? { text: setupMessage, soft: true }
    : { text: error instanceof Error ? error.message : fallback, soft: false };
}

function cashoutPercent(hits: number) {
  const percent =
    Math.floor((hits * hits * 10000) / (CHALLENGE_TOTAL_SHIP_CELLS * CHALLENGE_TOTAL_SHIP_CELLS)) / 100;
  return `${percent}%`;
}

function challengeStatusLabel(status: PublicChallenge["status"]) {
  return status.replace("_", " ");
}

function challengeSubtitle(challenge: PublicChallenge) {
  const fullClear = calculateChallengePayouts(
    BigInt(challenge.creatorAmount),
    BigInt(challenge.entryFee),
    CHALLENGE_TOTAL_SHIP_CELLS,
  );
  return `${formatUsdc(fullClear.challengerPayout)} max cashout - ${challenge.maxMoves} shots - ${formatUsdc(fullClear.dropFee)} to drops`;
}

function showFriendlyError(
  error: unknown,
  fallback: string,
  setError: (value: string) => void,
  setMessage: (value: string) => void,
) {
  const display = challengeDisplayError(error, fallback);
  if (display.soft) {
    setMessage(display.text);
    setError("");
  } else {
    setError(display.text);
  }
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

export default function ChallengePage() {
  const { address, chainId, isConnected } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const config = useConfig();

  const [selectedPrizeId, setSelectedPrizeId] = useState(PRIZE_PRESETS[0].id);
  const [selectedMoveId, setSelectedMoveId] = useState(MOVE_PRESETS[1].id);
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
  const selectedPrize = PRIZE_PRESETS.find((preset) => preset.id === selectedPrizeId) ?? PRIZE_PRESETS[0];
  const selectedMovePreset = MOVE_PRESETS.find((preset) => preset.id === selectedMoveId) ?? MOVE_PRESETS[1];
  const selectedCreatorAmount = useMemo(() => parseUsdcInput(selectedPrize.amount), [selectedPrize.amount]);
  const selectedEntryAmount = useMemo(() => parseUsdcInput(selectedMovePreset.entryFee), [selectedMovePreset.entryFee]);
  const selectedFullClear = useMemo(
    () => calculateChallengePayouts(selectedCreatorAmount, selectedEntryAmount, CHALLENGE_TOTAL_SHIP_CELLS),
    [selectedCreatorAmount, selectedEntryAmount],
  );
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
      const setupMessage = challengeSetupErrorMessage(err);
      if (setupMessage) {
        setOpenChallenges([]);
        setMyChallenges([]);
        setMessage(setupMessage);
        setError("");
        return;
      }
      showFriendlyError(err, "Could not load challenges", setError, setMessage);
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
        showFriendlyError(err, "Could not load challenge", setError, setMessage);
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

      const creatorAmount = selectedCreatorAmount;
      const entryAmount = selectedEntryAmount;
      const moves = selectedMovePreset.moves;

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
      setMessage("Challenge is live. One attacker can buy the ticket.");
      await loadLists();
    } catch (err) {
      showFriendlyError(err, "Could not create challenge", setError, setMessage);
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
      setMessage("Attack run started. Sink all ships before shots run out.");
      setSelected(data.challenge);
      setShots([]);
      setSettlement(null);
      await loadChallenge(data.challenge);
      await loadLists();
    } catch (err) {
      showFriendlyError(err, "Could not join challenge", setError, setMessage);
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
      showFriendlyError(err, "Could not fire shot", setError, setMessage);
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
      showFriendlyError(err, "Could not settle challenge", setError, setMessage);
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
      showFriendlyError(err, "Could not cash out", setError, setMessage);
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
      showFriendlyError(err, "Could not claim payouts", setError, setMessage);
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
      setMessage("Challenge cancelled and prize bank returned.");
      await loadLists();
    } catch (err) {
      showFriendlyError(err, "Could not cancel challenge", setError, setMessage);
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
            #{challenge.onchainChallengeId} - {challengeStatusLabel(challenge.status)}
          </span>
          <h3>{formatUsdc(challenge.creatorAmount)} prize bank</h3>
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
              {busy === `join:${challenge.id}` ? "Joining..." : `Attack ticket - ${formatUsdc(challenge.entryFee)}`}
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
          <span className={styles.eyebrow}>Async 5x5 challenge mode</span>
          <h1>Sea Challenge</h1>
          <p>
            Fund a prize bank, hide a compact 5x5 fleet, and let one attacker buy a fixed shot run.
            Every hit raises the cashout coefficient. Full clear pays the biggest multiplier, while drops
            always receive 10% of the pot.
          </p>
          <div className={styles.heroTags}>
            <span>5x5 grid</span>
            <span>8 ship cells</span>
            <span>cashout any time</span>
          </div>
        </div>
        <div className={styles.heroStats}>
          <span>Pot split</span>
          <strong>90 / 10</strong>
          <span>Prize bank + attack ticket</span>
        </div>
      </header>

      {wallet && (
        <section className={styles.claimPanel}>
          <div>
            <span className={styles.eyebrow}>Payout vault</span>
            <strong>{formatUsdc(pendingPayout)}</strong>
            <p>All finished challenge payouts stack here and can be claimed together.</p>
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
        <div className={styles.banner}>Challenge contract is being activated. The mode preview is visible now.</div>
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
              <h2>Build a challenge</h2>
            </div>
            <div className={styles.choiceSection}>
              <div className={styles.choiceHead}>
                <span>Prize bank</span>
                <b>Creator funds this amount</b>
              </div>
              <div className={styles.presetGrid}>
                {PRIZE_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className={`${styles.presetCard} ${selectedPrizeId === preset.id ? styles.selectedPreset : ""}`}
                    onClick={() => setSelectedPrizeId(preset.id)}
                  >
                    <span>{preset.label}</span>
                    <strong>{preset.amount} USDC</strong>
                    <small>{preset.note}</small>
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.choiceSection}>
              <div className={styles.choiceHead}>
                <span>Attack format</span>
                <b>Fixed shot variants</b>
              </div>
              <div className={styles.formatGrid}>
                {MOVE_PRESETS.map((preset) => {
                  const payout = calculateChallengePayouts(
                    selectedCreatorAmount,
                    parseUsdcInput(preset.entryFee),
                    CHALLENGE_TOTAL_SHIP_CELLS,
                  );
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      className={`${styles.formatCard} ${selectedMoveId === preset.id ? styles.selectedPreset : ""}`}
                      onClick={() => setSelectedMoveId(preset.id)}
                    >
                      <span>{preset.label}</span>
                      <strong>{preset.moves} shots</strong>
                      <small>Attack ticket {preset.entryFee} USDC</small>
                      <em>Full clear {formatMultiplier(payout.challengerPayout, parseUsdcInput(preset.entryFee))}</em>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className={styles.economyBox}>
              <span>Selected setup</span>
              <b>
                {formatUsdc(selectedCreatorAmount)} bank / {formatUsdc(selectedEntryAmount)} ticket / {selectedMovePreset.moves} shots
              </b>
              <small>
                Full clear pays {formatUsdc(selectedFullClear.challengerPayout)} to the attacker.
                Drops receive {formatUsdc(selectedFullClear.dropFee)}.
              </small>
            </div>
            <div className={styles.ladderHead}>
              <span>Cashout ladder</span>
              <b>90% pot x (hits / 8)^2</b>
            </div>
            <div className={styles.previewLadder}>
              {Array.from({ length: CHALLENGE_TOTAL_SHIP_CELLS }, (_, index) => {
                const hits = index + 1;
                const payout = calculateChallengePayouts(selectedCreatorAmount, selectedEntryAmount, hits);
                return (
                  <span key={hits}>
                    <b>{hits} hit</b>
                    <em>{formatUsdc(payout.challengerPayout)}</em>
                    <small>{formatMultiplier(payout.challengerPayout, selectedEntryAmount)} - {cashoutPercent(hits)}</small>
                  </span>
                );
              })}
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
                <h2>Your runs</h2>
              </div>
              <div className={styles.list}>
                {myChallenges.length === 0 ? (
                  <p className={styles.empty}>No active runs yet.</p>
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
                <h2>Open targets</h2>
              </div>
              <button type="button" className={styles.refresh} onClick={loadLists}>
                Refresh
              </button>
            </div>
            <div className={styles.list}>
              {openChallenges.length === 0 ? (
                <p className={styles.empty}>No open targets right now.</p>
              ) : (
                openChallenges.map((challenge) => renderChallengeCard(challenge, "open"))
              )}
            </div>
          </section>

          <section className={`${styles.panel} ${styles.attackPanel}`}>
            <div className={styles.panelHeadRow}>
              <div>
                <span className={styles.eyebrow}>Attack board</span>
                <h2>{selected ? `Target #${selected.onchainChallengeId}` : "Select a target"}</h2>
              </div>
              {selected && (
                <div className={styles.counter}>
                  <b>{selected.hits}</b> hits - <b>{selected.movesUsed}</b>/{selected.maxMoves} shots
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
                      <span className={styles.eyebrow}>Cashout ladder</span>
                      <h3>Coefficient grows with hits</h3>
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
                          <b>{hits} hit</b>
                          <em>{formatUsdc(payout.challengerPayout)} / {formatMultiplier(payout.challengerPayout, BigInt(selected.entryFee))}</em>
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
                    10% of the full pot goes to drops. The remaining 90% is split by the ladder:
                    attacker receives the current cashout, bank owner receives the rest.
                  </p>
                </div>
              </>
            ) : (
              <div className={styles.emptyState}>
                <b>No target selected</b>
                <span>Pick an open target or reopen one of your runs from the left panel.</span>
              </div>
            )}
          </section>
        </section>
      </section>
    </main>
  );
}
