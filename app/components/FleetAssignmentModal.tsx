"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { FleetId, PublicFleetMembership, PublicFleetSeason } from "../lib/fleetSeason";
import { AnchorIcon, CheckIcon, ChevronRightIcon, ShieldIcon, TrophyIcon, UsersIcon } from "./Icons";
import styles from "./FleetAssignmentModal.module.css";

type FleetAssignmentModalProps = {
  open: boolean;
  busy: boolean;
  busyLabel?: string;
  error: string;
  lang: "en" | "ru";
  season: PublicFleetSeason | null;
  membership: PublicFleetMembership | null;
  onSelectFleet: (fleetId: FleetId) => void;
  onContinue: () => void;
  onClose: () => void;
};

export function FleetAssignmentModal({
  open,
  busy,
  busyLabel,
  error,
  lang,
  season,
  membership,
  onSelectFleet,
  onContinue,
  onClose,
}: FleetAssignmentModalProps) {
  const primaryRef = useRef<HTMLButtonElement>(null);
  const [selectedFleetId, setSelectedFleetId] = useState<FleetId | null>(null);
  const [changeMode, setChangeMode] = useState(false);
  const ru = lang === "ru";
  const fleet = season?.fleets.find((entry) => entry.id === membership?.fleetId) ?? null;
  const selectedFleet = season?.fleets.find((entry) => entry.id === selectedFleetId) ?? null;

  useEffect(() => {
    if (!open) return;
    setSelectedFleetId(null);
    setChangeMode(false);
  }, [open]);

  useEffect(() => {
    setSelectedFleetId(null);
    setChangeMode(false);
  }, [membership?.fleetId]);

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

        {membership && !changeMode ? (
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
            <button className={styles.changeFleet} type="button" onClick={() => setChangeMode(true)}>
              {ru ? "СМЕНИТЬ ФЛОТ · 5 USDC" : "CHANGE FLEET · 5 USDC"}
            </button>
          </>
        ) : (
          <>
            <div className={styles.assignmentHead}>
              <span>{changeMode ? (ru ? "СЕЗОН 3 · СМЕНА ЗА 5 USDC" : "SEASON 3 · 5 USDC CHANGE") : (ru ? "СЕЗОН 3 · ВЫБОР НА ВЕСЬ СЕЗОН" : "SEASON 3 · ONE CHOICE")}</span>
              <h2 id="fleet-assignment-title">{changeMode ? (ru ? "ВЫБЕРИ НОВЫЙ ФЛОТ" : "CHOOSE A NEW FLEET") : (ru ? "ВЫБЕРИ СВОЙ ФЛОТ" : "CHOOSE YOUR FLEET")}</h2>
              <p>{changeMode ? (ru ? "После подтверждения кошелёк отправит 5 USDC. Твои сезонные показатели перейдут в новый флот." : "Confirm to send 5 USDC. Your season stats will move with you.") : (ru ? "Ты сам решаешь, за какой флот играть. После подтверждения смена стоит 5 USDC." : "You decide who to fight for. Changing later costs 5 USDC.")}</p>
            </div>

            <div className={styles.fleetChoices} role="radiogroup" aria-label={ru ? "Выбор флота" : "Choose a fleet"}>
              {(season?.fleets ?? []).map((entry) => {
                const selected = selectedFleetId === entry.id;
                const current = membership?.fleetId === entry.id;
                return (
                  <button
                    key={entry.id}
                    className={`${styles.fleetChoice} ${selected ? styles.fleetChoiceSelected : ""}`}
                    style={{ ["--fleet-color" as string]: entry.color }}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={busy || current}
                    onClick={() => setSelectedFleetId(entry.id)}
                  >
                    <span className={styles.choiceMark}>{selected ? <CheckIcon size={14} /> : null}</span>
                    {current && <span className={styles.currentFleet}>{ru ? "ТЕКУЩИЙ" : "CURRENT"}</span>}
                    <span className={styles.choiceShip}><Image src={entry.image} alt="" fill sizes="180px" /></span>
                    <span className={styles.choiceCopy}>
                      <strong>{entry.name}</strong>
                      <small><TrophyIcon size={11} /> {entry.wins.toLocaleString()} W</small>
                      <small><UsersIcon size={11} /> {entry.members}</small>
                    </span>
                  </button>
                );
              })}
            </div>

            <div className={styles.rules}>
              <span><TrophyIcon size={16} /> {ru ? "Больше побед — выше место" : "More wins means a higher rank"}</span>
              <span><ShieldIcon size={16} /> {changeMode ? (ru ? "Оплата проверяется в сети Base" : "Payment is verified on Base") : (ru ? "Смена позже стоит 5 USDC" : "Changing later costs 5 USDC")}</span>
            </div>

            {error && <p className={styles.choiceError}>{error}</p>}

            {selectedFleet && (
              <div className={styles.selectedFleet} style={{ ["--fleet-color" as string]: selectedFleet.color }}>
                <CheckIcon size={16} />
                <span>{ru ? "ВЫБРАН" : "SELECTED"}</span>
                <strong>{selectedFleet.name}</strong>
              </div>
            )}

            <button
              ref={primaryRef}
              className={styles.primary}
              type="button"
              disabled={!selectedFleetId || busy}
              onClick={() => selectedFleetId && onSelectFleet(selectedFleetId)}
            >
              {busy
                ? (busyLabel || (ru ? "СОХРАНЯЕМ ФЛОТ..." : "SAVING YOUR FLEET..."))
                : selectedFleet
                  ? changeMode
                    ? (ru ? `ОПЛАТИТЬ 5 USDC · ${selectedFleet.name.toUpperCase()}` : `PAY 5 USDC · JOIN ${selectedFleet.name.toUpperCase()}`)
                    : (ru ? `ВЫБРАТЬ ${selectedFleet.name.toUpperCase()}` : `JOIN ${selectedFleet.name.toUpperCase()}`)
                  : (ru ? "СНАЧАЛА ВЫБЕРИ ФЛОТ" : "SELECT A FLEET")}
              {!busy && <ChevronRightIcon size={18} />}
            </button>

            {busy && <span className={styles.busyRadar}><AnchorIcon size={18} /></span>}
            {changeMode && !busy && (
              <button className={styles.cancelChange} type="button" onClick={() => setChangeMode(false)}>
                {ru ? "ОТМЕНИТЬ СМЕНУ" : "CANCEL CHANGE"}
              </button>
            )}
          </>
        )}
      </section>
    </div>
  );
}
