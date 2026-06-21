"use client";

import { useCallback, useEffect, useState } from "react";
import { useSettings } from "../lib/settings";
import { TelegramIcon, XIcon } from "./Icons";
import styles from "./QuestHub.module.css";

export const SOCIAL_CONNECT_EVENT = "sea-battle-connect-social";
export const SOCIAL_CONNECTIONS_CHANGED_EVENT = "sea-battle-social-connections-changed";

type Connection = {
  provider: "x" | "telegram";
  connected: boolean;
  providerUserId: string | null;
  providerUsername: string | null;
  needsReconnect?: boolean;
};

type StatusResponse = {
  connections: Connection[];
  xOAuthAvailable: boolean;
  telegramBotAvailable: boolean;
};

function copy(ru: boolean) {
  return {
    loadFailed: ru ? "Не удалось загрузить соцсети" : "Could not load social connections",
    accountConnected: ru ? "Аккаунт подключён" : "Account connected",
    required: ru ? "Нужно для проверенных квестов" : "Required for verified quests",
    title: ru ? "Соц. подключения" : "Social connections",
    connectX: ru ? "Подключи X" : "Connect X",
    connectTelegram: ru ? "Подключи Telegram" : "Connect Telegram",
    xNotConfigured: ru
      ? "X App не настроен. Добавь X_CLIENT_ID и callback URL."
      : "X App is not configured. Add X_CLIENT_ID and callback URL.",
    openX: ru ? "Открой X и подтверди доступ" : "Open X and authorize access",
    telegramBotMissing: ru
      ? "Telegram Login не настроен. Добавь TELEGRAM_BOT_TOKEN."
      : "Telegram Login is not configured. Add TELEGRAM_BOT_TOKEN.",
    telegramPrepare: ru
      ? "Готовим Telegram Login. Если окно не откроется, нажми ещё раз."
      : "Preparing Telegram Login. If the popup does not open, tap again.",
    telegramReadyMissing: ru
      ? "Telegram Login ещё не готов. Нажми Connect ещё раз."
      : "Telegram Login is not ready yet. Tap Connect again.",
    telegramCancelled: ru ? "Telegram подключение отменено" : "Telegram connection cancelled",
    telegramConnected: ru ? "Telegram подключён" : "Telegram connected",
    telegramFailed: ru ? "Ошибка подключения Telegram" : "Telegram connection failed",
    telegramScriptFailed: ru ? "Не удалось загрузить Telegram Login" : "Telegram Login script failed to load",
    telegramInvalidBot: ru ? "Telegram bot id некорректный" : "Telegram Login bot id is invalid",
    telegramPrepareFailed: ru ? "Не удалось подготовить Telegram Login" : "Could not prepare Telegram Login",
    telegramStartFailed: ru ? "Не удалось начать Telegram подключение" : "Could not start Telegram connection",
    telegramCallbackFailed: ru ? "Не удалось подключить Telegram" : "Could not connect Telegram",
    telegramLocal: ru
      ? "Telegram Login не работает на localhost/http. Открой игру на публичном HTTPS-домене и поставь этот домен в BotFather /setdomain."
      : "Telegram Login does not work on localhost/http. Open the game on a public HTTPS domain and set that domain in BotFather /setdomain.",
    telegramLocalWithHost: (host: string) =>
      ru
        ? `Telegram Login не работает на localhost/http. Открой игру на https://${host} и проверь, что этот домен стоит в BotFather /setdomain.`
        : `Telegram Login does not work on localhost/http. Open https://${host} and make sure this domain is set in BotFather /setdomain.`,
  };
}

export function SocialConnectPanel({ address }: { address: string }) {
  const { lang } = useSettings();
  const ru = lang === "ru";
  const text = copy(ru);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [busy, setBusy] = useState<"x-oauth" | "telegram" | null>(null);
  const [message, setMessage] = useState("");
  const [telegramConnectUrl, setTelegramConnectUrl] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/social-connections?wallet=${encodeURIComponent(address)}`);
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || copy(ru).loadFailed);
    setStatus(data);
    return data as StatusResponse;
  }, [address, ru]);

  const refreshSocialStatus = useCallback(async () => {
    const data = await load();
    window.dispatchEvent(new Event(SOCIAL_CONNECTIONS_CHANGED_EVENT));
    return data;
  }, [load]);

  useEffect(() => {
    load().catch((err) => setMessage(err instanceof Error ? err.message : text.loadFailed));
  }, [load, text.loadFailed]);

  useEffect(() => {
    const refreshOnFocus = () => {
      if (document.visibilityState === "visible") {
        refreshSocialStatus().catch(() => {});
      }
    };
    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnFocus);
    return () => {
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshOnFocus);
    };
  }, [refreshSocialStatus]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "sea-battle-social-connected") {
        setMessage(text.accountConnected);
        load().catch(() => {});
        window.dispatchEvent(new Event(SOCIAL_CONNECTIONS_CHANGED_EVENT));
        return;
      }
      if (event.data?.type === "sea-battle-social-error") {
        setBusy(null);
        setMessage(
          typeof event.data.message === "string"
            ? event.data.message
            : ru
              ? "Этот аккаунт уже привязан к другому кошельку. Попробуй другой аккаунт."
              : "This account is already connected to another wallet. Try another account.",
        );
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [load, ru, text.accountConnected]);

  const connections = status?.connections ?? [];
  const x = connections.find((item) => item.provider === "x") ?? null;
  const telegram = connections.find((item) => item.provider === "telegram") ?? null;
  const xReady = Boolean(x?.providerUserId) && !x?.needsReconnect;
  const telegramReady = Boolean(telegram?.providerUserId);

  function connectXOAuth() {
    if (status && !status.xOAuthAvailable) {
      setMessage(text.xNotConfigured);
      return;
    }

    setBusy("x-oauth");
    setMessage(text.openX);
    const popup = window.open(
      `/api/social-connections/x/oauth/start?wallet=${encodeURIComponent(address)}`,
      "_blank",
      "popup,width=520,height=760",
    );
    if (!popup) window.location.href = `/api/social-connections/x/oauth/start?wallet=${encodeURIComponent(address)}`;

    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      load().catch(() => {});
      if (attempts > 30) {
        window.clearInterval(timer);
        setBusy(null);
      }
    }, 2000);
  }

  async function connectTelegram() {
    if (status && !status.telegramBotAvailable) {
      setMessage(text.telegramBotMissing);
      return;
    }

    setBusy("telegram");
    setTelegramConnectUrl("");
    setMessage(
      ru
        ? "Открой Telegram-бота. После /start игра сама увидит подключение."
        : "Open the Telegram bot. After /start, the game will detect the connection.",
    );
    try {
      const res = await fetch(
        `/api/social-connections/telegram/start?wallet=${encodeURIComponent(address)}`,
        { cache: "no-store" },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || text.telegramStartFailed);
      const connectUrl = typeof data?.connectUrl === "string" ? data.connectUrl : "";
      if (!connectUrl) throw new Error(text.telegramStartFailed);
      setTelegramConnectUrl(connectUrl);

      const popup = window.open(connectUrl, "_blank", "popup,width=520,height=760");
      if (!popup) {
        setMessage(
          ru
            ? "Браузер заблокировал Telegram. Нажми ссылку ниже, подтверди у бота и вернись в игру."
            : "The browser blocked Telegram. Use the link below, confirm with the bot, then return to the game.",
        );
      }
      setBusy(null);

      let attempts = 0;
      const timer = window.setInterval(async () => {
        attempts += 1;
        try {
          const statusData = await refreshSocialStatus();
          const connected = Boolean(
            statusData.connections?.some(
              (connection: Connection) => connection.provider === "telegram" && connection.providerUserId,
            ),
          );
          if (connected) {
            window.clearInterval(timer);
            setTelegramConnectUrl("");
            setMessage(text.telegramConnected);
          }
        } catch {
          // Keep polling while the user confirms in Telegram.
        }

        if (attempts >= 30) {
          window.clearInterval(timer);
          setMessage(
            ru
              ? "Не получилось увидеть Telegram. Если этот аккаунт уже привязан к другому кошельку, попробуй другой Telegram."
              : "Could not detect Telegram. If this account is already linked to another wallet, try another Telegram account.",
          );
        }
      }, 2000);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : text.telegramFailed);
      setBusy(null);
    }
  }

  useEffect(() => {
    const onConnectRequest = (event: Event) => {
      const provider = (event as CustomEvent<{ provider?: string }>).detail?.provider;
      if (provider === "x" && !xReady) {
        event.preventDefault();
        connectXOAuth();
        return;
      }
      if (provider === "telegram" && !telegramReady) {
        event.preventDefault();
        void connectTelegram();
      }
    };

    window.addEventListener(SOCIAL_CONNECT_EVENT, onConnectRequest);
    return () => window.removeEventListener(SOCIAL_CONNECT_EVENT, onConnectRequest);
  });

  useEffect(() => {
    if ((busy === "x-oauth" && xReady) || (busy === "telegram" && telegramReady)) {
      setBusy(null);
      setMessage(text.accountConnected);
    }
  }, [busy, telegramReady, text.accountConnected, xReady]);

  return (
    <section className={styles.socialConnectPanel}>
      <div className={styles.socialConnectHead}>
        <span>{text.title}</span>
        <small>{text.required}</small>
      </div>

      <div className={styles.socialConnectGrid}>
        <article className={styles.socialConnectCard}>
          <span className={`${styles.questIcon} ${styles.twitterIcon}`}>
            <XIcon size={17} />
          </span>
          <div>
            <b>X</b>
            <small>{xReady ? `@${x?.providerUsername || x?.providerUserId}` : text.connectX}</small>
          </div>
          {!xReady && (
            <button type="button" onClick={connectXOAuth} disabled={!!busy}>
              {busy === "x-oauth" ? "..." : "X App"}
            </button>
          )}
        </article>

        <article className={styles.socialConnectCard}>
          <span className={`${styles.questIcon} ${styles.telegramIcon}`}>
            <TelegramIcon size={18} />
          </span>
          <div>
            <b>Telegram</b>
            <small>
              {telegramReady
                ? telegram?.providerUsername
                  ? `@${telegram.providerUsername}`
                  : telegram?.providerUserId
                : text.connectTelegram}
            </small>
          </div>
          {!telegramReady && (
            <button className={styles.telegramConnectButton} type="button" onClick={connectTelegram} disabled={!!busy}>
              {busy === "telegram" ? "..." : "Connect"}
            </button>
          )}
        </article>
      </div>

      {message && <p className={styles.socialConnectMsg}>{message}</p>}
      {telegramConnectUrl && !telegramReady && (
        <a
          className={styles.telegramConnectButton}
          href={telegramConnectUrl}
          target="_blank"
          rel="noreferrer"
          onClick={() => {
            refreshSocialStatus().catch(() => {});
          }}
        >
          {ru ? "Открыть Telegram" : "Open Telegram"}
        </a>
      )}
    </section>
  );
}
