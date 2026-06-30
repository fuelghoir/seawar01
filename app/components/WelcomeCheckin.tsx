"use client";

import { useState, useEffect, useRef } from "react";
import {
  useWriteContract,
  useWaitForTransactionReceipt,
  useSendCalls,
  useCallsStatus,
  useCapabilities,
  useConfig,
} from "wagmi";
import { waitForTransactionReceipt as waitForReceipt } from "@wagmi/core";
import { base } from "wagmi/chains";
import { encodeFunctionData } from "viem";
import { seaBattleAbi, SEABATTLE_CONTRACT_ADDRESS } from "../contracts/seaBattleAbi";
import { BUILDER_CODE_SUFFIX } from "../providers";
import { getCheckinStatus, dailyCheckin, CheckinStatus } from "../lib/offchainGame";
import { notifyPlayerDataRefresh } from "../lib/playerDataEvents";
import { useSettings, TR } from "../lib/settings";
import { useTransactionWarmup } from "../lib/useTransactionWarmup";
import styles from "./WelcomeCheckin.module.css";

const PAYMASTER_URL = process.env.NEXT_PUBLIC_PAYMASTER_URL;
const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

export function WelcomeCheckin({
  address,
  onClose,
  onCheckedIn,
}: {
  address: string;
  onClose: () => void;
  onCheckedIn?: () => void;
}) {
  const { lang } = useSettings();
  const wagmiConfig = useConfig();
  const tr = TR[lang];
  const txWarmReady = useTransactionWarmup(Boolean(address), address);
  const [checkin, setCheckin] = useState<CheckinStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [txFallbackMined, setTxFallbackMined] = useState(false);
  const [callsFallbackSuccess, setCallsFallbackSuccess] = useState(false);
  const recordedRef = useRef(false);

  const { data: capabilities } = useCapabilities({ chainId: base.id });
  const paymasterSupported =
    !!PAYMASTER_URL && !!capabilities?.paymasterService?.supported;

  const {
    sendCalls,
    data: callsData,
    isPending: callsPending,
  } = useSendCalls();
  const { data: callsStatus } = useCallsStatus({
    id: callsData?.id ?? "",
    query: {
      enabled: !!callsData?.id,
      refetchInterval: ({ state }) =>
        state.data?.status === "success" ? false : 1500,
    },
  });
  const callsSuccess = callsStatus?.status === "success";

  const {
    data: txHash,
    writeContract,
    isPending: txPending,
  } = useWriteContract();
  const { data: txReceipt } = useWaitForTransactionReceipt({ hash: txHash });

  useEffect(() => {
    setTxFallbackMined(false);
    if (!txHash) return;
    let cancelled = false;
    waitForReceipt(wagmiConfig, { hash: txHash })
      .then((receipt) => {
        if (!cancelled && receipt.status === "success") setTxFallbackMined(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [txHash, wagmiConfig]);

  useEffect(() => {
    setCallsFallbackSuccess(false);
    if (!callsData?.id || !loading) return;
    const timer = window.setTimeout(() => setCallsFallbackSuccess(true), 12_000);
    return () => window.clearTimeout(timer);
  }, [callsData?.id, loading]);

  const txSuccess = txReceipt?.status === "success" || txFallbackMined;
  const success = txSuccess || callsSuccess || callsFallbackSuccess;
  const pending = txPending || callsPending;

  useEffect(() => {
    let cancelled = false;
    getCheckinStatus(address)
      .then((s) => {
        if (!cancelled) setCheckin(s);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [address]);

  useEffect(() => {
    if (!success || recordedRef.current) return;
    recordedRef.current = true;
    setCheckin((current) => current ? { ...current, canCheckin: false } : current);
    dailyCheckin(address)
      .then((res) => {
        setMsg(`+${res.points} ${tr.shop_pts}! ${tr.streak}: ${res.streak}d`);
        notifyPlayerDataRefresh();
        onCheckedIn?.();
        setTimeout(() => onClose(), 1500);
      })
      .catch(() => {
        setMsg(tr.checkin_already_done);
        setTimeout(() => onClose(), 1500);
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [success]);

  const handleCheckin = () => {
    if (!txWarmReady || !checkin?.canCheckin || loading) return;
    if (SEABATTLE_CONTRACT_ADDRESS === ZERO_ADDR) {
      setMsg(tr.contract_not_deployed);
      return;
    }
    setLoading(true);
    setMsg("");
    recordedRef.current = false;

    if (paymasterSupported && PAYMASTER_URL) {
      sendCalls({
        calls: [
          {
            to: SEABATTLE_CONTRACT_ADDRESS,
            data: encodeFunctionData({
              abi: seaBattleAbi,
              functionName: "checkin",
            }),
            dataSuffix: BUILDER_CODE_SUFFIX,
          },
        ],
        capabilities: { paymasterService: { url: PAYMASTER_URL } },
      });
      return;
    }

    writeContract({
      address: SEABATTLE_CONTRACT_ADDRESS,
      abi: seaBattleAbi,
      functionName: "checkin",
      chainId: base.id,
      dataSuffix: BUILDER_CODE_SUFFIX,
    });
  };

  if (!checkin) return null;
  if (!checkin.canCheckin) return null;

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <button className={styles.close} onClick={onClose} aria-label={tr.play_modal_close}>
          ×
        </button>

        <div className={styles.icon} aria-hidden="true">⚓</div>
        <h2 className={styles.title}>{tr.welcome_checkin}</h2>
        <p className={styles.sub}>{tr.welcome_checkin_sub}</p>

        <div className={styles.reward}>
          <span className={styles.rewardLabel}>{tr.streak}</span>
          <span className={styles.rewardValue}>{checkin.streak}d</span>
          <span className={styles.rewardSeparator}>·</span>
          <span className={styles.rewardLabel}>+</span>
          <span className={styles.rewardValue}>{checkin.nextReward} {tr.shop_pts}</span>
        </div>

        <button
          className={styles.btn}
          onClick={handleCheckin}
          disabled={!txWarmReady || loading || pending}
        >
          {!txWarmReady
            ? tr.quest_processing
            : pending
            ? tr.shop_bomb_pending
            : loading
              ? tr.quest_processing
              : paymasterSupported
                ? `${tr.checkin_btn} · ${tr.checkin_free}`
                : tr.checkin_btn}
        </button>

        {msg && <p className={styles.msg}>{msg}</p>}

        <button className={styles.skip} onClick={onClose}>
          {tr.welcome_skip}
        </button>
      </div>
    </div>
  );
}
