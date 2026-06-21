"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PLAYER_DATA_REFRESH_EVENT } from "../lib/playerDataEvents";
import { useSettings } from "../lib/settings";
import { SOCIAL_CONNECTIONS_CHANGED_EVENT } from "./SocialConnectPanel";
import styles from "./ShareRewardButton.module.css";

const PROFILE_POINTS = 500;
const GAME_POINTS = 100;

export type ShareRewardGameMode = "bot" | "friend" | "wager";

export type ShareRewardProfile = {
  points: number;
  wins: number;
  losses: number;
  streak: number;
  shots: number;
  earningsUsdc: number;
};

export type ShareRewardGame = {
  gameId?: number | null;
  mode: ShareRewardGameMode;
  didWin: boolean;
  myHits: number;
  enemyHits: number;
  prizeUsdc?: string | null;
};

export type ShareRewardButtonProps =
  | {
      kind: "profile";
      wallet?: string | null;
      profile: ShareRewardProfile;
      variant?: "profile" | "result";
      onAwarded?: (points: number) => void;
    }
  | {
      kind: "game";
      wallet?: string | null;
      game: ShareRewardGame;
      variant?: "profile" | "result";
      onAwarded?: (points: number) => void;
    };

type ProfileStatus = {
  canClaim: boolean;
  points: number;
  nextAvailableAt: string | null;
};

type XStatus = {
  connected: boolean;
  username: string | null;
  needsReconnect: boolean;
  oauthAvailable: boolean;
};

type PreparedShare = {
  attemptToken: string;
  shareUrl: string;
  expiresAt: string;
  xUsername?: string | null;
};

type StoredShare = PreparedShare & { opened: boolean };
type BusyState = "status" | "connect" | "prepare" | "verify" | null;

function xIntentUrl(text: string, url: string) {
  const params = new URLSearchParams({ text, url });
  return `https://x.com/intent/tweet?${params.toString()}`;
}

function modeLabel(mode: ShareRewardGameMode) {
  if (mode === "bot") return "AI bot";
  if (mode === "wager") return "USDC wager";
  return "a friend";
}

function buildGameShareText(game: ShareRewardGame) {
  const result = game.didWin ? "won" : "finished";
  const prize = game.prizeUsdc ? ` Prize: ${game.prizeUsdc} USDC.` : "";
  return `I just ${result} a Sea Battle against ${modeLabel(game.mode)}. Score: ${game.myHits}-${game.enemyHits}.${prize} Play onchain on Base.`;
}

function buildProfileShareText(profile: ShareRewardProfile) {
  return [
    "My Sea Battle stats",
    `${profile.points.toLocaleString("en-US")} PTS | ${profile.wins.toLocaleString("en-US")} wins | ${profile.shots.toLocaleString("en-US")} shots | ${profile.streak}d streak`,
  ].join("\n");
}

function formatCooldown(nextAvailableAt: string | null, ru: boolean) {
  if (!nextAvailableAt) return "";
  const remainingMs = new Date(nextAvailableAt).getTime() - Date.now();
  if (remainingMs <= 0) return "";
  const hours = Math.floor(remainingMs / (60 * 60 * 1000));
  const minutes = Math.ceil((remainingMs % (60 * 60 * 1000)) / (60 * 1000));
  if (hours > 0) return ru ? `через ${hours}ч ${minutes}м` : `in ${hours}h ${minutes}m`;
  return ru ? `через ${minutes}м` : `in ${minutes}m`;
}

function isPreparedShare(value: unknown): value is StoredShare {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<StoredShare>;
  return (
    typeof item.attemptToken === "string" &&
    typeof item.shareUrl === "string" &&
    typeof item.expiresAt === "string" &&
    new Date(item.expiresAt).getTime() > Date.now()
  );
}

function openXCompose(text: string, shareUrl: string) {
  const webUrl = xIntentUrl(text, shareUrl);
  const message = `${text}\n\n${shareUrl}`;
  const userAgent = navigator.userAgent || "";
  const isAndroid = /Android/i.test(userAgent);
  const isIos = /iPhone|iPad|iPod/i.test(userAgent);

  if (isAndroid) {
    const intentUrl =
      `intent://post?message=${encodeURIComponent(message)}` +
      `#Intent;scheme=twitter;package=com.twitter.android;` +
      `S.browser_fallback_url=${encodeURIComponent(webUrl)};end`;
    const link = document.createElement("a");
    link.href = intentUrl;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    return;
  }

  if (isIos) {
    let appOpened = false;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") appOpened = true;
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.location.href = `twitter://post?message=${encodeURIComponent(message)}`;
    window.setTimeout(() => {
      document.removeEventListener("visibilitychange", onVisibility);
      if (!appOpened && document.visibilityState === "visible") window.location.href = webUrl;
    }, 1200);
    return;
  }

  window.open(webUrl, "_blank", "noopener,noreferrer");
}

export function ShareRewardButton(props: ShareRewardButtonProps) {
  const { lang } = useSettings();
  const ru = lang === "ru";
  const wallet = props.wallet?.toLowerCase() ?? "";
  const isProfile = props.kind === "profile";
  const gameId = props.kind === "game" ? props.game.gameId ?? null : null;
  const gameMode = props.kind === "game" ? props.game.mode : null;
  const variant = props.variant ?? "result";
  const points = isProfile ? PROFILE_POINTS : GAME_POINTS;
  const missingGameId = props.kind === "game" && !gameId;

  const [busy, setBusy] = useState<BusyState>("status");
  const [message, setMessage] = useState("");
  const [profileStatus, setProfileStatus] = useState<ProfileStatus | null>(null);
  const [xStatus, setXStatus] = useState<XStatus | null>(null);
  const [prepared, setPrepared] = useState<PreparedShare | null>(null);
  const [opened, setOpened] = useState(false);
  const autoPrepareKey = useRef("");

  const shareText = useMemo(
    () =>
      props.kind === "profile"
        ? buildProfileShareText(props.profile)
        : buildGameShareText(props.game),
    [props],
  );

  const storageKey = useMemo(
    () => `sea-battle:x-share:${wallet}:${props.kind}:${gameId ?? "profile"}`,
    [gameId, props.kind, wallet],
  );

  const canClaimProfile = !isProfile || profileStatus?.canClaim !== false;
  const cooldown = isProfile ? formatCooldown(profileStatus?.nextAvailableAt ?? null, ru) : "";
  const xConnected = Boolean(xStatus?.connected) && !xStatus?.needsReconnect;

  const loadStatus = useCallback(async () => {
    if (!wallet) {
      setBusy(null);
      return null;
    }
    const res = await fetch(`/api/share-rewards?wallet=${encodeURIComponent(wallet)}`, {
      cache: "no-store",
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || "Could not load X share status");
    if (data?.profile) setProfileStatus(data.profile);
    if (data?.x) setXStatus(data.x);
    setBusy((current) => (current === "status" ? null : current));
    return data as { profile: ProfileStatus; x: XStatus };
  }, [wallet]);

  const prepareShare = useCallback(async () => {
    if (!wallet || missingGameId) throw new Error("Share is not ready yet");
    setBusy("prepare");
    const res = await fetch("/api/share-rewards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "prepare",
        wallet,
        kind: props.kind,
        ...(props.kind === "game" ? { gameId, gameMode } : {}),
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      if (res.status === 429 && data?.nextAvailableAt) {
        setProfileStatus({ canClaim: false, points, nextAvailableAt: data.nextAvailableAt });
      }
      throw new Error(data?.error || "Could not prepare X share");
    }
    const next: PreparedShare = {
      attemptToken: String(data.attemptToken),
      shareUrl: String(data.shareUrl),
      expiresAt: String(data.expiresAt),
      xUsername: typeof data.xUsername === "string" ? data.xUsername : null,
    };
    setPrepared(next);
    setOpened(false);
    sessionStorage.setItem(storageKey, JSON.stringify({ ...next, opened: false }));
    return next;
  }, [gameId, gameMode, missingGameId, points, props.kind, storageKey, wallet]);

  useEffect(() => {
    autoPrepareKey.current = "";
    setPrepared(null);
    setOpened(false);
    try {
      const stored = JSON.parse(sessionStorage.getItem(storageKey) || "null") as unknown;
      if (isPreparedShare(stored)) {
        setPrepared(stored);
        setOpened(Boolean(stored.opened));
      } else {
        sessionStorage.removeItem(storageKey);
      }
    } catch {
      sessionStorage.removeItem(storageKey);
    }
  }, [storageKey]);

  useEffect(() => {
    loadStatus().catch((err) => {
      setBusy(null);
      setMessage(err instanceof Error ? err.message : "Could not load X share status");
    });
  }, [loadStatus]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") loadStatus().catch(() => {});
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener(SOCIAL_CONNECTIONS_CHANGED_EVENT, refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener(SOCIAL_CONNECTIONS_CHANGED_EVENT, refresh);
    };
  }, [loadStatus]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "sea-battle-social-connected" && event.data?.provider === "x") {
        setBusy("status");
        setMessage(ru ? "X подключен. Готовим пост..." : "X connected. Preparing your post...");
        loadStatus().catch(() => setBusy(null));
      }
      if (event.data?.type === "sea-battle-social-error" && event.data?.provider === "x") {
        setBusy(null);
        setMessage(String(event.data?.message || "Could not connect X"));
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [loadStatus, ru]);

  useEffect(() => {
    if (
      !wallet ||
      !xConnected ||
      !canClaimProfile ||
      missingGameId ||
      prepared ||
      busy === "connect" ||
      busy === "verify"
    ) {
      return;
    }
    if (autoPrepareKey.current === storageKey) return;
    autoPrepareKey.current = storageKey;
    prepareShare()
      .then(() => setMessage(""))
      .catch((err) => {
        setMessage(err instanceof Error ? err.message : "Could not prepare X share");
      })
      .finally(() => setBusy(null));
  }, [busy, canClaimProfile, missingGameId, prepareShare, prepared, storageKey, wallet, xConnected]);

  function connectX() {
    if (!wallet) return;
    if (xStatus && !xStatus.oauthAvailable) {
      setMessage("X OAuth is not configured");
      return;
    }
    setBusy("connect");
    setMessage(ru ? "Подключи X и вернись в игру" : "Connect X and return to the game");
    const url = `/api/social-connections/x/oauth/start?wallet=${encodeURIComponent(wallet)}`;
    const popup = window.open(url, "_blank", "popup,width=520,height=760");
    if (!popup) window.location.href = url;

    let attempts = 0;
    const timer = window.setInterval(async () => {
      attempts += 1;
      try {
        const status = await loadStatus();
        if (status?.x?.connected && !status.x.needsReconnect) {
          window.clearInterval(timer);
          setBusy(null);
          window.dispatchEvent(new Event(SOCIAL_CONNECTIONS_CHANGED_EVENT));
        }
      } catch {}
      if (attempts >= 30) {
        window.clearInterval(timer);
        setBusy(null);
      }
    }, 2000);
  }

  async function openShare() {
    if (!wallet || missingGameId) return;
    setMessage("");
    try {
      const attempt = prepared ?? (await prepareShare());
      setOpened(true);
      sessionStorage.setItem(storageKey, JSON.stringify({ ...attempt, opened: true }));
      setBusy(null);
      setMessage(
        ru
          ? "Опубликуй пост в X, вернись сюда и нажми Verify"
          : "Publish the post in X, return here, then tap Verify",
      );
      openXCompose(shareText, attempt.shareUrl);
    } catch (err) {
      setBusy(null);
      setMessage(err instanceof Error ? err.message : "Could not open X");
    }
  }

  async function verifyShare() {
    if (!prepared || !wallet || missingGameId) return;
    setBusy("verify");
    setMessage(ru ? "Проверяем опубликованный пост..." : "Checking the published post...");
    try {
      const res = await fetch("/api/share-rewards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "verify",
          wallet,
          kind: props.kind,
          attemptToken: prepared.attemptToken,
          shareText,
          ...(props.kind === "game" ? { gameId, gameMode } : {}),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        if (res.status === 429 && data?.nextAvailableAt) {
          setProfileStatus({ canClaim: false, points, nextAvailableAt: data.nextAvailableAt });
        }
        if (/expired/i.test(String(data?.error || ""))) {
          sessionStorage.removeItem(storageKey);
          setPrepared(null);
          setOpened(false);
          autoPrepareKey.current = "";
        }
        throw new Error(data?.error || "Could not verify X post");
      }

      sessionStorage.removeItem(storageKey);
      setPrepared(null);
      setOpened(false);
      setMessage(ru ? `Пост подтвержден: +${data.points} PTS` : `Post verified: +${data.points} PTS`);
      if (props.kind === "profile") {
        setProfileStatus({
          canClaim: false,
          points,
          nextAvailableAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        });
      }
      props.onAwarded?.(Number(data.points ?? points));
      window.dispatchEvent(new Event(PLAYER_DATA_REFRESH_EVENT));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Share verification failed");
    } finally {
      setBusy(null);
    }
  }

  const disabled =
    !wallet ||
    missingGameId ||
    !canClaimProfile ||
    busy !== null;

  const label = (() => {
    if (!wallet) return ru ? "ПОДКЛЮЧИ КОШЕЛЕК" : "CONNECT WALLET";
    if (missingGameId) return ru ? "СИНХРОНИЗИРУЕМ МАТЧ" : "SYNCING MATCH";
    if (isProfile && !canClaimProfile) {
      return ru ? `ПРОФИЛЬ УЖЕ ОПУБЛИКОВАН | ${cooldown}` : `PROFILE SHARED | ${cooldown}`;
    }
    if (busy === "status") return ru ? "ПРОВЕРЯЕМ X..." : "CHECKING X...";
    if (busy === "connect") return ru ? "ПОДКЛЮЧАЕМ X..." : "CONNECTING X...";
    if (busy === "prepare") return ru ? "ГОТОВИМ ПОСТ..." : "PREPARING POST...";
    if (busy === "verify") return ru ? "ПРОВЕРЯЕМ ПОСТ..." : "VERIFYING POST...";
    if (!xConnected) return ru ? "ПОДКЛЮЧИТЬ X" : "CONNECT X";
    if (opened) return ru ? `VERIFY ПОСТ | +${points} PTS` : `VERIFY POST | +${points} PTS`;
    return isProfile
      ? ru
        ? `ОТКРЫТЬ X | +${points} PTS`
        : `OPEN X | +${points} PTS`
      : ru
        ? `ШЕЙР МАТЧА | +${points} PTS`
        : `SHARE BATTLE | +${points} PTS`;
  })();

  const handlePrimary = () => {
    if (!xConnected) {
      connectX();
      return;
    }
    if (opened) {
      verifyShare();
      return;
    }
    openShare();
  };

  const defaultMessage = (() => {
    if (!xConnected) {
      return ru
        ? "Для награды подключи X и опубликуй пост"
        : "Connect X and publish the post to earn points";
    }
    if (opened) {
      return ru
        ? "Пойнты начислятся только после проверки поста"
        : "Points are awarded only after the post is verified";
    }
    if (isProfile && !canClaimProfile) {
      return ru ? "Награда доступна раз в 24 часа" : "Reward is available once every 24h";
    }
    return " ";
  })();

  return (
    <div className={`${styles.wrap} ${variant === "profile" ? styles.profile : styles.result}`}>
      <div className={styles.actions}>
        <button className={styles.button} type="button" disabled={disabled} onClick={handlePrimary}>
          {label}
        </button>
        {xConnected && opened && prepared && (
          <button className={styles.secondaryButton} type="button" disabled={busy !== null} onClick={openShare}>
            {ru ? "ОТКРЫТЬ X ЕЩЕ РАЗ" : "OPEN X AGAIN"}
          </button>
        )}
      </div>
      <div className={`${styles.message} ${message.includes("+") ? styles.ready : message ? styles.error : ""}`}>
        {message || defaultMessage}
      </div>
    </div>
  );
}
