"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DEFAULT_FLEETS, FLEET_MIN_POINTS, type FleetDropCalculation, type FleetId } from "../lib/fleetSeason";
import { CheckIcon, FlagIcon, GiftIcon, ShieldIcon, TrophyIcon, UsersIcon } from "../components/Icons";
import styles from "./FleetSeasonAdminPanel.module.css";

type Dashboard = {
  season: {
    seasonKey: string;
    title: string;
    startsAt: string;
    endsAt: string;
    status: "draft" | "active" | "ended" | "snapshotted";
    minTransactions: number;
    sharesBps: [number, number, number];
    dropId: string | null;
    claimStatus: "draft" | "active" | "closed" | null;
  };
  fleets: Array<{
    id: FleetId;
    name: string;
    color: string;
    image: string;
    displayOrder: number;
  }>;
  stats: {
    standings: Array<{
      id: FleetId;
      name: string;
      color: string;
      rank: number;
      members: number;
      eligibleMembers: number;
      games: number;
      wins: number;
      pointsEarned: number;
    }>;
  };
};

type FleetSeasonAdminPanelProps = {
  isRu: boolean;
};

const USDC_ADDRESS = "0x833589fcd6edb6e08f4c7c32d4f71b54bdA02913";

export function FleetSeasonAdminPanel({ isRu }: FleetSeasonAdminPanelProps) {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<FleetDropCalculation | null>(null);
  const [form, setForm] = useState(() => defaultForm());
  const [drop, setDrop] = useState({
    id: "s3-fleet-drop",
    title: "Season 3 Fleet Drop",
    tokenAddress: USDC_ADDRESS,
    tokenSymbol: "USDC",
    decimals: "6",
    totalAmount: "",
    contractAddress: "",
    signerAddress: "",
  });

  const changeDrop = useCallback((patch: Partial<typeof drop>) => {
    setDrop((current) => ({ ...current, ...patch }));
    setPreview(null);
  }, []);

  const syncForm = useCallback((next: Dashboard) => {
    setForm({
      seasonKey: next.season.seasonKey,
      title: next.season.title,
      startsAt: toLocalInput(next.season.startsAt),
      endsAt: toLocalInput(next.season.endsAt),
      minTransactions: String(next.season.minTransactions),
      fleetNames: Object.fromEntries(next.fleets.map((fleet) => [fleet.id, fleet.name])) as Record<FleetId, string>,
    });
    setDrop((current) => ({
      ...current,
      id: next.season.dropId || `${next.season.seasonKey.toLowerCase()}-fleet-drop`,
      title: `${next.season.title} Drop`,
    }));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/fleet-season", { cache: "no-store" });
      const data = await res.json().catch(() => null) as { dashboard?: Dashboard | null; error?: string } | null;
      if (!res.ok) throw new Error(data?.error || "Could not load fleet season");
      setDashboard(data?.dashboard ?? null);
      if (data?.dashboard) syncForm(data.dashboard);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load fleet season");
    } finally {
      setLoading(false);
    }
  }, [syncForm]);

  useEffect(() => {
    void load();
  }, [load]);

  const standings = useMemo(() => dashboard?.stats.standings ?? [], [dashboard?.stats.standings]);
  const totals = useMemo(() => ({
    members: standings.reduce((sum, fleet) => sum + fleet.members, 0),
    eligible: standings.reduce((sum, fleet) => sum + fleet.eligibleMembers, 0),
    wins: standings.reduce((sum, fleet) => sum + fleet.wins, 0),
    games: standings.reduce((sum, fleet) => sum + fleet.games, 0),
    points: standings.reduce((sum, fleet) => sum + fleet.pointsEarned, 0),
  }), [standings]);

  const runAction = useCallback(async (action: string, extra: Record<string, unknown> = {}) => {
    setBusyAction(action);
    setError("");
    setMessage("");
    try {
      const payload: Record<string, unknown> = {
        action,
        seasonKey: form.seasonKey,
        ...extra,
      };
      if (action === "save") {
        payload.title = form.title;
        payload.startsAt = new Date(form.startsAt).toISOString();
        payload.endsAt = new Date(form.endsAt).toISOString();
        payload.minTransactions = Number(form.minTransactions);
        payload.shares = [60, 30, 10];
        payload.fleets = DEFAULT_FLEETS.map((fleet) => ({
          ...fleet,
          name: form.fleetNames[fleet.id],
        }));
      }

      if (action === "save_eligibility") {
        payload.minTransactions = Number(form.minTransactions);
      }

      if (action === "preview_snapshot" || action === "create_snapshot") {
        payload.minTransactions = Number(form.minTransactions);
        payload.drop = {
          ...drop,
          decimals: Number(drop.decimals),
          totalAmountRaw: parseDecimalToRaw(drop.totalAmount, Number(drop.decimals)).toString(),
        };
      }

      const res = await fetch("/api/admin/fleet-season", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null) as {
        dashboard?: Dashboard;
        calculation?: FleetDropCalculation;
        error?: string;
      } | null;
      if (!res.ok) throw new Error(data?.error || "Fleet season action failed");
      if (data?.dashboard) {
        setDashboard(data.dashboard);
        syncForm(data.dashboard);
      }
      if (data?.calculation) setPreview(data.calculation);
      if (action === "save") setMessage(isRu ? "Черновик сохранён" : "Draft saved");
      if (action === "save_eligibility") setMessage(isRu ? "Критерии eligibility сохранены" : "Eligibility rules saved");
      if (action === "activate") setMessage(isRu ? "Сезон активирован" : "Season activated");
      if (action === "finish") setMessage(isRu ? "Сезон завершён, статистика зафиксирована" : "Season ended and stats locked");
      if (action === "preview_snapshot") setMessage(isRu ? "Расчёт готов. Проверь все три флота." : "Preview ready. Review all three fleets.");
      if (action === "create_snapshot") setMessage(isRu ? "Снапшот создан. Клейм пока выключен." : "Snapshot created. Claim is still disabled.");
      if (action === "activate_claim") setMessage(isRu ? "Клейм активирован" : "Claim activated");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Fleet season action failed");
    } finally {
      setBusyAction("");
    }
  }, [drop, form, isRu, syncForm]);

  const status = dashboard?.season.status ?? "draft";
  const claimActive = dashboard?.season.claimStatus === "active";
  const canEdit = !dashboard || status === "draft";
  const snapshotReady = status === "ended" && preview !== null;

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div>
          <span className={styles.kicker}>SEASON 3 CONTROL</span>
          <h2>Fleet Season</h2>
          <p>{isRu ? "Автораспределение игроков, рейтинг по победам и секретный дроп." : "Balanced assignment, win standings, and a secret fleet drop."}</p>
        </div>
        <span className={`${styles.status} ${styles[`status_${status}`]}`}>{claimActive ? "CLAIM LIVE" : status.toUpperCase()}</span>
      </header>

      {loading ? (
        <div className={styles.loading}>{isRu ? "Загрузка Fleet Season..." : "Loading Fleet Season..."}</div>
      ) : (
        <>
          <div className={styles.steps}>
            {[
              ["01", isRu ? "Черновик" : "Draft", true],
              ["02", isRu ? "Месяц игры" : "Live month", status !== "draft"],
              ["03", isRu ? "Снапшот" : "Snapshot", status === "snapshotted"],
              ["04", isRu ? "Клейм" : "Claim", claimActive],
            ].map(([number, label, complete]) => (
              <span key={String(number)} data-complete={String(complete)}><b>{number}</b>{label}</span>
            ))}
          </div>

          <section className={styles.configSection}>
            <div className={styles.sectionHead}>
              <span><ShieldIcon size={18} /> {isRu ? "НАСТРОЙКИ СЕЗОНА" : "SEASON CONFIG"}</span>
              <small>{isRu ? "Порог транзакций можно менять до снапшота" : "Transaction threshold stays editable until snapshot"}</small>
            </div>
            <div className={styles.formGrid}>
              <label><span>Season key</span><input value={form.seasonKey} onChange={(event) => setForm((current) => ({ ...current, seasonKey: event.target.value }))} disabled={!canEdit} /></label>
              <label><span>{isRu ? "Название" : "Title"}</span><input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} disabled={!canEdit} /></label>
              <label><span>{isRu ? "Начало" : "Starts"}</span><input type="datetime-local" value={form.startsAt} onChange={(event) => setForm((current) => ({ ...current, startsAt: event.target.value }))} disabled={!canEdit} /></label>
              <label><span>{isRu ? "Окончание" : "Ends"}</span><input type="datetime-local" value={form.endsAt} onChange={(event) => setForm((current) => ({ ...current, endsAt: event.target.value }))} disabled={!canEdit} /></label>
              <label><span>{isRu ? "Мин. транзакций для дропа" : "Min transactions for drop"}</span><input type="number" min="0" value={form.minTransactions} onChange={(event) => { setForm((current) => ({ ...current, minTransactions: event.target.value })); setPreview(null); }} disabled={status === "snapshotted"} /></label>
              <div className={styles.readonlyField}><span>{isRu ? "Метрика победителя" : "Winner metric"}</span><strong>{isRu ? "ОБЩЕЕ ЧИСЛО ПОБЕД" : "TOTAL FLEET WINS"}</strong></div>
            </div>

            <div className={styles.fleetConfigRows}>
              {DEFAULT_FLEETS.map((fleet, index) => (
                <label key={fleet.id} style={{ ["--fleet-color" as string]: fleet.color }}>
                  <span className={styles.fleetOrder}>0{index + 1}</span>
                  <span className={styles.colorSwatch} />
                  <input value={form.fleetNames[fleet.id]} onChange={(event) => setForm((current) => ({ ...current, fleetNames: { ...current.fleetNames, [fleet.id]: event.target.value } }))} disabled={!canEdit} />
                  <small>{fleet.id}</small>
                </label>
              ))}
            </div>

            <div className={styles.shareStrip}>
              <span><b>60%</b>{isRu ? "1 место" : "1st place"}</span>
              <span><b>30%</b>{isRu ? "2 место" : "2nd place"}</span>
              <span><b>10%</b>{isRu ? "3 место" : "3rd place"}</span>
            </div>

            <div className={styles.formulaBar}>
              <span><b>{isRu ? "МЕСТО ФЛОТА" : "FLEET RANK"}</b>{isRu ? "только по победам" : "total wins only"}</span>
              <span><b>{isRu ? "ЛИЧНЫЙ ДРОП" : "MEMBER PAYOUT"}</b>{isRu ? "100% пропорционально поинтам S3" : "100% proportional to S3 points"}</span>
              <span><b>{isRu ? "ELIGIBILITY" : "ELIGIBILITY"}</b>{FLEET_MIN_POINTS.toLocaleString()} PTS + {form.minTransactions || "0"} TX</span>
            </div>

            <div className={styles.actionRow}>
              {canEdit && <button type="button" className={styles.primary} disabled={!!busyAction} onClick={() => void runAction("save")}><CheckIcon size={17} />{busyAction === "save" ? "..." : isRu ? "СОХРАНИТЬ ЧЕРНОВИК" : "SAVE DRAFT"}</button>}
              {!canEdit && status !== "snapshotted" && <button type="button" className={styles.secondary} disabled={!!busyAction} onClick={() => void runAction("save_eligibility")}><CheckIcon size={17} />{busyAction === "save_eligibility" ? "..." : isRu ? "СОХРАНИТЬ КРИТЕРИИ" : "SAVE ELIGIBILITY"}</button>}
              {dashboard && status === "draft" && <button type="button" className={styles.activate} disabled={!!busyAction} onClick={() => void runAction("activate")}><FlagIcon size={17} />{isRu ? "ЗАПУСТИТЬ СЕЗОН" : "ACTIVATE SEASON"}</button>}
              {status === "active" && <button type="button" className={styles.danger} disabled={!!busyAction} onClick={() => window.confirm(isRu ? "Завершить сезон сейчас?" : "End the season now?") && void runAction("finish")}><ShieldIcon size={17} />{isRu ? "ЗАВЕРШИТЬ СЕЗОН" : "END SEASON"}</button>}
            </div>
          </section>

          <section className={styles.liveSection}>
            <div className={styles.sectionHead}>
              <span><TrophyIcon size={18} /> {isRu ? "СТАТИСТИКА ФЛОТОВ" : "FLEET STANDINGS"}</span>
              <small>{isRu ? "Тай-брейк: больше сыгранных матчей" : "Tie-break: more games played"}</small>
            </div>
            <div className={styles.statsSummary}>
              <span><UsersIcon size={16} /><b>{totals.members}</b>{isRu ? "участников" : "members"}</span>
              <span><CheckIcon size={16} /><b>{totals.eligible}</b>eligible</span>
              <span><TrophyIcon size={16} /><b>{totals.wins}</b>{isRu ? "побед" : "wins"}</span>
              <span><FlagIcon size={16} /><b>{totals.points.toLocaleString()}</b>{isRu ? "пойнтов S3" : "S3 points"}</span>
            </div>
            <div className={styles.standingRows}>
              {standings.length === 0 ? (
                <p className={styles.empty}>{isRu ? "Сохрани черновик, чтобы создать флоты." : "Save a draft to create the fleets."}</p>
              ) : standings.map((fleet) => (
                <div className={styles.standingRow} key={fleet.id} style={{ ["--fleet-color" as string]: fleet.color }}>
                  <b className={styles.rank}>#{fleet.rank}</b>
                  <span className={styles.fleetName}><strong>{fleet.name}</strong><small>{fleet.members} {isRu ? "участников" : "members"}</small></span>
                  <span><small>{isRu ? "ПОБЕДЫ" : "WINS"}</small><strong>{fleet.wins}</strong></span>
                  <span><small>{isRu ? "ПОЙНТЫ S3" : "S3 POINTS"}</small><strong>{fleet.pointsEarned.toLocaleString()}</strong></span>
                  <span><small>ELIGIBLE</small><strong>{fleet.eligibleMembers}</strong></span>
                </div>
              ))}
            </div>
          </section>

          <section className={styles.dropSection}>
            <div className={styles.sectionHead}>
              <span><GiftIcon size={18} /> {isRu ? "СЕКРЕТНЫЙ ДРОП" : "SECRET DROP"}</span>
              <small><ShieldIcon size={13} /> {isRu ? "Эти данные никогда не попадают в публичный API" : "Never returned by the public API"}</small>
            </div>
            <div className={styles.secretForm}>
              <label><span>Drop ID</span><input value={drop.id} onChange={(event) => changeDrop({ id: event.target.value })} /></label>
              <label><span>{isRu ? "Название клейма" : "Claim title"}</span><input value={drop.title} onChange={(event) => changeDrop({ title: event.target.value })} /></label>
              <label className={styles.secretAmount}><span>{isRu ? "СЕКРЕТНАЯ СУММА" : "SECRET TOTAL"}</span><input type="number" min="0" step="0.000001" value={drop.totalAmount} onChange={(event) => changeDrop({ totalAmount: event.target.value })} placeholder="180.72" /><small>{drop.tokenSymbol}</small></label>
              <label><span>Token</span><input value={drop.tokenAddress} onChange={(event) => changeDrop({ tokenAddress: event.target.value })} /></label>
              <label><span>Symbol</span><input value={drop.tokenSymbol} onChange={(event) => changeDrop({ tokenSymbol: event.target.value })} /></label>
              <label><span>Decimals</span><input type="number" min="0" max="36" value={drop.decimals} onChange={(event) => changeDrop({ decimals: event.target.value })} /></label>
              <label><span>Claim contract</span><input value={drop.contractAddress} onChange={(event) => changeDrop({ contractAddress: event.target.value })} placeholder="Uses default when empty" /></label>
              <label><span>Signer</span><input value={drop.signerAddress} onChange={(event) => changeDrop({ signerAddress: event.target.value })} placeholder="Uses default when empty" /></label>
            </div>

            <div className={styles.actionRow}>
              {(status === "active" || status === "ended") && <button type="button" className={styles.secondary} disabled={!!busyAction || !drop.totalAmount} onClick={() => void runAction("preview_snapshot")}><TrophyIcon size={17} />{isRu ? "РАССЧИТАТЬ И ПРОВЕРИТЬ" : "CALCULATE PREVIEW"}</button>}
              {snapshotReady && <button type="button" className={styles.primary} disabled={!!busyAction} onClick={() => window.confirm(isRu ? "Создать неизменяемый снапшот выплат?" : "Create the final payout snapshot?") && void runAction("create_snapshot")}><CheckIcon size={17} />{isRu ? "СОЗДАТЬ СНАПШОТ" : "CREATE SNAPSHOT"}</button>}
              {status === "snapshotted" && !claimActive && <button type="button" className={styles.activate} disabled={!!busyAction} onClick={() => window.confirm(isRu ? "Открыть клейм игрокам?" : "Open claims for players?") && void runAction("activate_claim")}><GiftIcon size={17} />{isRu ? "АКТИВИРОВАТЬ КЛЕЙМ" : "ACTIVATE CLAIM"}</button>}
            </div>

            {preview && (
              <div className={styles.previewRows}>
                {preview.buckets.map((bucket) => {
                  const fleet = standings.find((entry) => entry.id === bucket.fleetId);
                  return (
                    <div key={bucket.fleetId} style={{ ["--fleet-color" as string]: fleet?.color ?? "#28d7ef" }}>
                      <b>#{bucket.rank}</b>
                      <span><strong>{fleet?.name ?? bucket.fleetId}</strong><small>{bucket.wins} wins · {bucket.pointsEarned.toLocaleString()} pts · {bucket.eligibleMembers} wallets</small></span>
                      <span><strong>{bucket.shareBps / 100}%</strong><small>{formatRaw(bucket.amountRaw, Number(drop.decimals))} {drop.tokenSymbol}</small></span>
                    </div>
                  );
                })}
                <footer>{preview.payouts.length} {isRu ? "кошельков · 100% по поинтам S3" : "wallets · 100% by S3 points"}</footer>
              </div>
            )}
          </section>
        </>
      )}

      {message && <p className={styles.success}>{message}</p>}
      {error && <p className={styles.error}>{error}<small>scripts/supabase-fleet-season.sql</small></p>}
    </div>
  );
}

function defaultForm() {
  const startsAt = new Date("2026-09-01T00:00:00.000Z");
  const endsAt = new Date("2026-10-10T20:59:59.000Z");
  return {
    seasonKey: "S3",
    title: "Fleet Season",
    startsAt: toLocalInput(startsAt.toISOString()),
    endsAt: toLocalInput(endsAt.toISOString()),
    minTransactions: "10",
    fleetNames: Object.fromEntries(DEFAULT_FLEETS.map((fleet) => [fleet.id, fleet.name])) as Record<FleetId, string>,
  };
}

function toLocalInput(value: string) {
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function parseDecimalToRaw(value: string, decimals: number) {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(normalized)) throw new Error("Invalid drop amount");
  const [whole, fraction = ""] = normalized.split(".");
  if (fraction.length > decimals) throw new Error(`Token supports ${decimals} decimals`);
  return BigInt(whole) * (BigInt(10) ** BigInt(decimals)) + BigInt((fraction + "0".repeat(decimals)).slice(0, decimals) || "0");
}

function formatRaw(raw: string, decimals: number) {
  const value = BigInt(raw || "0");
  const scale = BigInt(10) ** BigInt(Math.max(0, decimals));
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole.toLocaleString()}${fraction ? `.${fraction.slice(0, 6)}` : ""}`;
}
