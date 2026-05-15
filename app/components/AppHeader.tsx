"use client";

import { useState, useRef, useEffect } from "react";
import { useDisconnect } from "wagmi";
import { StarIcon, AnchorIcon } from "./Icons";
import { useSettings, TR } from "../lib/settings";
import styles from "./AppHeader.module.css";

interface AppHeaderProps {
  points?: number | null;
  address?: string | null;
}

function fmt(n: number) {
  return n.toLocaleString("en-US").replace(/,/g, " ");
}

export function AppHeader({ points, address }: AppHeaderProps) {
  const { lang } = useSettings();
  const tr = TR[lang];
  const { disconnect } = useDisconnect();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const short = address
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : null;

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const copy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
    } catch {
      // ignore
    }
  };

  const handleDisconnect = () => {
    setOpen(false);
    disconnect();
  };

  return (
    <header className={styles.header}>
      <div className={styles.left}>
        {points != null && (
          <div className={styles.resource}>
            <span className={styles.iconPurple}>
              <StarIcon size={16} />
            </span>
            <span className={styles.resourceValue}>{fmt(points)}</span>
            <span className={styles.resourceUnit}>{tr.shop_pts}</span>
          </div>
        )}
      </div>

      <div className={styles.title}>SEA BATTLE</div>

      <div className={styles.right} ref={wrapRef}>
        {short && (
          <button
            className={styles.address}
            onClick={() => setOpen((v) => !v)}
            type="button"
            aria-haspopup="menu"
            aria-expanded={open}
          >
            {short}
          </button>
        )}
        <button
          className={styles.avatar}
          onClick={() => setOpen((v) => !v)}
          type="button"
            aria-label={tr.wallet_menu}
        >
          <AnchorIcon size={16} />
        </button>

        {open && (
          <div className={styles.menu} role="menu">
            {address && (
              <>
                <div className={styles.menuLabel}>{tr.wallet_menu.toUpperCase()}</div>
                <div className={styles.menuAddress} title={address}>
                  {address.slice(0, 10)}…{address.slice(-8)}
                </div>
                <button
                  className={styles.menuItem}
                  onClick={() => {
                    copy();
                    setOpen(false);
                  }}
                  type="button"
                >
                  📋 {tr.wallet_copy_address}
                </button>
              </>
            )}
            <button
              className={`${styles.menuItem} ${styles.menuDanger}`}
              onClick={handleDisconnect}
              type="button"
            >
              ⏏ {tr.wallet_disconnect}
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
