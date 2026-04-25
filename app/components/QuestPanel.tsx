"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  useWriteContract,
  useWaitForTransactionReceipt,
  useSendCalls,
  useCallsStatus,
  useCapabilities,
} from "wagmi";
import { base } from "wagmi/chains";
import { encodeFunctionData } from "viem";
import { seaBattleAbi, SEABATTLE_CONTRACT_ADDRESS } from "../contracts/seaBattleAbi";
import { BUILDER_CODE_SUFFIX } from "../providers";
import {
  getUserQuestsWithProgress,
  claimUserQuest,
  questSentinelAddress,
  getWeekKey,
  UserQuestState,
} from "../lib/quests";
import styles from "./QuestPanel.module.css";

const PAYMASTER_URL = process.env.NEXT_PUBLIC_PAYMASTER_URL;

interface QuestPanelProps {
  address: string;
  onPointsChanged?: () => void;
}

export default function QuestPanel({ address, onPointsChanged }: QuestPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [quests, setQuests] = useState<UserQuestState[]>([]);
  const [loading, setLoading] = useState(false);
  const [claimingId, setClaimingId] = useState<number | null>(null);
  const [msgs, setMsgs] = useState<Record<number, string>>({});
  const weekKey = getWeekKey();

  const claimingQuestIdRef = useRef<number | null>(null);
  const claimHandledRef = useRef(false);

  // Paymaster support check
  const { data: capabilities } = useCapabilities({ chainId: base.id });
  const paymasterSupported = !!PAYMASTER_URL && !!capabilities?.paymasterService?.supported;

  // EOA path
  const {
    data: claimTxHash,
    writeContract: writeClaimTx,
    isPending: claimTxPending,
    error: claimTxError,
    reset: resetClaimTx,
  } = useWriteContract();
  const { isSuccess: claimTxSuccess } = useWaitForTransactionReceipt({ hash: claimTxHash });

  // Smart wallet path
  const {
    sendCalls: sendClaimCalls,
    data: claimCallsData,
    isPending: claimCallsPending,
  } = useSendCalls();
  const { data: claimCallsStatus } = useCallsStatus({
    id: claimCallsData?.id ?? "",
    query: {
      enabled: !!claimCallsData?.id,
      refetchInterval: ({ state }) =>
        state.data?.status === "success" ? false : 1500,
    },
  });
  const claimCallsSuccess = claimCallsStatus?.status === "success";

  const claimOnchainSuccess = claimTxSuccess || claimCallsSuccess;
  const claimPending = claimTxPending || claimCallsPending;

  const loadQuests = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    try {
      const data = await getUserQuestsWithProgress(address);
      setQuests(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    if (expanded && address) loadQuests();
  }, [expanded, address, loadQuests]);

  // On tx confirm → award points in DB
  useEffect(() => {
    if (!claimOnchainSuccess || claimHandledRef.current) return;
    if (claimingQuestIdRef.current === null) return;
    claimHandledRef.current = true;
    const questId = claimingQuestIdRef.current;
    claimingQuestIdRef.current = null;

    claimUserQuest(address, questId)
      .then(({ reward }) => {
        setMsgs(prev => ({ ...prev, [questId]: `+${reward.toLocaleString()} pts!` }));
        setQuests(prev =>
          prev.map(q => q.definition.id === questId ? { ...q, claimed: true } : q)
        );
        onPointsChanged?.();
      })
      .catch(err => {
        setMsgs(prev => ({ ...prev, [questId]: err.message || "Claim failed" }));
      })
      .finally(() => setClaimingId(null));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claimOnchainSuccess]);

  // On tx error
  useEffect(() => {
    if (!claimTxError || claimingId === null) return;
    const raw = claimTxError.message || "Transaction failed";
    const short = raw.includes("User rejected") || raw.includes("user rejected")
      ? "Rejected"
      : raw.slice(0, 80);
    setMsgs(prev => ({ ...prev, [claimingId]: short }));
    setClaimingId(null);
    claimingQuestIdRef.current = null;
  }, [claimTxError, claimingId]);

  const handleClaim = (questId: number) => {
    if (claimingId !== null || claimPending) return;
    setClaimingId(questId);
    claimingQuestIdRef.current = questId;
    claimHandledRef.current = false;
    setMsgs(prev => ({ ...prev, [questId]: "" }));
    resetClaimTx();

    const sentinel = questSentinelAddress(questId);

    if (paymasterSupported && PAYMASTER_URL) {
      sendClaimCalls({
        calls: [{
          to: SEABATTLE_CONTRACT_ADDRESS,
          data: encodeFunctionData({
            abi: seaBattleAbi,
            functionName: "recordSoloResult",
            args: [sentinel, true],
          }),
        }],
        capabilities: { paymasterService: { url: PAYMASTER_URL } },
      });
      return;
    }

    writeClaimTx({
      address: SEABATTLE_CONTRACT_ADDRESS,
      abi: seaBattleAbi,
      functionName: "recordSoloResult",
      args: [sentinel, true],
      chainId: base.id,
      dataSuffix: BUILDER_CODE_SUFFIX,
    });
  };

  const completedCount = quests.filter(q => q.completed && !q.claimed).length;
  const claimedCount = quests.filter(q => q.claimed).length;

  return (
    <div className={styles.questSection}>
      <button
        className={styles.questHeader}
        onClick={() => setExpanded(v => !v)}
        type="button"
      >
        <div className={styles.questHeaderLeft}>
          <span className={styles.questLabel}>Weekly Quests</span>
          <span className={styles.questWeek}>{weekKey}</span>
        </div>
        <div className={styles.questHeaderRight}>
          {completedCount > 0 && (
            <span className={styles.questBadge}>{completedCount} ready</span>
          )}
          <span className={styles.questChevron}>{expanded ? "▾" : "▸"}</span>
        </div>
      </button>

      {expanded && (
        <div className={styles.questBody}>
          {loading ? (
            <p className={styles.questLoadingText}>Loading quests...</p>
          ) : (
            quests.map(q => {
              const { definition: def, progress, completed, claimed } = q;
              const pct = Math.min(100, (progress / def.goal) * 100);
              const isActive = claimingId === def.id;
              const msg = msgs[def.id];

              return (
                <div
                  key={def.id}
                  className={`${styles.questCard} ${
                    claimed ? styles.questCardClaimed : completed ? styles.questCardComplete : ""
                  }`}
                >
                  <div className={styles.questCardTop}>
                    <div className={styles.questCardInfo}>
                      <span className={styles.questCardName}>{def.name}</span>
                      <span className={styles.questCardDesc}>{def.desc}</span>
                    </div>
                    <span className={styles.questCardReward}>
                      +{def.reward.toLocaleString()} pts
                    </span>
                  </div>

                  <div className={styles.questProgressRow}>
                    <div className={styles.questProgressBar}>
                      <div
                        className={styles.questProgressFill}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className={styles.questProgressLabel}>
                      {Math.min(progress, def.goal)}/{def.goal}
                    </span>
                  </div>

                  {claimed ? (
                    <span className={styles.questClaimedBadge}>Claimed ✓</span>
                  ) : completed ? (
                    <button
                      className={styles.questClaimBtn}
                      onClick={() => handleClaim(def.id)}
                      disabled={isActive || (claimPending && claimingId !== def.id)}
                    >
                      {isActive
                        ? claimPending
                          ? "Confirm in wallet..."
                          : "Processing..."
                        : paymasterSupported
                          ? "Claim · FREE"
                          : "Claim (1 tx)"}
                    </button>
                  ) : null}

                  {msg && (
                    <p
                      className={`${styles.questMsg} ${
                        msg.startsWith("+") ? styles.questMsgSuccess : styles.questMsgError
                      }`}
                    >
                      {msg}
                    </p>
                  )}
                </div>
              );
            })
          )}

          {!loading && quests.length > 0 && (
            <p className={styles.questFooter}>
              {claimedCount}/{quests.length} claimed · resets next Monday
            </p>
          )}
        </div>
      )}
    </div>
  );
}
