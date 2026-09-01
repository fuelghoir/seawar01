"use client";

import type { PublicFleetMembership, PublicFleetSeason } from "../lib/fleetSeason";
import { ChevronRightIcon, ShieldIcon, TrophyIcon } from "./Icons";
import styles from "./FleetSeasonHomeCard.module.css";

type FleetSeasonHomeCardProps = {
  season: PublicFleetSeason;
  membership: PublicFleetMembership | null;
  lang: "en" | "ru";
  variant?: "compact" | "wide";
  onOpen: () => void;
};

export function FleetSeasonHomeCard({ season, membership, lang, variant = "compact", onOpen }: FleetSeasonHomeCardProps) {
  const ru = lang === "ru";
  const leadingFleet = season.fleets.find((fleet) => fleet.rank === 1) ?? season.fleets[0];
  const yourFleet = season.fleets.find((fleet) => fleet.id === membership?.fleetId) ?? null;

  if (variant === "wide") {
    return (
      <button className={`${styles.card} ${styles.wide}`} type="button" onClick={onOpen}>
        <span className={styles.wideHead}>
          <span className={styles.icon} style={{ ["--fleet-color" as string]: yourFleet?.color ?? leadingFleet?.color ?? "#28d7ef" }}>
            <ShieldIcon size={20} />
          </span>
          <span className={styles.copy}>
            <small>FLEET SEASON</small>
            <strong>{yourFleet ? `${yourFleet.name} · ${ru ? "ЗАКРЕПЛЁН" : "LOCKED"}` : (ru ? "Флот назначится при Play" : "Fleet assigned on Play")}</strong>
          </span>
          <span className={styles.live}>{season.status === "active" ? "LIVE" : "FINAL"}</span>
        </span>

        <span className={styles.miniRows}>
          {season.fleets.map((fleet) => (
            <span className={styles.miniRow} key={fleet.id} style={{ ["--fleet-color" as string]: fleet.color }}>
              <i />
              <b>0{fleet.rank}</b>
              <strong>{fleet.name}</strong>
              <small>{fleet.wins.toLocaleString()} W</small>
              <em>{season.shares[fleet.rank - 1]}%</em>
            </span>
          ))}
        </span>

        <span className={styles.wideFoot}>
          <span><b>{ru ? "ДРОП СКРЫТ" : "DROP CLASSIFIED"}</b><small>{ru ? "50% поровну + 50% по пойнтам" : "50% equal + 50% by points"}</small></span>
          <ChevronRightIcon size={17} />
        </span>
      </button>
    );
  }

  return (
    <button className={styles.card} type="button" onClick={onOpen}>
      <span className={styles.icon} style={{ ["--fleet-color" as string]: yourFleet?.color ?? leadingFleet?.color ?? "#28d7ef" }}>
        <ShieldIcon size={20} />
      </span>
      <span className={styles.copy}>
        <small>FLEET SEASON</small>
        <strong>{yourFleet ? `${yourFleet.name} · #${yourFleet.rank}` : (ru ? "Флот назначится при Play" : "Fleet assigned on Play")}</strong>
      </span>
      <span className={styles.leader}>
        <small><TrophyIcon size={11} /> {ru ? "ЛИДЕР" : "LEADER"}</small>
        <strong>{leadingFleet?.name}</strong>
      </span>
      <ChevronRightIcon size={17} />
    </button>
  );
}
