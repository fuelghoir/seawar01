"use client";

import { useEffect, useState } from "react";
import styles from "../home.module.css";

type Reward = {
  id: number;
  reward_kind: string;
  points?: number | null;
  item_slug?: string | null;
  quantity?: number | null;
  amount_raw?: string | null;
  reward_label?: string | null;
  status: string;
};

export default function CreatorRewardsSummary({ address }: { address: string }) {
  const [rewards, setRewards] = useState<Reward[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/creator-program?wallet=${encodeURIComponent(address)}`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setRewards(data?.rewards ?? []);
      })
      .catch(() => {
        if (!cancelled) setRewards([]);
      });
    return () => {
      cancelled = true;
    };
  }, [address]);

  if (rewards.length === 0) return null;

  return (
    <div className={styles.creatorRewardSummary}>
      <div className={styles.creatorRewardSummaryHead}>
        <span>Creator rewards</span>
        <b>{rewards.length}</b>
      </div>
      {rewards.slice(0, 3).map((reward) => (
        <div key={reward.id} className={styles.creatorRewardSummaryRow}>
          <span>{rewardLabel(reward)}</span>
          <b>{reward.status}</b>
        </div>
      ))}
    </div>
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
