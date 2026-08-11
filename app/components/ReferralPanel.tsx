"use client";

import { useEffect, useState } from "react";
import sdk from "@farcaster/miniapp-sdk";
import {
  getPreferredReferralLinks,
  getReferralStats,
  type ReferralStats,
} from "../lib/referrals";
import { TR, useSettings } from "../lib/settings";
import {
  CopyIcon,
  ExternalLinkIcon,
  ShareIcon,
  UsersIcon,
} from "./Icons";
import styles from "./ReferralPanel.module.css";

interface Props {
  address: string;
  hideHeader?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
}

const EMPTY_STATS: ReferralStats = {
  count: 0,
  activeCount: 0,
  pendingCount: 0,
  paidCount: 0,
  unpaidActiveCount: 0,
  firstGameBonusPoints: 0,
};
const TWITTER_REFERRAL_SHARE_TEXT = "Join me in Sea Battle on Base.";

export default function ReferralPanel({
  address,
  hideHeader = false,
  expanded: controlledExpanded,
  onToggleExpand,
}: Props) {
  const { lang } = useSettings();
  const tr = TR[lang];
  const copy = REFERRAL_COPY[lang === "ru" ? "ru" : "en"];

  const [internalExpanded, setInternalExpanded] = useState(false);
  const expanded = controlledExpanded ?? internalExpanded;
  const [stats, setStats] = useState<ReferralStats>(EMPTY_STATS);
  const [statsWallet, setStatsWallet] = useState<string | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState(false);
  const [copied, setCopied] = useState<"direct" | "base" | "share" | null>(null);
  const [link, setLink] = useState("");
  const [baseLink, setBaseLink] = useState("");
  const [linksWallet, setLinksWallet] = useState<string | null>(null);
  const [linksLoading, setLinksLoading] = useState(false);
  const [linksError, setLinksError] = useState(false);
  const [shareMenuOpen, setShareMenuOpen] = useState(false);
  const wallet = address.toLowerCase();
  const linksAreCurrent = linksWallet === wallet;
  const statsAreCurrent = statsWallet === wallet;
  const visibleLink = linksAreCurrent ? link : "";
  const visibleBaseLink = linksAreCurrent ? baseLink : "";
  const visibleStats = statsAreCurrent ? stats : EMPTY_STATS;
  const linksBusy = !linksAreCurrent || linksLoading;
  const statsBusy = !statsAreCurrent || statsLoading;
  const activeBonus = visibleStats.firstGameBonusPoints;

  const toggle = () => {
    if (onToggleExpand) onToggleExpand();
    else setInternalExpanded((value) => !value);
  };

  useEffect(() => {
    if (!address) return;
    const requestedWallet = address.toLowerCase();
    let cancelled = false;
    setLink("");
    setBaseLink("");
    setLinksWallet(requestedWallet);
    setLinksLoading(true);
    setLinksError(false);
    setCopied(null);
    setShareMenuOpen(false);
    void getPreferredReferralLinks(requestedWallet)
      .then((links) => {
        if (cancelled) return;
        setLink(links.link);
        setBaseLink(links.baseLink);
      })
      .catch(() => {
        if (cancelled) return;
        setLink("");
        setBaseLink("");
        setLinksError(true);
      })
      .finally(() => {
        if (!cancelled) setLinksLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [address]);

  useEffect(() => {
    if (!address) return;
    const requestedWallet = address.toLowerCase();
    let cancelled = false;
    setStats(EMPTY_STATS);
    setStatsWallet(requestedWallet);
    setStatsLoading(true);
    setStatsError(false);
    void getReferralStats(requestedWallet)
      .then((nextStats) => {
        if (!cancelled) setStats(nextStats);
      })
      .catch(() => {
        if (!cancelled) setStatsError(true);
      })
      .finally(() => {
        if (!cancelled) setStatsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [address]);

  const handleCopy = async (text: string, type: "direct" | "base") => {
    if (!text) return;
    try {
      await copyToClipboard(
        type === "direct" ? withReferralSource(text, "copy_link") : text,
      );
      setCopied(type);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard may be unavailable in restricted browsers.
    }
  };

  const handleShare = async () => {
    const url = visibleLink || visibleBaseLink;
    if (!url) return;
    setShareMenuOpen((open) => !open);
  };

  const handleNativeShare = async () => {
    const rawUrl = visibleLink || visibleBaseLink;
    if (!rawUrl) return;
    setShareMenuOpen(false);

    try {
      if (await isMiniAppShareAvailable()) {
        const url = withReferralSource(rawUrl, "farcaster");
        await sdk.actions.composeCast({
          text: copy.shareText,
          embeds: [url],
        });
        setCopied("share");
        window.setTimeout(() => setCopied(null), 2000);
        return;
      }

      if (typeof navigator.share === "function") {
        const url = withReferralSource(rawUrl, "native_share");
        await navigator.share({
          title: "Sea Battle",
          text: copy.shareText,
          url,
        });
      } else {
        await copyToClipboard(withReferralSource(rawUrl, "native_share"));
      }
      setCopied("share");
      window.setTimeout(() => setCopied(null), 2000);
    } catch (err) {
      if (isAbortError(err)) return;
      openExternal(getTwitterShareUrl(
        withReferralSource(rawUrl, "x"),
        TWITTER_REFERRAL_SHARE_TEXT,
      ));
    }
  };

  const handleFarcasterShare = async () => {
    const rawUrl = visibleLink || visibleBaseLink;
    if (!rawUrl) return;
    const url = withReferralSource(rawUrl, "farcaster");
    setShareMenuOpen(false);

    try {
      if (await isMiniAppShareAvailable()) {
        await sdk.actions.composeCast({
          text: copy.shareText,
          embeds: [url],
        });
        return;
      }
    } catch {
      // Fall through to Warpcast web compose.
    }

    openExternal(getFarcasterShareUrl(url, copy.shareText));
  };

  const handleTwitterShare = () => {
    const rawUrl = visibleLink || visibleBaseLink;
    if (!rawUrl) return;
    setShareMenuOpen(false);
    openExternal(getTwitterShareUrl(
      withReferralSource(rawUrl, "x"),
      TWITTER_REFERRAL_SHARE_TEXT,
    ));
  };

  const handleTelegramShare = () => {
    const rawUrl = visibleLink || visibleBaseLink;
    if (!rawUrl) return;
    setShareMenuOpen(false);
    openExternal(getTelegramShareUrl(
      withReferralSource(rawUrl, "telegram"),
      copy.shareText,
    ));
  };

  const handleBaseOpen = async () => {
    const url = visibleBaseLink || visibleLink;
    if (!url) return;
    setShareMenuOpen(false);

    try {
      if (await isMiniAppShareAvailable()) {
        await sdk.actions.openUrl({ url });
        return;
      }
    } catch {
      // Fall through to regular navigation.
    }

    openExternal(url);
  };

  return (
    <div className={styles.section}>
      {!hideHeader && (
        <button className={styles.header} onClick={toggle} type="button">
          <div className={styles.headerLeft}>
            <span className={styles.label}>{tr.referrals}</span>
            <span className={styles.sub}>{tr.referrals_sub}</span>
          </div>
          <div className={styles.headerRight}>
            {visibleStats.count > 0 && <span className={styles.badge}>{visibleStats.count}</span>}
            <span className={styles.chevron}>{expanded ? "v" : ">"}</span>
          </div>
        </button>
      )}

      {expanded && (
        <div className={styles.body}>
          <div className={styles.inviteHero}>
            <div className={styles.heroIcon} aria-hidden="true">
              <UsersIcon size={24} />
            </div>
            <div className={styles.heroCopy}>
              <span className={styles.kicker}>{copy.kicker}</span>
              <h3>{copy.title}</h3>
              <p>{tr.referrals_desc}</p>
            </div>
          </div>

          <div className={styles.rewardStrip}>
            <div className={styles.rewardItem}>
              <span>+1,000</span>
              <small>{copy.firstGame}</small>
            </div>
            <div className={styles.rewardDivider} aria-hidden="true" />
            <div className={styles.rewardItem}>
              <span>10%</span>
              <small>{copy.lifetime}</small>
            </div>
          </div>

          <div className={styles.actionGrid}>
            <button
              className={`${styles.actionBtn} ${styles.actionPrimary}`}
              onClick={handleShare}
              disabled={linksBusy || (!visibleBaseLink && !visibleLink)}
              type="button"
            >
              <ShareIcon size={17} />
              {copied === "share" ? tr.copied_ok : copy.share}
            </button>
            <button
              className={styles.actionBtn}
              onClick={() => handleCopy(visibleBaseLink, "base")}
              disabled={linksBusy || !visibleBaseLink}
              type="button"
            >
              <CopyIcon size={17} />
              {copied === "base" ? tr.copied_ok : copy.copyBase}
            </button>
          </div>

          {shareMenuOpen && (
            <div className={styles.sharePicker}>
              <button className={styles.shareOption} onClick={handleFarcasterShare} type="button">
                <ExternalLinkIcon size={15} />
                {copy.shareFarcaster}
              </button>
              <button className={styles.shareOption} onClick={handleTwitterShare} type="button">
                <ExternalLinkIcon size={15} />
                {copy.shareTwitter}
              </button>
              <button className={styles.shareOption} onClick={handleTelegramShare} type="button">
                <ExternalLinkIcon size={15} />
                {copy.shareTelegram}
              </button>
              <button className={styles.shareOption} onClick={handleBaseOpen} type="button">
                <ExternalLinkIcon size={15} />
                {copy.openBase}
              </button>
              {typeof navigator !== "undefined" && typeof navigator.share === "function" && (
                <button className={styles.shareOption} onClick={handleNativeShare} type="button">
                  <ShareIcon size={15} />
                  {copy.systemShare}
                </button>
              )}
            </div>
          )}

          <div className={styles.stats} aria-busy={statsBusy}>
            <StatBox value={statsBusy ? "…" : visibleStats.count} label={tr.invited} />
            <StatBox value={statsBusy ? "…" : visibleStats.activeCount} label={tr.playing} good />
            <StatBox value={statsBusy ? "…" : visibleStats.pendingCount} label={tr.pending_ref} />
            <StatBox value={statsBusy ? "…" : formatPoints(activeBonus)} label={copy.unlocked} good />
          </div>

          <div className={styles.linkGroup} aria-busy={linksBusy}>
            <div className={styles.linkHeader}>
              <span className={styles.linkLabel}>Base App</span>
              <a
                className={styles.openLink}
                href={visibleBaseLink || "#"}
                target="_blank"
                rel="noopener noreferrer"
                aria-disabled={!visibleBaseLink}
              >
                <ExternalLinkIcon size={14} />
                {copy.open}
              </a>
            </div>
            <div className={styles.linkRow}>
              <span className={styles.linkText}>
                {visibleBaseLink || (linksBusy ? "..." : "—")}
              </span>
              <button
                className={styles.copyBtn}
                onClick={() => handleCopy(visibleBaseLink, "base")}
                disabled={linksBusy || !visibleBaseLink}
                type="button"
              >
                {copied === "base" ? tr.copied_ok : tr.copy}
              </button>
            </div>

            <span className={styles.linkLabel}>{tr.direct_link}</span>
            <div className={styles.linkRow}>
              <span className={styles.linkText}>
                {visibleLink || (linksBusy ? "..." : "—")}
              </span>
              <button
                className={styles.copyBtn}
                onClick={() => handleCopy(visibleLink, "direct")}
                disabled={linksBusy || !visibleLink}
                type="button"
              >
                {copied === "direct" ? tr.copied_ok : tr.copy}
              </button>
            </div>
          </div>

          {linksAreCurrent && linksError && <p className={styles.note}>{copy.linksError}</p>}
          {statsAreCurrent && statsError && <p className={styles.note}>{copy.statsError}</p>}
        </div>
      )}
    </div>
  );
}

function StatBox({
  value,
  label,
  good = false,
}: {
  value: number | string;
  label: string;
  good?: boolean;
}) {
  return (
    <div className={`${styles.statItem} ${good ? styles.statGood : ""}`}>
      <span className={styles.statVal}>{value}</span>
      <span className={styles.statKey}>{label}</span>
    </div>
  );
}

async function copyToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

function formatPoints(points: number) {
  return points >= 1000 ? `${Math.floor(points / 1000)}k` : points;
}

async function isMiniAppShareAvailable() {
  try {
    return await sdk.isInMiniApp();
  } catch {
    return false;
  }
}

function getTwitterShareUrl(url: string, text: string) {
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
}

function getFarcasterShareUrl(url: string, text: string) {
  return `https://warpcast.com/~/compose?text=${encodeURIComponent(`${text} ${url}`)}`;
}

function withReferralSource(value: string, source: string) {
  try {
    const url = new URL(value);
    url.searchParams.set("utm_source", source);
    url.searchParams.set("utm_medium", "referral");
    url.searchParams.set("utm_campaign", "captain_invite");
    return url.toString();
  } catch {
    return value;
  }
}

function getTelegramShareUrl(url: string, text: string) {
  return `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
}

function openExternal(url: string) {
  window.location.assign(url);
}

function isAbortError(err: unknown) {
  return err instanceof DOMException && err.name === "AbortError";
}

const REFERRAL_COPY = {
  en: {
    kicker: "Invite center",
    title: "Bring captains aboard",
    firstGame: "first-game bonus",
    lifetime: "of their game points",
    share: "Share invite",
    shareFarcaster: "Farcaster",
    shareTwitter: "X / Twitter",
    shareTelegram: "Telegram",
    openBase: "Base App",
    systemShare: "Share sheet",
    copyBase: "Copy Base link",
    open: "Open",
    unlocked: "Bonus",
    shareText: "Join me in Sea Battle on Base.",
    linksError: "Invite links are temporarily unavailable.",
    statsError: "Referral stats are temporarily unavailable.",
  },
  ru: {
    shareFarcaster: "Farcaster",
    shareTwitter: "X / Twitter",
    shareTelegram: "Telegram",
    openBase: "Base App",
    systemShare: "Share sheet",
    kicker: "Центр приглашений",
    title: "Зови капитанов в бой",
    firstGame: "за первую игру",
    lifetime: "с игровых очков",
    share: "Поделиться",
    copyBase: "Скопировать Base",
    open: "Открыть",
    unlocked: "Бонус",
    shareText: "Заходи ко мне в Sea Battle на Base.",
    linksError: "Ссылки для приглашения временно недоступны.",
    statsError: "Статистика рефералов временно недоступна.",
  },
};
