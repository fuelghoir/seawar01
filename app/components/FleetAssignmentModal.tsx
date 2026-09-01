"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import type { PublicFleetMembership, PublicFleetSeason } from "../lib/fleetSeason";
import { AnchorIcon, ChevronRightIcon, ShieldIcon, TrophyIcon } from "./Icons";
import styles from "./FleetAssignmentModal.module.css";

type FleetAssignmentModalProps = {
  open: boolean;
  busy: boolean;
  error: string;
  lang: "en" | "ru";
  season: PublicFleetSeason | null;
  membership: PublicFleetMembership | null;
  onContinue: () => void;
  onRetry: () => void;
  onClose: () => void;
};

export function FleetAssignmentModal({
  open,
  busy,
  error,
  lang,
  season,
  membership,
  onContinue,
  onRetry,
  onClose,
}: FleetAssignmentModalProps) {
  const primaryRef = useRef<HTMLButtonElement>(null);
  const ru = lang === "ru";
  const fleet = season?.fleets.find((entry) => entry.id === membership?.fleetId) ?? null;

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const timer = window.setTimeout(() => primaryRef.current?.focus(), 120);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [busy, onClose, open]);

  if (!open) return null;

  return (
    <div className={styles.backdrop} onMouseDown={() => !busy && onClose()}>
      <section
        className={styles.modal}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="fleet-assignment-title"
      >
        <button className={styles.close} type="button" onClick={onClose} disabled={busy} aria-label={ru ? "Закрыть" : "Close"}>
          X
        </button>

        {busy ? (
          <div className={styles.loadingState}>
            <span className={styles.radar}><AnchorIcon size={34} /></span>
            <span>{ru ? "РАСПРЕДЕЛЕНИЕ ФЛОТА" : "FLEET ASSIGNMENT"}</span>
            <h2 id="fleet-assignment-title">{ru ? "ИЩЕМ СВОБОДНОЕ МЕСТО" : "BALANCING THE FLEETS"}</h2>
            <p>{ru ? "Система отправит тебя в наименее заполненный флот." : "You will join the fleet with the fewest captains."}</p>
          </div>
        ) : error ? (
          <div className={styles.errorState}>
            <span className={styles.statusIcon}><ShieldIcon size={28} /></span>
            <span>{ru ? "ФЛОТ НЕ НАЗНАЧЕН" : "ASSIGNMENT FAILED"}</span>
            <h2 id="fleet-assignment-title">{ru ? "ПОПРОБУЕМ ЕЩЁ РАЗ" : "TRY ASSIGNMENT AGAIN"}</h2>
            <p>{error}</p>
            <button ref={primaryRef} className={styles.primary} type="button" onClick={onRetry}>
              {ru ? "ПОВТОРИТЬ" : "RETRY"}
              <ChevronRightIcon size={18} />
            </button>
          </div>
        ) : (
          <>
            <div className={styles.assignmentHead}>
              <span>{ru ? "СЕЗОН 3 · ФЛОТ ЗАКРЕПЛЁН" : "SEASON 3 · FLEET LOCKED"}</span>
              <h2 id="fleet-assignment-title">{membership?.fleetName ?? fleet?.name}</h2>
              <p>{ru ? "Этот флот сохранён за тобой до конца сезона." : "This fleet is locked to your wallet until the season ends."}</p>
            </div>

            <div className={styles.shipStage} style={{ ["--fleet-color" as string]: fleet?.color ?? "#28d7ef" }}>
              {fleet?.image ? <Image src={fleet.image} alt="" fill sizes="360px" priority /> : <ShieldIcon size={72} />}
              <span className={styles.fleetSeal}><ShieldIcon size={18} /> LOCKED</span>
            </div>

            <div className={styles.rules}>
              <span><TrophyIcon size={16} /> {ru ? "Место флота считается по победам" : "Fleet rank is based on wins"}</span>
              <span><ShieldIcon size={16} /> {ru ? "Дроп скрыт · 50% по пойнтам S3" : "Drop hidden · 50% by S3 points"}</span>
            </div>

            <button ref={primaryRef} className={styles.primary} type="button" onClick={onContinue}>
              {ru ? "ПЕРЕЙТИ К ВЫБОРУ ИГРЫ" : "CONTINUE TO BATTLE MODES"}
              <ChevronRightIcon size={18} />
            </button>
          </>
        )}
      </section>
    </div>
  );
}
