"use client";

import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import type { Lang } from "../lib/settings";
import { dismissOnboarding, saveOnboardingProgress, type OnboardingStatus, type OnboardingStep } from "../lib/onboarding";
import styles from "./CaptainOnboarding.module.css";

type Rect = { top: number; left: number; right: number; bottom: number; width: number; height: number };

const COPY = {
  ru: {
    choose: "выбери язык", ru: "русский", en: "english", skip: "пропустить обучение", next: "далее", done: "готово",
    checkinTitle: "получи первые поинты", checkinText: "нажми на настоящий check-in под подсветкой и подтверди транзакцию\nесли Base App покажет FREE, газ оплатит приложение",
    earnedTitle: "первые поинты получены",
    playTitle: "теперь можно играть", playText: "тут выбирается режим\nдля первого боя проще начать с бота",
    questsTitle: "здесь находятся квесты", questsText: "еженедельные и партнерские задания тоже дают поинты",
    passTitle: "battle pass и награды", passText: "поинты двигают прогресс сезона\nнаграды и предметы находятся в магазине",
  },
  en: {
    choose: "choose your language", ru: "русский", en: "english", skip: "skip tutorial", next: "next", done: "done",
    checkinTitle: "earn your first points", checkinText: "tap the real check-in under the highlight and confirm the transaction\nwhen Base App shows FREE, the app sponsors the gas",
    earnedTitle: "first points received",
    playTitle: "ready to play", playText: "choose a game mode here\nstart with the bot for your first battle",
    questsTitle: "quests live here", questsText: "weekly and partner tasks also reward points",
    passTitle: "battle pass and rewards", passText: "points advance your season progress\nrewards and items are in the shop",
  },
} as const;

const TARGETS: Partial<Record<OnboardingStep, string>> = {
  briefing: "checkin",
  targeting: "play",
  result: "quests",
  checkin: "battlepass",
};

export function CaptainOnboarding({ address, status, lang, reducedMotion, onLanguageChange, onStatusChange, onOpenCheckin, onFinish }: {
  address: string; status: OnboardingStatus; lang: Lang; reducedMotion: boolean;
  onLanguageChange: (language: Lang) => void; onStatusChange: (status: OnboardingStatus) => void;
  onOpenCheckin: () => void; onFinish: () => Promise<void>;
}) {
  const copy = COPY[lang];
  const [rect, setRect] = useState<Rect | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const target = TARGETS[status.step];

  const locate = useCallback(() => {
    if (!target) return setRect(null);
    const elements = Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${target}"]`));
    const element = elements.find((node) => {
      const box = node.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    });
    if (!element) return setRect(null);
    const box = element.getBoundingClientRect();
    const gap = 7;
    setRect({ top: Math.max(0, box.top - gap), left: Math.max(0, box.left - gap), right: Math.min(innerWidth, box.right + gap), bottom: Math.min(innerHeight, box.bottom + gap), width: box.width + gap * 2, height: box.height + gap * 2 });
  }, [target]);

  useLayoutEffect(() => {
    if (!target) return locate();
    const element = Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${target}"]`)).find((node) => {
      const box = node.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    });
    element?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" });
    const timer = window.setTimeout(locate, 260);
    return () => window.clearTimeout(timer);
  }, [locate, reducedMotion, status.step, target]);
  useEffect(() => {
    window.addEventListener("resize", locate);
    window.addEventListener("scroll", locate, true);
    const syncTimer = window.setInterval(locate, 400);
    return () => { window.removeEventListener("resize", locate); window.removeEventListener("scroll", locate, true); window.clearInterval(syncTimer); };
  }, [locate]);

  const advance = async (step: OnboardingStep, language?: Lang) => {
    setBusy(true); setError("");
    try { onStatusChange(await saveOnboardingProgress(address, step, language ?? status.language ?? lang)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "error"); }
    finally { setBusy(false); }
  };

  const skip = async () => {
    setBusy(true); setError("");
    try { onStatusChange(await dismissOnboarding(address)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "error"); }
    finally { setBusy(false); }
  };

  const finish = async () => {
    setBusy(true); setError("");
    try { await onFinish(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "error"); }
    finally { setBusy(false); }
  };

  if (status.step === "language") return (
    <div className={styles.backdrop} role="dialog" aria-modal="true">
      <section className={styles.languageCard}>
        <span>SEA BATTLE</span><h2>{copy.choose}</h2>
        <div><button onClick={() => { onLanguageChange("ru"); void advance("briefing", "ru"); }} disabled={busy}>RU <small>{copy.ru}</small></button><button onClick={() => { onLanguageChange("en"); void advance("briefing", "en"); }} disabled={busy}>EN <small>{copy.en}</small></button></div>
      </section>
    </div>
  );

  if (status.step === "complete") return null;

  const content = status.step === "briefing" ? [copy.checkinTitle, copy.checkinText]
    : status.step === "deployment" ? [copy.earnedTitle, lang === "ru" ? "готово, первые поинты начислены\nвозвращайся каждый день чтобы увеличивать серию" : "done, your first points are in\ncome back daily to grow your streak"]
    : status.step === "targeting" ? [copy.playTitle, copy.playText]
    : status.step === "result" ? [copy.questsTitle, copy.questsText]
    : [copy.passTitle, copy.passText];

  const nextStep: Partial<Record<OnboardingStep, OnboardingStep>> = { deployment: "targeting", targeting: "result", result: "checkin" };
  return (
    <div className={styles.tour} role="dialog" aria-modal="true">
      {rect ? <><div className={styles.shade} style={{ top: 0, left: 0, right: 0, height: rect.top }} /><div className={styles.shade} style={{ top: rect.bottom, left: 0, right: 0, bottom: 0 }} /><div className={styles.shade} style={{ top: rect.top, left: 0, width: rect.left, height: rect.height }} /><div className={styles.shade} style={{ top: rect.top, left: rect.right, right: 0, height: rect.height }} /><div className={`${styles.focus} ${reducedMotion ? styles.focusReduced : ""}`} style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }} /></> : <div className={`${styles.shade} ${styles.fullShade}`} />}
      <section className={`${styles.tip} ${rect && rect.top > (typeof window === "undefined" ? 400 : window.innerHeight / 2) ? styles.tipTop : ""}`}>
        <small>{status.step === "briefing" ? "01" : status.step === "deployment" ? "02" : status.step === "targeting" ? "03" : status.step === "result" ? "04" : "05"} / 05</small>
        <h2>{content[0]}</h2><p>{content[1]}</p>
        {status.step === "briefing" ? <button className={styles.primary} onClick={onOpenCheckin}>{copy.checkinTitle}</button> : status.step === "checkin" ? <button className={styles.primary} disabled={busy} onClick={() => void finish()}>{copy.done}</button> : <button className={styles.primary} disabled={busy} onClick={() => void advance(nextStep[status.step] ?? "checkin")}>{copy.next}</button>}
        <button className={styles.textButton} disabled={busy} onClick={() => void skip()}>{copy.skip}</button>
        {error && <em>{error}</em>}
      </section>
    </div>
  );
}
