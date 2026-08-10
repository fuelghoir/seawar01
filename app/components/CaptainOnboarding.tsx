"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Lang } from "../lib/settings";
import { useOnboarding } from "../providers/OnboardingProvider";
import { MissionGuide } from "./MissionGuide";
import styles from "./CaptainOnboarding.module.css";

const COPY = {
  ru: {
    skip: "пропустить обучение",
    languageEyebrow: "канал связи / recruit-02",
    languageTitle: "выбери язык",
    languageBody: "дальше будет короткий боевой курс на настоящих экранах игры",
    ru: "русский",
    en: "english",
    checkinEyebrow: "первый выход",
    checkinTitle: "забери первые пойнты",
    checkinBody: "нажми на настоящий check-in под подсветкой и подтверди транзакцию\nесли Base App покажет FREE, газ оплачивает приложение",
    checkinCta: "открыть check-in",
    loadoutEyebrow: "снаряжение",
    loadoutTitle: "собери бесплатный комплект",
    loadoutBody: "в магазине тебя ждут радар и торпеда. комплект стоит 0 пойнтов и выдаётся один раз",
    loadoutCta: "забрать комплект",
    battleEyebrow: "учебный полигон",
    battleTitle: "выиграй первый бой",
    battleBody: "подсказки появятся поверх обычного боя с ботом: расставишь флот, попробуешь радар и торпеду, а затем добьёшь соперника",
    battleCta: "начать учебный бой",
    debriefEyebrow: "сигнал подтверждён",
    debriefTitle: "курс пройден",
    debriefBody: "первый комплект у тебя, управление освоено. дальше играй с ботом, другом или за USDC",
    debriefCta: "завершить обучение",
  },
  en: {
    skip: "skip tutorial",
    languageEyebrow: "comms channel / recruit-02",
    languageTitle: "choose your language",
    languageBody: "next is a short combat course on the real game screens",
    ru: "русский",
    en: "english",
    checkinEyebrow: "first deployment",
    checkinTitle: "collect your first points",
    checkinBody: "tap the real check-in under the target and confirm the transaction\nwhen Base App shows FREE, the app sponsors the gas",
    checkinCta: "open check-in",
    loadoutEyebrow: "loadout",
    loadoutTitle: "claim your free recruit kit",
    loadoutBody: "a radar and torpedo are waiting in the shop. the kit costs 0 points and can be claimed once",
    loadoutCta: "claim recruit kit",
    battleEyebrow: "training waters",
    battleTitle: "win your first battle",
    battleBody: "tips appear over the regular bot battle: deploy your fleet, try the radar and torpedo, then finish the opponent",
    battleCta: "start training battle",
    debriefEyebrow: "signal confirmed",
    debriefTitle: "training complete",
    debriefBody: "your starter kit is secured and the controls are clear. next, fight the bot, a friend, or play for USDC",
    debriefCta: "finish tutorial",
  },
} as const;

type CaptainOnboardingProps = {
  lang: Lang;
  reducedMotion: boolean;
  onLanguageChange: (language: Lang) => void;
  onOpenCheckin: () => void;
};

export function CaptainOnboarding({
  lang,
  reducedMotion,
  onLanguageChange,
  onOpenCheckin,
}: CaptainOnboardingProps) {
  const router = useRouter();
  const { status, progress, dismiss, complete } = useOnboarding();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const copy = COPY[lang];

  if (!status?.required || status.step === "complete") return null;

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "training is unavailable");
    } finally {
      setBusy(false);
    }
  };

  const skip = () => void run(dismiss);

  if (status.step === "language") {
    return (
      <div className={`${styles.languageBackdrop} ${reducedMotion ? styles.reducedMotion : ""}`} role="dialog" aria-modal="true" aria-labelledby="recruit-language-title">
        <button className={styles.languageSkip} type="button" onClick={skip} disabled={busy}>
          {copy.skip}
        </button>
        <section className={styles.languageCard}>
          <div className={styles.languageMeta} aria-hidden="true">
            <span>SEA BATTLE / BASE</span>
            <span><i /> COMMS ONLINE</span>
          </div>
          <div className={styles.languageRadar} aria-hidden="true">
            <span /><span /><span /><i />
          </div>
          <span className={styles.languageEyebrow}>{copy.languageEyebrow}</span>
          <h2 id="recruit-language-title">{copy.languageTitle}</h2>
          <p>{copy.languageBody}</p>
          <div className={styles.languageOptions}>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                onLanguageChange("ru");
                void run(() => progress("checkin", "ru"));
              }}
            >
              <strong>RU</strong><span>{copy.ru}</span><i>→</i>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                onLanguageChange("en");
                void run(() => progress("checkin", "en"));
              }}
            >
              <strong>EN</strong><span>{copy.en}</span><i>→</i>
            </button>
          </div>
          {error && <div className={styles.languageError} role="alert">{error}</div>}
        </section>
      </div>
    );
  }

  if (status.step === "checkin") {
    return (
      <MissionGuide
        key="checkin"
        target='[data-tour="checkin"]'
        eyebrow={copy.checkinEyebrow}
        title={copy.checkinTitle}
        body={copy.checkinBody}
        step={2}
        total={5}
        primaryLabel={copy.checkinCta}
        onPrimary={onOpenCheckin}
        skipLabel={copy.skip}
        onSkip={skip}
        busy={busy}
        error={error}
        reducedMotion={reducedMotion}
      />
    );
  }

  if (status.step === "loadout") {
    return (
      <MissionGuide
        key="loadout"
        target='[data-tour="shop"]'
        eyebrow={copy.loadoutEyebrow}
        title={copy.loadoutTitle}
        body={copy.loadoutBody}
        step={3}
        total={5}
        primaryLabel={copy.loadoutCta}
        onPrimary={() => router.push("/shop?recruit=1#shop-items")}
        skipLabel={copy.skip}
        onSkip={skip}
        busy={busy}
        error={error}
        reducedMotion={reducedMotion}
      />
    );
  }

  if (status.step === "battle") {
    return (
      <MissionGuide
        key="battle"
        target='[data-tour="play"]'
        eyebrow={copy.battleEyebrow}
        title={copy.battleTitle}
        body={copy.battleBody}
        step={4}
        total={5}
        primaryLabel={copy.battleCta}
        onPrimary={() => router.push("/game?mode=bot&tutorial=1")}
        skipLabel={copy.skip}
        onSkip={skip}
        busy={busy}
        error={error}
        reducedMotion={reducedMotion}
      />
    );
  }

  return (
    <MissionGuide
      key="debrief"
      eyebrow={copy.debriefEyebrow}
      title={copy.debriefTitle}
      body={copy.debriefBody}
      step={5}
      total={5}
      primaryLabel={copy.debriefCta}
      onPrimary={() => void run(complete)}
      skipLabel={copy.skip}
      onSkip={skip}
      busy={busy}
      error={error}
      reducedMotion={reducedMotion}
    />
  );
}
