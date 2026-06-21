"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { base } from "wagmi/chains";
import { BUILDER_CODE_SUFFIX } from "../providers";
import { DROP_CLAIM_CONTRACT_ADDRESS, dropClaimAbi } from "../contracts/dropClaimAbi";
import { useSettings } from "../lib/settings";
import styles from "./DropClaimPanel.module.css";

type Campaign = {
  id: string;
  title: string;
  token_address: string;
  token_symbol: string;
  decimals: number;
  status: string;
  contract_address?: string | null;
};

type Allocation = {
  drop_id: string;
  points: number;
  amount_raw: string;
  claimed_at?: string | null;
  claim_tx_hash?: string | null;
  drop_campaigns: Campaign | Campaign[];
};

export function DropClaimPanel({ address }: { address: `0x${string}` }) {
  const { lang } = useSettings();
  const ru = lang === "ru";
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [loading, setLoading] = useState(false);
  const [claimingDropId, setClaimingDropId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const confirmedRef = useRef(false);

  const {
    data: claimHash,
    writeContract,
    isPending: writePending,
    error: writeError,
    reset,
  } = useWriteContract();
  const { data: receipt } = useWaitForTransactionReceipt({ hash: claimHash });

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/drops/allocations?wallet=${encodeURIComponent(address)}`, {
        cache: "no-store",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || (ru ? "Не удалось загрузить дропы" : "Could not load drops"));
      setAllocations(data?.allocations ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : ru ? "Не удалось загрузить дропы" : "Could not load drops");
    } finally {
      setLoading(false);
    }
  }, [address, ru]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!writeError) return;
    setError(writeError.message.slice(0, 180));
    setClaimingDropId(null);
  }, [writeError]);

  useEffect(() => {
    if (!receipt || receipt.status !== "success" || !claimingDropId || confirmedRef.current) return;
    confirmedRef.current = true;
    fetch("/api/drops/mark-claimed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet: address, dropId: claimingDropId, txHash: receipt.transactionHash }),
    })
      .catch(() => {})
      .finally(() => {
        setMessage(ru ? "Дроп получен" : "Drop claimed");
        setClaimingDropId(null);
        load();
      });
  }, [receipt, claimingDropId, address, load, ru]);

  const claimable = useMemo(
    () => allocations.filter((allocation) => !allocation.claimed_at),
    [allocations],
  );

  const claim = async (allocation: Allocation) => {
    if (writePending) return;
    setError("");
    setMessage("");
    reset();
    confirmedRef.current = false;
    setClaimingDropId(allocation.drop_id);

    try {
      const res = await fetch("/api/drops/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: address, dropId: allocation.drop_id }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || (ru ? "Не удалось подписать claim" : "Could not sign claim"));

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
      setClaimingDropId(null);
      setError(err instanceof Error ? err.message : ru ? "Не удалось начать claim" : "Could not start claim");
    }
  };

  return (
    <section className={styles.panel}>
      <div className={styles.head}>
        <span>
          {ru ? "USDC ДРОП" : "USDC DROP"}
          <b>{ru ? "Клейм наград" : "Claim rewards"}</b>
        </span>
        <span className={styles.badge}>{claimable.length}</span>
      </div>

      {loading ? (
        <p className={styles.empty}>{ru ? "Загрузка..." : "Loading..."}</p>
      ) : claimable.length === 0 ? (
        <p className={styles.empty}>
          {ru ? "После снапшота здесь появится твой USDC claim." : "After the snapshot your USDC claim will appear here."}
        </p>
      ) : (
        claimable.slice(0, 3).map((allocation) => {
          const campaign = campaignOf(allocation);
          const active = claimingDropId === allocation.drop_id;
          return (
            <article key={allocation.drop_id} className={styles.drop}>
              <span className={styles.dropTitle}>
                <b>{campaign?.title ?? allocation.drop_id}</b>
                <span>
                  {allocation.points > 0
                    ? `${allocation.points.toLocaleString()} ${ru ? "очков снапшота" : "snapshot points"}`
                    : ru ? "Персональная награда" : "Personal reward"}
                </span>
              </span>
              <span className={styles.amount}>
                <strong>{formatRaw(allocation.amount_raw, campaign?.decimals ?? 18)}</strong>
                <small>{campaign?.token_symbol ?? "TOKEN"}</small>
              </span>
              <button className={styles.claim} onClick={() => claim(allocation)} disabled={active || writePending} type="button">
                {active || writePending ? (ru ? "Клейм..." : "Claiming...") : (ru ? "Забрать" : "Claim")}
              </button>
            </article>
          );
        })
      )}

      {message && <p className={`${styles.status} ${styles.success}`}>{message}</p>}
      {error && <p className={`${styles.status} ${styles.error}`}>{error}</p>}
    </section>
  );
}

function campaignOf(allocation: Allocation) {
  return Array.isArray(allocation.drop_campaigns)
    ? allocation.drop_campaigns[0]
    : allocation.drop_campaigns;
}

function formatRaw(raw: string, decimals: number) {
  const value = BigInt(raw || "0");
  const scale = BigInt(10) ** BigInt(Math.max(0, decimals));
  const whole = value / scale;
  const fraction = value % scale;
  if (fraction === BigInt(0)) return whole.toLocaleString();

  const fractionText = fraction.toString().padStart(decimals, "0").slice(0, 4).replace(/0+$/, "");
  return `${whole.toLocaleString()}${fractionText ? `.${fractionText}` : ""}`;
}
