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
  rerollUserQuest,
  validateUserQuestClaim,
  questSentinelAddress,
  getWeekKey,
  UserQuestState,
} from "../lib/quests";
import { getItemQuantity } from "../lib/season";
import { QUESTS_RU } from "../lib/questsRu";
import { useSettings, TR } from "../lib/settings";
import styles from "./QuestPanel.module.css";

const PAYMASTER_URL = process.env.NEXT_PUBLIC_PAYMASTER_URL;

interface QuestPanelProps {
  address: string;
  onPointsChanged?: () => void;
  hideHeader?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
}

export default function QuestPanel({
  address,
  onPointsChanged,
  hideHeader = false,
  expanded: controlledExpanded,
  onToggleExpand,
}: QuestPanelProps) {
  const { lang } = useSettings();
  const tr = TR[lang];
  const [internalExpanded, setInternalExpanded] = useState(false);
  const expanded = controlledExpanded ?? internalExpanded;
  const toggle = () => {
    if (onToggleExpand) onToggleExpand();
    else setInternalExpanded(v => !v);
  };
  const [quests, setQuests] = useState<UserQuestState[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [claimingId, setClaimingId] = useState<number | null>(null);
  const [rerollingId, setRerollingId] = useState<number | null>(null);
  const [rerolls, setRerolls] = useState(0);
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
  const { data: claimTxReceipt } = useWaitForTransactionReceipt({ hash: claimTxHash });
  const claimTxSuccess = claimTxReceipt?.status === "success";

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
    setLoadError("");
    try {
      const [data, rerollQty] = await Promise.all([
        getUserQuestsWithProgress(address),
        getItemQuantity(address, "quest_reroll").catch(() => 0),
      ]);
      setQuests(data);
      setRerolls(rerollQty);
    } catch (err) {
      setQuests([]);
      setLoadError(err instanceof Error ? err.message : "Could not load quests");
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
        setMsgs(prev => ({ ...prev, [questId]: `+${reward.toLocaleString()} ${tr.shop_pts}!` }));
        setQuests(prev =>
          prev.map(q => q.definition.id === questId ? { ...q, claimed: true } : q)
        );
        onPointsChanged?.();
        loadQuests();
      })
      .catch(err => {
        setMsgs(prev => ({ ...prev, [questId]: err.message || tr.shop_claim_failed }));
        loadQuests();
      })
      .finally(() => setClaimingId(null));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claimOnchainSuccess]);

  // On tx error
  useEffect(() => {
    if (!claimTxError || claimingId === null) return;
    const raw = claimTxError.message || tr.shop_claim_failed;
    const short = raw.includes("User rejected") || raw.includes("user rejected")
      ? tr.tx_rejected
      : raw.slice(0, 80);
    setMsgs(prev => ({ ...prev, [claimingId]: short }));
    setClaimingId(null);
    claimingQuestIdRef.current = null;
  }, [claimTxError, claimingId, tr.shop_claim_failed, tr.tx_rejected]);

  const handleClaim = async (questId: number) => {
    if (claimingId !== null || claimPending) return;
    setClaimingId(questId);
    setMsgs(prev => ({ ...prev, [questId]: "" }));
    resetClaimTx();

    try {
      await validateUserQuestClaim(address, questId);
      await loadQuests();
    } catch (err) {
      setMsgs(prev => ({
        ...prev,
        [questId]: err instanceof Error ? err.message : tr.quest_not_ready,
      }));
      setClaimingId(null);
      claimingQuestIdRef.current = null;
      claimHandledRef.current = true;
      loadQuests();
      return;
    }

    claimingQuestIdRef.current = questId;
    claimHandledRef.current = false;
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

  const handleReroll = async (questId: number) => {
    if (rerollingId !== null || claimingId !== null || claimPending || rerolls <= 0) return;
    setRerollingId(questId);
    setMsgs(prev => ({ ...prev, [questId]: "" }));

    try {
      const { definition } = await rerollUserQuest(address, questId);
      const name = lang === "ru" ? (QUESTS_RU[definition.id]?.name ?? definition.name) : definition.name;
      setMsgs(prev => ({ ...prev, [questId]: `${tr.quest_rerolled_into} ${name}` }));
      await loadQuests();
    } catch (err) {
      setMsgs(prev => ({
        ...prev,
        [questId]: err instanceof Error ? err.message : tr.quest_reroll_failed,
      }));
    } finally {
      setRerollingId(null);
    }
  };

  const completedCount = quests.filter(q => q.completed && !q.claimed).length;
  const claimedCount = quests.filter(q => q.claimed).length;

  return (
    <div className={styles.questSection}>
      {!hideHeader && (
        <button
          className={styles.questHeader}
          onClick={toggle}
          type="button"
        >
          <div className={styles.questHeaderLeft}>
            <span className={styles.questLabel}>{tr.weekly_quests}</span>
            <span className={styles.questWeek}>{weekKey}</span>
          </div>
          <div className={styles.questHeaderRight}>
            {rerolls > 0 && (
              <span className={styles.questRerollCount}>{rerolls} {tr.quest_reroll_one}</span>
            )}
            {completedCount > 0 && (
              <span className={styles.questBadge}>{completedCount} {tr.quests_ready}</span>
            )}
            <span className={styles.questChevron}>{expanded ? "▾" : "▸"}</span>
          </div>
        </button>
      )}

      {expanded && (
        <div className={styles.questBody}>
          {loading ? (
            <p className={styles.questLoadingText}>{tr.quests_loading}</p>
          ) : loadError ? (
            <p className={styles.questLoadingText}>{loadError}</p>
          ) : (
            quests.map(q => {
              const { definition: def, progress, completed, claimed } = q;
              const pct = Math.min(100, (progress / def.goal) * 100);
              const isActive = claimingId === def.id;
              const isRerolling = rerollingId === def.id;
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
                      <span className={styles.questCardName}>
                        {lang === "ru" ? (QUESTS_RU[def.id]?.name ?? def.name) : def.name}
                      </span>
                      <span className={styles.questCardDesc}>
                        {lang === "ru" ? (QUESTS_RU[def.id]?.desc ?? def.desc) : def.desc}
                      </span>
                    </div>
                    <span className={styles.questCardReward}>
                      +{def.reward.toLocaleString()} {tr.shop_pts}
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
                    <span className={styles.questClaimedBadge}>{tr.quest_claimed}</span>
                  ) : completed ? (
                    <div className={styles.questActions}>
                      <button
                        className={styles.questClaimBtn}
                        onClick={() => handleClaim(def.id)}
                        disabled={isActive || (claimPending && claimingId !== def.id)}
                      >
                        {isActive
                          ? claimPending
                            ? tr.shop_bomb_pending
                            : tr.quest_processing
                          : paymasterSupported
                            ? tr.quest_claim_free
                            : tr.quest_claim_tx}
                      </button>
                    </div>
                  ) : rerolls > 0 ? (
                    <div className={styles.questActions}>
                      <button
                        className={styles.questRerollBtn}
                        onClick={() => handleReroll(def.id)}
                        disabled={rerolls <= 0 || isRerolling || rerollingId !== null}
                        type="button"
                      >
                        {isRerolling ? tr.quest_rerolling : tr.quest_reroll_one}
                      </button>
                    </div>
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
              {claimedCount}/{quests.length} {tr.quest_footer}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
