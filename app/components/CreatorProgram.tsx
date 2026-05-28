"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { base } from "wagmi/chains";
import { BUILDER_CODE_SUFFIX } from "../providers";
import { DROP_CLAIM_CONTRACT_ADDRESS, dropClaimAbi } from "../contracts/dropClaimAbi";
import { CheckIcon, ExternalLinkIcon, ScrollIcon } from "./Icons";
import styles from "./QuestHub.module.css";

type Submission = {
  id: number;
  url: string;
  status: string;
  admin_note?: string | null;
  created_at: string;
};

type Reward = {
  id: number;
  reward_kind: string;
  points?: number | null;
  item_slug?: string | null;
  quantity?: number | null;
  amount_raw?: string | null;
  reward_label?: string | null;
  status: string;
  created_at: string;
};

interface CreatorProgramProps {
  address: string;
}

export default function CreatorProgram({ address }: CreatorProgramProps) {
  const [url, setUrl] = useState("");
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [claimingRewardId, setClaimingRewardId] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const confirmedRef = useRef(false);
  const claimingDropIdRef = useRef<string | null>(null);

  const {
    data: claimHash,
    writeContract,
    isPending: claimPending,
    error: claimWriteError,
    reset: resetClaim,
  } = useWriteContract();
  const { data: claimReceipt } = useWaitForTransactionReceipt({ hash: claimHash });

  const load = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/creator-program?wallet=${encodeURIComponent(address)}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Could not load creator program");
      setSubmissions(data?.submissions ?? []);
      setRewards(data?.rewards ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load creator program");
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (claimWriteError) {
      setError(claimWriteError.message.slice(0, 180));
      setClaimingRewardId(null);
      claimingDropIdRef.current = null;
    }
  }, [claimWriteError]);

  useEffect(() => {
    if (
      !claimReceipt ||
      claimReceipt.status !== "success" ||
      !claimingDropIdRef.current ||
      !address ||
      confirmedRef.current
    ) {
      return;
    }

    const dropId = claimingDropIdRef.current;
    confirmedRef.current = true;
    fetch("/api/drops/mark-claimed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet: address, dropId, txHash: claimReceipt.transactionHash }),
    })
      .catch(() => {})
      .finally(() => {
        setMessage("Reward claimed");
        setClaimingRewardId(null);
        claimingDropIdRef.current = null;
        load();
      });
  }, [claimReceipt, address, load]);

  const pendingCount = useMemo(
    () => submissions.filter((entry) => entry.status === "pending").length,
    [submissions],
  );

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!address || submitting) return;

    setSubmitting(true);
    setMessage("");
    setError("");
    try {
      const res = await fetch("/api/creator-program", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: address, url }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Could not submit link");
      setUrl("");
      setMessage("Link submitted");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit link");
    } finally {
      setSubmitting(false);
    }
  };

  const claimReward = async (reward: Reward) => {
    if (!address || claimPending || claimingRewardId !== null) return;

    const dropId = `creator-reward-${reward.id}`;
    setError("");
    setMessage("");
    setClaimingRewardId(reward.id);
    claimingDropIdRef.current = dropId;
    confirmedRef.current = false;
    resetClaim();

    try {
      const res = await fetch("/api/drops/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: address, dropId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Could not sign claim");

      writeContract({
        address: (data.contractAddress || DROP_CLAIM_CONTRACT_ADDRESS) as `0x${string}`,
        abi: dropClaimAbi,
        functionName: "claim",
        args: [
          data.dropIdBytes32 as `0x${string}`,
          data.token as `0x${string}`,
          BigInt(data.amount),
          BigInt(data.deadline),
          data.signature as `0x${string}`,
        ],
        chainId: base.id,
        dataSuffix: BUILDER_CODE_SUFFIX,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start claim");
      setClaimingRewardId(null);
      claimingDropIdRef.current = null;
    }
  };

  return (
    <div className={styles.creatorPane}>
      <div className={styles.creatorIntro}>
        <span className={styles.creatorIcon} aria-hidden="true">
          <ScrollIcon size={18} />
        </span>
        <span>
          <b>Creator Program</b>
          <small>{pendingCount} pending review</small>
        </span>
      </div>

      <form className={styles.creatorForm} onSubmit={onSubmit}>
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="Paste a link to your work"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
        />
        <button type="submit" disabled={submitting || !url.trim()}>
          {submitting ? "Submitting..." : "Submit"}
        </button>
      </form>

      {message && <p className={`${styles.msg} ${styles.msgSuccess}`}>{message}</p>}
      {error && <p className={`${styles.msg} ${styles.msgError}`}>{error}</p>}

      {loading ? (
        <p className={styles.loading}>Loading creator profile...</p>
      ) : (
        <>
          {rewards.length > 0 && (
            <div className={styles.creatorRewards}>
              <span className={styles.creatorSectionTitle}>Rewards</span>
              {rewards.slice(0, 5).map((reward) => (
                <div key={reward.id} className={styles.creatorRewardRow}>
                  <span>
                    <CheckIcon size={14} />
                    {rewardLabel(reward)}
                  </span>
                  {isClaimableTokenReward(reward) ? (
                    <button
                      className={styles.creatorClaimButton}
                      onClick={() => claimReward(reward)}
                      disabled={claimPending || claimingRewardId !== null}
                      type="button"
                    >
                      {claimingRewardId === reward.id ? "CLAIMING..." : "CLAIM"}
                    </button>
                  ) : (
                    <b>{reward.status}</b>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className={styles.creatorLinks}>
            <span className={styles.creatorSectionTitle}>Submitted links</span>
            {submissions.length === 0 ? (
              <p className={styles.loading}>No links submitted yet.</p>
            ) : (
              submissions.map((submission) => (
                <a
                  key={submission.id}
                  className={styles.creatorSubmission}
                  href={submission.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span>
                    <ExternalLinkIcon size={13} />
                    {submission.url}
                  </span>
                  <b className={styles[`creatorStatus_${submission.status}`]}>
                    {submission.status}
                  </b>
                </a>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

function isClaimableTokenReward(reward: Reward) {
  return (
    reward.status === "claimable" &&
    ["usdc", "base", "token"].includes(reward.reward_kind) &&
    !!reward.amount_raw
  );
}

function rewardLabel(reward: Reward) {
  if (reward.reward_label) return reward.reward_label;
  if (reward.reward_kind === "points") {
    return `+${Number(reward.points ?? 0).toLocaleString()} pts`;
  }
  if (reward.reward_kind === "item") {
    return `${Number(reward.quantity ?? 0)}x ${reward.item_slug ?? "item"}`;
  }
  if (reward.amount_raw) return `${reward.reward_kind.toUpperCase()} reward`;
  return reward.reward_kind;
}
