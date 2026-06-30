"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useAccount, useConnect, useSignMessage } from "wagmi";
import styles from "./page.module.css";

type Submission = {
  id: number;
  wallet: string;
  url: string;
  status: string;
  admin_note?: string | null;
  created_at: string;
};

type Creator = {
  wallet: string;
  submissions: number;
  pendingSubmissions: number;
  rewards: number;
  referrals: number;
  activeReferrals: number;
  referralGames: number;
  referralWins: number;
  referralPoints: number;
  referralTxs: number;
  points: number;
  wins: number;
  games: number;
  txs: number;
};

type Reward = {
  id: number;
  wallet: string;
  reward_kind: string;
  points?: number | null;
  item_slug?: string | null;
  quantity?: number | null;
  amount_raw?: string | null;
  reward_label?: string | null;
  status: string;
  created_at: string;
};

type DropCampaign = {
  id: string;
  title: string;
  token_address: string;
  token_symbol: string;
  decimals: number;
  total_amount_raw: string;
  total_points: number;
  contract_address?: string | null;
  signer_address?: string | null;
  status: string;
  allocations?: number;
  claimed?: number;
  allocatedRaw?: string;
};

type Tab = "submissions" | "creators" | "drops" | "promos";
type RewardMode = "game" | "token";
type TokenKind = "usdc" | "base" | "token";

const TAB_LABEL: Record<Tab, string> = {
  submissions: "Заявки",
  creators: "Креаторы",
  drops: "Дропы",
  promos: "Promos",
};

type GeneratedPromo = {
  id: string;
  title: string;
  points: number;
  itemSlug: string | null;
  itemLabel: string;
  quantity: number;
  expiresAt: string | null;
  code: string;
  link: string;
  shopLink: string;
  baseAppLink: string;
};

const ITEM_OPTIONS = [
  { slug: "", label: "Без предмета" },
  { slug: "double_points_1h", label: "Двойные очки 1ч" },
  { slug: "quest_reroll", label: "Реролл квеста" },
  { slug: "streak_freeze", label: "Защита серии" },
  { slug: "radar_scan", label: "Радар" },
  { slug: "torpedo", label: "Торпеда" },
];

export default function AdminPage() {
  const { address, isConnected } = useAccount();
  const { connectors, connect, isPending: connectPending } = useConnect();
  const { signMessageAsync, isPending: signing } = useSignMessage();
  const [authenticated, setAuthenticated] = useState(false);
  const [adminAddress, setAdminAddress] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("submissions");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [creators, setCreators] = useState<Creator[]>([]);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [drops, setDrops] = useState<DropCampaign[]>([]);
  const [rejectTarget, setRejectTarget] = useState<Submission | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rewardTarget, setRewardTarget] = useState<{ wallet: string; submissionId?: number } | null>(null);
  const [rewardMode, setRewardMode] = useState<RewardMode>("game");
  const [rewardBusy, setRewardBusy] = useState(false);
  const [gameReward, setGameReward] = useState({
    points: "1000",
    itemSlug: "",
    quantity: "1",
    note: "",
  });
  const [tokenReward, setTokenReward] = useState({
    kind: "usdc" as TokenKind,
    amount: "",
    tokenAddress: "",
    note: "",
  });
  const [dropForm, setDropForm] = useState({
    id: "",
    title: "",
    tokenAddress: "",
    tokenSymbol: "TOKEN",
    decimals: "18",
    totalAmount: "",
  });
  const [promoForm, setPromoForm] = useState({
    id: "",
    title: "Creator bonus",
    points: "1000",
    itemSlug: "",
    quantity: "1",
    expiresDays: "30",
    note: "",
  });
  const [generatedPromo, setGeneratedPromo] = useState<GeneratedPromo | null>(null);

  const pendingSubmissions = useMemo(
    () => submissions.filter((submission) => submission.status === "pending").length,
    [submissions],
  );

  const loadSession = useCallback(async () => {
    const res = await fetch("/api/admin/session");
    const data = await res.json().catch(() => null);
    setAuthenticated(!!data?.authenticated);
    setAdminAddress(data?.address ?? null);
  }, []);

  const loadData = useCallback(async () => {
    if (!authenticated) return;
    setLoading(true);
    setError("");
    try {
      const [creatorRes, dropsRes] = await Promise.all([
        fetch("/api/admin/creator"),
        fetch("/api/admin/drops"),
      ]);
      const creatorData = await creatorRes.json().catch(() => null);
      const dropsData = await dropsRes.json().catch(() => null);
      if (!creatorRes.ok) throw new Error(creatorData?.error || "Не удалось загрузить креаторов");
      if (!dropsRes.ok) throw new Error(dropsData?.error || "Не удалось загрузить дропы");
      setSubmissions(creatorData?.submissions ?? []);
      setCreators(creatorData?.creators ?? []);
      setRewards(creatorData?.rewards ?? []);
      setDrops(dropsData?.campaigns ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить админку");
    } finally {
      setLoading(false);
    }
  }, [authenticated]);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const login = async () => {
    if (!address) return;
    setError("");
    setMessage("");
    try {
      const msgRes = await fetch(`/api/admin/auth?wallet=${encodeURIComponent(address)}`);
      const msgData = await msgRes.json().catch(() => null);
      if (!msgRes.ok) throw new Error(msgData?.error || "Кошелек не в списке админов");
      const signature = await signMessageAsync({ message: msgData.message });
      const res = await fetch("/api/admin/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: address, message: msgData.message, signature }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Не удалось войти");
      setAuthenticated(true);
      setAdminAddress(data.address);
      setMessage("Вход выполнен");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось войти");
    }
  };

  const updateSubmission = async (id: number, status: string, adminNote = "") => {
    setError("");
    setMessage("");
    const res = await fetch(`/api/admin/creator/submissions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, adminNote }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setError(data?.error || "Не удалось обновить заявку");
      return false;
    }
    setMessage("Заявка обновлена");
    await loadData();
    return true;
  };

  const rejectSubmission = async () => {
    if (!rejectTarget) return;
    const ok = await updateSubmission(rejectTarget.id, "rejected", rejectReason.trim());
    if (ok) {
      setRejectTarget(null);
      setRejectReason("");
    }
  };

  const postReward = async (payload: Record<string, unknown>) => {
    const res = await fetch("/api/admin/creator/rewards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || "Не удалось выдать награду");
  };

  const grantReward = async () => {
    if (!rewardTarget || rewardBusy) return;
    setRewardBusy(true);
    setError("");
    setMessage("");

    try {
      if (rewardMode === "game") {
        const points = Math.max(0, Math.floor(Number(gameReward.points || 0)));
        const quantity = Math.max(0, Math.floor(Number(gameReward.quantity || 0)));
        const itemSlug = gameReward.itemSlug;

        if (points <= 0 && (!itemSlug || quantity <= 0)) {
          throw new Error("Выбери очки или предмет");
        }

        if (points > 0) {
          await postReward({
            wallet: rewardTarget.wallet,
            sourceSubmissionId: rewardTarget.submissionId,
            rewardKind: "points",
            points,
            rewardLabel: `+${points.toLocaleString()} pts`,
            adminNote: gameReward.note,
          });
        }

        if (itemSlug && quantity > 0) {
          const itemName = ITEM_OPTIONS.find((item) => item.slug === itemSlug)?.label ?? itemSlug;
          await postReward({
            wallet: rewardTarget.wallet,
            sourceSubmissionId: rewardTarget.submissionId,
            rewardKind: "item",
            itemSlug,
            quantity,
            rewardLabel: `${quantity}x ${itemName}`,
            adminNote: gameReward.note,
          });
        }
      } else {
        const decimals = tokenReward.kind === "usdc" ? 6 : 18;
        const amountRaw = parseDecimalToRaw(tokenReward.amount, decimals);
        const tokenAddress = tokenReward.kind === "token" ? tokenReward.tokenAddress.trim() : "";
        const symbol = tokenReward.kind === "usdc" ? "USDC" : tokenReward.kind === "base" ? "BASE" : "TOKEN";

        if (amountRaw <= BigInt(0)) throw new Error("Введи сумму токенов");
        if (tokenReward.kind === "token" && !/^0x[a-fA-F0-9]{40}$/.test(tokenAddress)) {
          throw new Error("Введи адрес токена");
        }

        await postReward({
          wallet: rewardTarget.wallet,
          sourceSubmissionId: rewardTarget.submissionId,
          rewardKind: tokenReward.kind,
          tokenAddress,
          amountRaw: amountRaw.toString(),
          status: "claimable",
          rewardLabel: `${tokenReward.amount} ${symbol}`,
          adminNote: tokenReward.note,
        });
      }

      setMessage("Награда сохранена");
      setRewardTarget(null);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось выдать награду");
    } finally {
      setRewardBusy(false);
    }
  };

  const createDropSnapshot = async () => {
    setError("");
    setMessage("");
    const decimals = Math.max(0, Math.min(36, Math.floor(Number(dropForm.decimals || 18))));
    const totalAmountRaw = parseDecimalToRaw(dropForm.totalAmount, decimals).toString();
    const res = await fetch("/api/admin/drops", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: dropForm.id,
        title: dropForm.title,
        tokenAddress: dropForm.tokenAddress,
        tokenSymbol: dropForm.tokenSymbol,
        decimals,
        totalAmountRaw,
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setError(data?.error || "Не удалось создать snapshot");
      return;
    }
    setMessage(`Snapshot создан: ${data.drop.allocations} кошельков`);
    loadData();
  };

  const updateDrop = async (id: string, status: string) => {
    setError("");
    setMessage("");
    const res = await fetch(`/api/admin/drops/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setError(data?.error || "Не удалось обновить дроп");
      return;
    }
    setMessage("Дроп обновлен");
    loadData();
  };

  const createPromo = async () => {
    setError("");
    setMessage("");
    setGeneratedPromo(null);
    try {
      const res = await fetch("/api/admin/promos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: promoForm.id,
          code: promoForm.id,
          title: promoForm.title,
          points: promoForm.points,
          itemSlug: promoForm.itemSlug,
          quantity: promoForm.quantity,
          expiresDays: promoForm.expiresDays,
          note: promoForm.note,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Could not create promo");
      setGeneratedPromo(data.promo);
      setMessage("Promo code/link created");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create promo");
    }
  };

  const copyPromoText = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(`${label} copied`);
    } catch {
      setError(`Could not copy ${label.toLowerCase()}`);
    }
  };

  return (
    <main className={styles.container}>
      <header className={styles.header}>
        <span>Sea Battle</span>
        <h1>Админка</h1>
        <p>{adminAddress ? `Вход: ${shortWallet(adminAddress)}` : "Креаторы, рефералы и дропы"}</p>
      </header>

      {!authenticated ? (
        <section className={styles.loginCard}>
          <h2>Вход кошельком</h2>
          <p>Подключи админ-кошелек и подпиши сообщение. Газ не нужен.</p>
          {!isConnected ? (
            <div className={styles.connectorList}>
              {connectors.map((connector) => (
                <button
                  key={connector.id}
                  onClick={() => connect({ connector })}
                  disabled={connectPending}
                  type="button"
                >
                  {connector.name}
                </button>
              ))}
            </div>
          ) : (
            <button className={styles.primaryBtn} onClick={login} disabled={signing} type="button">
              {signing ? "Подписываем..." : "Войти в админку"}
            </button>
          )}
          {error && <p className={styles.error}>{error}</p>}
        </section>
      ) : (
        <>
          <section className={styles.statsGrid}>
            <Stat label="Ждут проверки" value={pendingSubmissions} />
            <Stat label="Креаторы" value={creators.length} />
            <Stat label="Награды" value={rewards.length} />
            <Stat label="Дропы" value={drops.length} />
          </section>

          <nav className={styles.tabs}>
            {(["submissions", "creators", "drops", "promos"] as Tab[]).map((entry) => (
              <button
                key={entry}
                className={tab === entry ? styles.activeTab : ""}
                onClick={() => setTab(entry)}
                type="button"
              >
                {TAB_LABEL[entry]}
              </button>
            ))}
          </nav>

          {message && <p className={styles.success}>{message}</p>}
          {error && <p className={styles.error}>{error}</p>}
          {loading && <p className={styles.loading}>Загрузка...</p>}

          {tab === "submissions" && (
            <section className={styles.panel}>
              <h2>Работы креаторов</h2>
              <div className={styles.table}>
                {submissions.map((submission) => (
                  <article key={submission.id} className={styles.submissionRow}>
                    <div>
                      <b>{shortWallet(submission.wallet)}</b>
                      <a href={submission.url} target="_blank" rel="noreferrer">
                        {submission.url}
                      </a>
                      <small>{new Date(submission.created_at).toLocaleString("ru-RU")}</small>
                      {submission.admin_note && <small>Причина/заметка: {submission.admin_note}</small>}
                    </div>
                    <span className={styles.status}>{statusLabel(submission.status)}</span>
                    <div className={styles.actions}>
                      <button onClick={() => updateSubmission(submission.id, "approved")} type="button">
                        Одобрить
                      </button>
                      <button
                        onClick={() => {
                          setRejectTarget(submission);
                          setRejectReason(submission.admin_note ?? "");
                        }}
                        type="button"
                      >
                        Отклонить
                      </button>
                      <button
                        onClick={() => {
                          setRewardTarget({ wallet: submission.wallet, submissionId: submission.id });
                          setRewardMode("game");
                        }}
                        type="button"
                      >
                        Наградить
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}

          {tab === "creators" && (
            <section className={styles.panel}>
              <h2>Статы креаторов</h2>
              <div className={styles.gridTable}>
                <b>Кошелек</b>
                <b>Рефы</b>
                <b>Активные</b>
                <b>Игры рефов</b>
                <b>Победы</b>
                <b>Транзы</b>
                <b>Очки</b>
                <b>Действие</b>
                {creators.map((creator) => (
                  <Row key={creator.wallet}>
                    <span>{shortWallet(creator.wallet)}</span>
                    <span>{creator.referrals}</span>
                    <span>{creator.activeReferrals}</span>
                    <span>{creator.referralGames}</span>
                    <span>{creator.referralWins}</span>
                    <span>{creator.referralTxs}</span>
                    <span>{creator.points.toLocaleString()}</span>
                    <button
                      className={styles.inlineBtn}
                      onClick={() => {
                        setRewardTarget({ wallet: creator.wallet });
                        setRewardMode("game");
                      }}
                      type="button"
                    >
                      Наградить
                    </button>
                  </Row>
                ))}
              </div>
            </section>
          )}

          {tab === "drops" && (
            <section className={styles.panel}>
              <h2>Дроп по лидерборду</h2>
              <div className={styles.compactForm}>
                <label>
                  <span>ID дропа</span>
                  <input value={dropForm.id} onChange={(e) => setDropForm({ ...dropForm, id: e.target.value })} placeholder="season-1" />
                </label>
                <label>
                  <span>Название</span>
                  <input value={dropForm.title} onChange={(e) => setDropForm({ ...dropForm, title: e.target.value })} placeholder="Season 1 Drop" />
                </label>
                <label>
                  <span>Токен</span>
                  <input value={dropForm.tokenAddress} onChange={(e) => setDropForm({ ...dropForm, tokenAddress: e.target.value })} placeholder="0x..." />
                </label>
                <label>
                  <span>Тикер токена</span>
                  <input value={dropForm.tokenSymbol} onChange={(e) => setDropForm({ ...dropForm, tokenSymbol: e.target.value })} placeholder="USDC / BASE" />
                </label>
                <label>
                  <span>Десятичные</span>
                  <input value={dropForm.decimals} onChange={(e) => setDropForm({ ...dropForm, decimals: e.target.value })} placeholder="18" />
                </label>
                <label>
                  <span>Сколько всего раздать</span>
                  <input value={dropForm.totalAmount} onChange={(e) => setDropForm({ ...dropForm, totalAmount: e.target.value })} placeholder="1000000" />
                </label>
              </div>
              <button className={styles.primaryBtn} onClick={createDropSnapshot} type="button">
                Посчитать и создать snapshot
              </button>

              <div className={styles.dropList}>
                {drops.map((drop) => (
                  <article key={drop.id} className={styles.dropRow}>
                    <div>
                      <b>{drop.title}</b>
                      <small>{drop.id} / {drop.token_symbol}</small>
                    </div>
                    <span>{statusLabel(drop.status)}</span>
                    <span>{drop.allocations ?? 0} кошельков</span>
                    <span>{drop.claimed ?? 0} claimed</span>
                    <div className={styles.actions}>
                      <button onClick={() => updateDrop(drop.id, "active")} type="button">Включить</button>
                      <button onClick={() => updateDrop(drop.id, "closed")} type="button">Закрыть</button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}

          {tab === "promos" && (
            <section className={styles.panel}>
              <h2>Promo codes / links</h2>
              <p className={styles.modalHint}>
                Pick your own code. One wallet can redeem the same code only once.
              </p>
              <div className={styles.compactForm}>
                <label>
                  <span>Code</span>
                  <input
                    value={promoForm.id}
                    onChange={(e) => setPromoForm({ ...promoForm, id: e.target.value })}
                    placeholder="SEA100"
                  />
                </label>
                <label>
                  <span>Title</span>
                  <input
                    value={promoForm.title}
                    onChange={(e) => setPromoForm({ ...promoForm, title: e.target.value })}
                    placeholder="Creator bonus"
                  />
                </label>
                <label>
                  <span>Points</span>
                  <input
                    type="number"
                    min={0}
                    value={promoForm.points}
                    onChange={(e) => setPromoForm({ ...promoForm, points: e.target.value })}
                    placeholder="1000"
                  />
                </label>
                <label>
                  <span>Item</span>
                  <select
                    value={promoForm.itemSlug}
                    onChange={(e) => setPromoForm({ ...promoForm, itemSlug: e.target.value })}
                  >
                    {ITEM_OPTIONS.map((item) => (
                      <option key={item.slug || "none"} value={item.slug}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Quantity</span>
                  <input
                    type="number"
                    min={1}
                    value={promoForm.quantity}
                    onChange={(e) => setPromoForm({ ...promoForm, quantity: e.target.value })}
                    placeholder="1"
                    disabled={!promoForm.itemSlug}
                  />
                </label>
                <label>
                  <span>Expires in days</span>
                  <input
                    type="number"
                    min={0}
                    max={365}
                    value={promoForm.expiresDays}
                    onChange={(e) => setPromoForm({ ...promoForm, expiresDays: e.target.value })}
                    placeholder="30"
                  />
                </label>
                <label className={styles.fullField}>
                  <span>Note</span>
                  <textarea
                    value={promoForm.note}
                    onChange={(e) => setPromoForm({ ...promoForm, note: e.target.value })}
                    placeholder="Optional internal note"
                  />
                </label>
              </div>
              <button className={styles.primaryBtn} onClick={createPromo} type="button">
                Create promo code/link
              </button>

              {generatedPromo && (
                <div className={styles.promoOutput}>
                  <b>{generatedPromo.title}</b>
                  <small>
                    {generatedPromo.points > 0 ? `+${generatedPromo.points.toLocaleString()} pts` : "No points"}
                    {generatedPromo.itemSlug && generatedPromo.quantity > 0
                      ? ` / ${generatedPromo.quantity}x ${generatedPromo.itemLabel || generatedPromo.itemSlug}`
                      : ""}
                    {generatedPromo.expiresAt
                      ? ` / expires ${new Date(generatedPromo.expiresAt).toLocaleString()}`
                      : " / no expiry"}
                  </small>
                  <label>
                    <span>Code</span>
                    <textarea
                      readOnly
                      value={generatedPromo.code}
                      onFocus={(e) => e.currentTarget.select()}
                    />
                  </label>
                  <button
                    className={styles.inlineBtn}
                    onClick={() => copyPromoText(generatedPromo.code, "Code")}
                    type="button"
                  >
                    Copy code
                  </button>
                  <label>
                    <span>Short link</span>
                    <textarea
                      readOnly
                      value={generatedPromo.link}
                      onFocus={(e) => e.currentTarget.select()}
                    />
                  </label>
                  <button
                    className={styles.inlineBtn}
                    onClick={() => copyPromoText(generatedPromo.link, "Link")}
                    type="button"
                  >
                    Copy link
                  </button>
                  <label>
                    <span>Base App link</span>
                    <textarea
                      readOnly
                      value={generatedPromo.baseAppLink}
                      onFocus={(e) => e.currentTarget.select()}
                    />
                  </label>
                  <button
                    className={styles.inlineBtn}
                    onClick={() => copyPromoText(generatedPromo.baseAppLink, "Base App link")}
                    type="button"
                  >
                    Copy Base App link
                  </button>
                </div>
              )}
            </section>
          )}
        </>
      )}

      {rejectTarget && (
        <Modal title="Причина отказа" onClose={() => setRejectTarget(null)}>
          <p className={styles.modalHint}>{shortWallet(rejectTarget.wallet)}</p>
          <textarea
            value={rejectReason}
            onChange={(event) => setRejectReason(event.target.value)}
            placeholder="Напиши, почему работа отклонена"
          />
          <div className={styles.modalActions}>
            <button onClick={() => setRejectTarget(null)} type="button">Отмена</button>
            <button className={styles.dangerBtn} onClick={rejectSubmission} type="button">Отклонить</button>
          </div>
        </Modal>
      )}

      {rewardTarget && (
        <Modal title="Выдать награду" onClose={() => setRewardTarget(null)}>
          <p className={styles.modalHint}>{shortWallet(rewardTarget.wallet)}</p>
          <div className={styles.segment}>
            <button
              className={rewardMode === "game" ? styles.segmentActive : ""}
              onClick={() => setRewardMode("game")}
              type="button"
            >
              Айтемы + поинты
            </button>
            <button
              className={rewardMode === "token" ? styles.segmentActive : ""}
              onClick={() => setRewardMode("token")}
              type="button"
            >
              Токены
            </button>
          </div>

          {rewardMode === "game" ? (
            <div className={styles.compactForm}>
              <label>
                <span>Поинты</span>
                <input value={gameReward.points} onChange={(e) => setGameReward({ ...gameReward, points: e.target.value })} placeholder="1000" />
              </label>
              <label>
                <span>Предмет</span>
                <select value={gameReward.itemSlug} onChange={(e) => setGameReward({ ...gameReward, itemSlug: e.target.value })}>
                  {ITEM_OPTIONS.map((item) => (
                    <option key={item.slug || "none"} value={item.slug}>{item.label}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Количество</span>
                <input value={gameReward.quantity} onChange={(e) => setGameReward({ ...gameReward, quantity: e.target.value })} placeholder="1" />
              </label>
              <label className={styles.fullField}>
                <span>Сообщение пользователю</span>
                <input value={gameReward.note} onChange={(e) => setGameReward({ ...gameReward, note: e.target.value })} placeholder="Например: Спасибо за TikTok ролик!" />
              </label>
            </div>
          ) : (
            <div className={styles.compactForm}>
              <label>
                <span>Что отправить</span>
                <select value={tokenReward.kind} onChange={(e) => setTokenReward({ ...tokenReward, kind: e.target.value as TokenKind })}>
                  <option value="usdc">USDC</option>
                  <option value="base">BASE</option>
                  <option value="token">Другой токен</option>
                </select>
              </label>
              <label>
                <span>Сумма</span>
                <input value={tokenReward.amount} onChange={(e) => setTokenReward({ ...tokenReward, amount: e.target.value })} placeholder="25" />
              </label>
              {tokenReward.kind === "token" && (
                <label className={styles.fullField}>
                  <span>Адрес токена</span>
                  <input value={tokenReward.tokenAddress} onChange={(e) => setTokenReward({ ...tokenReward, tokenAddress: e.target.value })} placeholder="0x..." />
                </label>
              )}
              <label className={styles.fullField}>
                <span>Сообщение пользователю</span>
                <input value={tokenReward.note} onChange={(e) => setTokenReward({ ...tokenReward, note: e.target.value })} placeholder="Например: Спасибо за твою работу!" />
              </label>
            </div>
          )}

          <div className={styles.modalActions}>
            <button onClick={() => setRewardTarget(null)} type="button">Отмена</button>
            <button className={styles.primaryBtn} onClick={grantReward} disabled={rewardBusy} type="button">
              {rewardBusy ? "Сохраняем..." : "Выдать"}
            </button>
          </div>
        </Modal>
      )}
    </main>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className={styles.modalBackdrop}>
      <section className={styles.modal}>
        <header className={styles.modalHeader}>
          <h2>{title}</h2>
          <button onClick={onClose} type="button">Закрыть</button>
        </header>
        {children}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className={styles.stat}>
      <span>{label}</span>
      <b>{value.toLocaleString()}</b>
    </div>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

function shortWallet(wallet: string) {
  if (!wallet) return "-";
  return `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    pending: "На проверке",
    approved: "Одобрено",
    rejected: "Отклонено",
    rewarded: "Награждено",
    planned: "Запланировано",
    granted: "Выдано",
    claimable: "Можно клеймить",
    paid: "Оплачено",
    draft: "Черновик",
    active: "Активен",
    closed: "Закрыт",
    cancelled: "Отменен",
  };
  return labels[status] ?? status;
}

function parseDecimalToRaw(value: string, decimals: number) {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(normalized)) return BigInt(0);
  const [whole, fraction = ""] = normalized.split(".");
  const padded = fraction.padEnd(decimals, "0").slice(0, decimals);
  return BigInt(whole || "0") * (BigInt(10) ** BigInt(decimals)) + BigInt(padded || "0");
}
