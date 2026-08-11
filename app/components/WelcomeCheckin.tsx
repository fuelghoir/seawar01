"use client";

import { useState, useEffect, useRef } from "react";
import {
  useWriteContract,
  useSendCalls,
  useCapabilities,
  useConfig,
} from "wagmi";
import {
  waitForCallsStatus,
  waitForTransactionReceipt as waitForReceipt,
} from "@wagmi/core";
import { base } from "wagmi/chains";
import { encodeFunctionData } from "viem";
import { seaBattleAbi, SEABATTLE_CONTRACT_ADDRESS } from "../contracts/seaBattleAbi";
import { BUILDER_CODE_SUFFIX } from "../providers";
import { getCheckinStatus, dailyCheckin, CheckinStatus } from "../lib/offchainGame";
import {
  checkinDayKey,
  markCheckinConfirmed,
  markCheckinPending,
} from "../lib/checkinClient";
import { notifyPlayerDataRefresh } from "../lib/playerDataEvents";
import { useSettings, TR } from "../lib/settings";
import { useTransactionWarmup } from "../lib/useTransactionWarmup";
import styles from "./WelcomeCheckin.module.css";

const PAYMASTER_URL = process.env.NEXT_PUBLIC_PAYMASTER_URL;
const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

type CheckinAttempt = {
  id: number;
  wallet: string;
  dayKey: string;
  walletSession: object;
};

export function WelcomeCheckin({
  address,
  walletSession,
  onClose,
  onTransactionConfirmed,
  onClaimFailed,
  onCheckedIn,
}: {
  address: string;
  walletSession: object;
  onClose: () => void;
  onTransactionConfirmed?: (wallet: string, walletSession: object) => void;
  onClaimFailed?: (wallet: string, walletSession: object) => void;
  onCheckedIn?: (wallet: string, walletSession: object) => void;
}) {
  const { lang } = useSettings();
  const wagmiConfig = useConfig();
  const tr = TR[lang];
  const txWarmReady = useTransactionWarmup(Boolean(address), address);
  const [checkin, setCheckin] = useState<CheckinStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const attemptIdRef = useRef(0);
  const activeAttemptRef = useRef<CheckinAttempt | null>(null);
  const currentWalletRef = useRef(address.toLowerCase());
  const closeTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(false);
  currentWalletRef.current = address.toLowerCase();

  const { data: capabilities } = useCapabilities({ chainId: base.id });
  const paymasterSupported =
    !!PAYMASTER_URL && !!capabilities?.paymasterService?.supported;

  const {
    sendCallsAsync,
    isPending: callsPending,
    reset: resetSendCalls,
  } = useSendCalls();

  const {
    writeContractAsync,
    isPending: txPending,
    reset: resetWriteContract,
  } = useWriteContract();
  const pending = txPending || callsPending;

  useEffect(() => {
    const wallet = address.toLowerCase();
    let cancelled = false;
    activeAttemptRef.current = null;
    setCheckin(null);
    setLoading(false);
    setMsg("");
    resetSendCalls();
    resetWriteContract();
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }

    getCheckinStatus(wallet)
      .then((s) => {
        if (cancelled || currentWalletRef.current !== wallet) return;
        setCheckin(s);
        if (!s.canCheckin) onClose();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [address, onClose, resetSendCalls, resetWriteContract]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  const handleCheckin = async () => {
    if (!txWarmReady || !checkin?.canCheckin || loading) return;
    if (SEABATTLE_CONTRACT_ADDRESS === ZERO_ADDR) {
      setMsg(tr.contract_not_deployed);
      return;
    }
    const wallet = address.toLowerCase();
    const attempt: CheckinAttempt = {
      id: ++attemptIdRef.current,
      wallet,
      dayKey: checkinDayKey(wallet),
      walletSession,
    };
    activeAttemptRef.current = attempt;
    setLoading(true);
    setMsg("");

    const isCurrentAttempt = () =>
      mountedRef.current &&
      activeAttemptRef.current === attempt &&
      currentWalletRef.current === wallet;
    const closeCurrentAttemptSoon = () => {
      if (!isCurrentAttempt()) return;
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = window.setTimeout(() => {
        if (isCurrentAttempt()) onClose();
      }, 1500);
    };

    let chainConfirmed = false;
    try {
      if (paymasterSupported && PAYMASTER_URL) {
        const calls = await sendCallsAsync({
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
        const status = await waitForCallsStatus(wagmiConfig, {
          id: calls.id,
          pollingInterval: 1500,
          timeout: 300_000,
          throwOnFailure: true,
        });
        if (status.status !== "success") throw new Error("Check-in transaction failed");
      } else {
        const hash = await writeContractAsync({
          address: SEABATTLE_CONTRACT_ADDRESS,
          abi: seaBattleAbi,
          functionName: "checkin",
          chainId: base.id,
          dataSuffix: BUILDER_CODE_SUFFIX,
        });
        const receipt = await waitForReceipt(wagmiConfig, { hash });
        if (receipt.status !== "success") throw new Error("Check-in transaction failed");
      }

      chainConfirmed = true;
      // A transaction submitted before midnight can mine after it. Bind the
      // pending marker and API claim to the UTC day on which it confirmed so
      // the mined transaction can never lead to a second prompt.
      attempt.dayKey = checkinDayKey(wallet);
      markCheckinPending(wallet);
      onTransactionConfirmed?.(wallet, attempt.walletSession);
      if (isCurrentAttempt()) {
        setCheckin((current) => current ? { ...current, canCheckin: false } : current);
      }

      try {
        const res = await dailyCheckin(wallet);
        const claimDayIsCurrent = checkinDayKey(wallet) === attempt.dayKey;
        if (claimDayIsCurrent) markCheckinConfirmed(wallet);
        else onClaimFailed?.(wallet, attempt.walletSession);
        if (!claimDayIsCurrent) return;
        onCheckedIn?.(wallet, attempt.walletSession);
        if (!isCurrentAttempt()) return;
        setMsg(`+${res.points} ${tr.shop_pts}! ${tr.streak}: ${res.streak}d`);
        notifyPlayerDataRefresh();
        closeCurrentAttemptSoon();
      } catch (error: unknown) {
        const alreadyCheckedIn = /already checked in/i.test(
          error instanceof Error ? error.message : String(error ?? ""),
        );
        const claimDayIsCurrent = checkinDayKey(wallet) === attempt.dayKey;
        if (alreadyCheckedIn && claimDayIsCurrent) {
          markCheckinConfirmed(wallet);
          onCheckedIn?.(wallet, attempt.walletSession);
        } else {
          onClaimFailed?.(wallet, attempt.walletSession);
        }
        if (!claimDayIsCurrent) return;
        if (!isCurrentAttempt()) return;
        setMsg(alreadyCheckedIn ? tr.checkin_already_done : tr.shop_claim_failed);
        closeCurrentAttemptSoon();
      }
    } catch (error: unknown) {
      if (!chainConfirmed && isCurrentAttempt()) {
        const rejected = /reject|denied|cancel/i.test(
          error instanceof Error ? error.message : String(error ?? ""),
        );
        setMsg(rejected ? tr.tx_rejected : tr.shop_claim_failed);
      }
    } finally {
      if (isCurrentAttempt()) setLoading(false);
    }
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
