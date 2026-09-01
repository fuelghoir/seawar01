"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import type { PublicFleetSeason } from "../lib/fleetSeason";
import { ChevronRightIcon, ShieldIcon, TrophyIcon } from "./Icons";
import styles from "./FleetSeasonIntro.module.css";

type FleetSeasonIntroProps = {
  open: boolean;
  season: PublicFleetSeason;
  lang: "en" | "ru";
  onClose: () => void;
};

export function FleetSeasonIntro({ open, season, lang, onClose }: FleetSeasonIntroProps) {
  const actionRef = useRef<HTMLButtonElement>(null);
  const ru = lang === "ru";

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const timer = window.setTimeout(() => actionRef.current?.focus(), 120);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(timer);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className={styles.backdrop} onMouseDown={onClose}>
      <section
        className={styles.modal}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="fleet-season-intro-title"
      >
        <button className={styles.close} type="button" onClick={onClose} aria-label={ru ? "Закрыть" : "Close"}>X</button>

        <header className={styles.head}>
          <span><ShieldIcon size={13} /> {ru ? "СЕЗОН 3 УЖЕ ИДЁТ" : "SEASON 3 IS LIVE"}</span>
          <h2 id="fleet-season-intro-title">{ru ? "ВЫБЕРИ ФЛОТ. ПОБЕЖДАЙТЕ ВМЕСТЕ." : "CHOOSE A FLEET. WIN TOGETHER."}</h2>
          <p>{ru ? "При первом нажатии Play ты сам выберешь один из трёх флотов. Выбор сохранится до конца сезона." : "On your first Play, choose one of three fleets. Your choice stays locked until the season ends."}</p>
        </header>

        <div className={styles.fleetLine}>
          {season.fleets.map((fleet) => (
            <div className={styles.fleet} key={fleet.id} style={{ ["--fleet-color" as string]: fleet.color }}>
              <span className={styles.ship}><Image src={fleet.image} alt="" fill sizes="160px" /></span>
              <strong>{fleet.name}</strong>
            </div>
          ))}
        </div>

        <div className={styles.rules}>
          <span><TrophyIcon size={17} /><b>{ru ? "ПОБЕДЫ = МЕСТО" : "WINS = RANK"}</b><small>{ru ? "Больше побед — выше флот" : "More wins move the fleet higher"}</small></span>
          <span><ShieldIcon size={17} /><b>60 / 30 / 10</b><small>{ru ? "Доли по итоговым местам" : "Shares by final rank"}</small></span>
          <span><b>50% + 50%</b><small>{ru ? "Поровну и по пойнтам S3" : "Equal split and S3 points"}</small></span>
        </div>

        <div className={styles.classified}>
          <span>{ru ? "USDC ДРОП" : "USDC DROP"}</span>
          <strong>{ru ? "СУММА ЗАСЕКРЕЧЕНА" : "AMOUNT CLASSIFIED"}</strong>
        </div>

        <button ref={actionRef} className={styles.action} type="button" onClick={onClose}>
          {ru ? "ВОЙТИ В СЕЗОН" : "ENTER SEASON"}
          <ChevronRightIcon size={18} />
        </button>
      </section>
    </div>
  );
}
