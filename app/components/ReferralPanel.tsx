"use client";

import { useState, useEffect, useCallback } from "react";
import { recordReferral, getReferralStats, getReferralLink, getBaseAppReferralLink } from "../lib/referrals";
import styles from "./ReferralPanel.module.css";

interface Props {
  address: string;
  refParam?: string | null;
}

export default function ReferralPanel({ address, refParam }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [count, setCount] = useState(0);
  const [activeCount, setActiveCount] = useState(0);
  const [copied, setCopied] = useState<"direct" | "base" | null>(null);
  const [link, setLink] = useState("");
  const [baseLink, setBaseLink] = useState("");

  useEffect(() => {
    if (address) {
      setLink(getReferralLink(address));
      setBaseLink(getBaseAppReferralLink(address));
    }
  }, [address]);

  // Record referral if ?ref= param was present in URL
  useEffect(() => {
    if (!refParam || !address) return;
    const ref = refParam.toLowerCase();
    const me = address.toLowerCase();
    if (ref === me) return;
    recordReferral(ref, me).catch(() => {});
  }, [refParam, address]);

  const loadStats = useCallback(async () => {
    if (!address) return;
    const stats = await getReferralStats(address);
    setCount(stats.count);
    setActiveCount(stats.activeCount);
  }, [address]);

  useEffect(() => {
    if (expanded) loadStats();
  }, [expanded, loadStats]);

  const handleCopy = async (text: string, type: "direct" | "base") => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(type);
      setTimeout(() => setCopied(null), 2000);
    } catch { /* ignore */ }
  };

  return (
    <div className={styles.section}>
      <button className={styles.header} onClick={() => setExpanded(v => !v)} type="button">
        <div className={styles.headerLeft}>
          <span className={styles.label}>Referrals</span>
          <span className={styles.sub}>1 000 pts за игрока · 10% с их очков</span>
        </div>
        <div className={styles.headerRight}>
          {count > 0 && <span className={styles.badge}>{count}</span>}
          <span className={styles.chevron}>{expanded ? "▾" : "▸"}</span>
        </div>
      </button>

      {expanded && (
        <div className={styles.body}>
          <p className={styles.desc}>
            Пригласи игрока по ссылке — получи <strong>1 000 pts</strong> когда
            он сыграет первую игру, плюс <strong>10%</strong> от всех очков
            которые он зарабатывает в играх навсегда.
          </p>

          <div className={styles.linkGroup}>
            <span className={styles.linkLabel}>Base App</span>
            <div className={styles.linkRow}>
              <span className={styles.linkText}>{baseLink || "…"}</span>
              <button
                className={styles.copyBtn}
                onClick={() => handleCopy(baseLink, "base")}
                disabled={!baseLink}
              >
                {copied === "base" ? "Скопировано!" : "Копировать"}
              </button>
            </div>

            <span className={styles.linkLabel}>Прямая ссылка</span>
            <div className={styles.linkRow}>
              <span className={styles.linkText}>{link || "…"}</span>
              <button
                className={styles.copyBtn}
                onClick={() => handleCopy(link, "direct")}
                disabled={!link}
              >
                {copied === "direct" ? "Скопировано!" : "Копировать"}
              </button>
            </div>
          </div>

          {count > 0 && (
            <div className={styles.stats}>
              <div className={styles.statItem}>
                <span className={styles.statVal}>{count}</span>
                <span className={styles.statKey}>Приглашено</span>
              </div>
              <div className={styles.statItem}>
                <span className={styles.statVal}>{activeCount}</span>
                <span className={styles.statKey}>Играют</span>
              </div>
              <div className={styles.statItem}>
                <span className={styles.statVal}>{count - activeCount}</span>
                <span className={styles.statKey}>Ожидают</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
