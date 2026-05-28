"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAccount, useConnect, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { base } from "wagmi/chains";
import { BUILDER_CODE_SUFFIX } from "../providers";
import { DROP_CLAIM_CONTRACT_ADDRESS, dropClaimAbi } from "../contracts/dropClaimAbi";
import styles from "./page.module.css";

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

export default function ClaimPage() {
  const { address, isConnected } = useAccount();
  const { connectors, connect, isPending: connectPending } = useConnect();
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [loading, setLoading] = useState(false);
  const [claimingDropId, setClaimingDropId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const confirmedRef = useRef(false);

  const { data: claimHash, writeContract, isPending: writePending, error: writeError, reset } = useWriteContract();
  const { data: receipt } = useWaitForTransactionReceipt({ hash: claimHash });

  const load = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/drops/allocations?wallet=${encodeURIComponent(address)}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Could not load drops");
      setAllocations(data?.allocations ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load drops");
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (writeError) {
      setError(writeError.message.slice(0, 180));
      setClaimingDropId(null);
    }
  }, [writeError]);

  useEffect(() => {
    if (!receipt || receipt.status !== "success" || !claimingDropId || !address || confirmedRef.current) {
      return;
    }
    confirmedRef.current = true;
    fetch("/api/drops/mark-claimed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet: address, dropId: claimingDropId, txHash: receipt.transactionHash }),
    })
      .catch(() => {})
      .finally(() => {
        setMessage("Claim confirmed");
        setClaimingDropId(null);
        load();
      });
  }, [receipt, claimingDropId, address, load]);

  const claimable = useMemo(
    () => allocations.filter((allocation) => !allocation.claimed_at),
    [allocations],
  );

  const claim = async (allocation: Allocation) => {
    if (!address || writePending) return;
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
      setClaimingDropId(null);
      setError(err instanceof Error ? err.message : "Could not start claim");
    }
  };

  return (
    <main className={styles.container}>
      <header className={styles.header}>
        <span>Sea Battle</span>
        <h1>Drop Claim</h1>
        <p>Claim active leaderboard and creator rewards from the funded contract.</p>
      </header>

      {!isConnected ? (
        <section className={styles.panel}>
          <h2>Connect wallet</h2>
          <div className={styles.connectorList}>
            {connectors.map((connector) => (
              <button
                key={connector.id}
                onClick={() => connect({ connector })}
                disabled={connectPending}
                type="button"
              >
                {connector.name}
              </button>
            ))}
          </div>
        </section>
      ) : (
        <section className={styles.panel}>
          <h2>Your active drops</h2>
          {loading ? (
            <p className={styles.loading}>Loading...</p>
          ) : claimable.length === 0 ? (
            <p className={styles.empty}>No active claim for this wallet.</p>
          ) : (
            <div className={styles.dropList}>
              {claimable.map((allocation) => {
                const campaign = campaignOf(allocation);
                const active = claimingDropId === allocation.drop_id;
                return (
                  <article key={allocation.drop_id} className={styles.dropCard}>
                    <div>
                      <b>{campaign?.title ?? allocation.drop_id}</b>
                      <span>{allocation.points.toLocaleString()} leaderboard points</span>
                    </div>
                    <strong>
                      {formatRaw(allocation.amount_raw, campaign?.decimals ?? 18)} {campaign?.token_symbol ?? "TOKEN"}
                    </strong>
                    <button onClick={() => claim(allocation)} disabled={active || writePending} type="button">
                      {active || writePending ? "Claiming..." : "Claim"}
                    </button>
                  </article>
                );
              })}
            </div>
          )}
          {message && <p className={styles.success}>{message}</p>}
          {error && <p className={styles.error}>{error}</p>}
        </section>
      )}
    </main>
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
