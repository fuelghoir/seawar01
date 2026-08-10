import Link from "next/link";
import stats from "./grant-stats.json";
import styles from "./page.module.css";
import {
  CAPTAIN_SBT_CONTRACT_ADDRESS,
  SEABATTLE_CONTRACT_ADDRESS,
  USDC_ADDRESS,
} from "../contracts/seaBattleAbi";
import { CHALLENGE_CONTRACT_ADDRESS } from "../contracts/challengeAbi";
import { DROP_CLAIM_CONTRACT_ADDRESS } from "../contracts/dropClaimAbi";
import { FLEET_NFT_CONTRACT_ADDRESS } from "../contracts/fleetPassAbi";
import { FLEET_MINER_SLOTS_CONTRACT_ADDRESS } from "../contracts/fleetMinerSlotsAbi";

type MonthlyPoint = (typeof stats.acquisition.monthly)[number];

const BASESCAN_CONTRACT = `https://basescan.org/address/${stats.project.primaryContract}`;
const BASE_GRANT_GUIDE = "https://docs.base.org/get-started/get-funded";

const CONTRACTS = [
  { name: "Sea Battle v7", role: "Core matches + wagers", address: SEABATTLE_CONTRACT_ADDRESS },
  { name: "Challenge", role: "Async player challenges", address: CHALLENGE_CONTRACT_ADDRESS },
  { name: "Fleet Pass", role: "Fleet NFT utility", address: FLEET_NFT_CONTRACT_ADDRESS },
  { name: "Fleet Miner", role: "Mining slots + rewards", address: FLEET_MINER_SLOTS_CONTRACT_ADDRESS },
  { name: "Captain SBT", role: "Onchain captain identity", address: CAPTAIN_SBT_CONTRACT_ADDRESS },
  { name: "Drop Claim", role: "Season reward claims", address: DROP_CLAIM_CONTRACT_ADDRESS },
  { name: "USDC", role: "Base settlement asset", address: USDC_ADDRESS },
] as const;

function formatNumber(value: number, maximumFractionDigits = 0) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(value);
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

function monthLabel(month: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${month}-01T00:00:00Z`));
}

function modeLabel(mode: string) {
  return {
    bot: "Solo vs AI",
    free: "Friend PvP",
    wager: "USDC wager",
    hybrid: "Legacy hybrid",
  }[mode] ?? mode;
}

function GrowthChart({ points, latestIsMonthToDate }: { points: readonly MonthlyPoint[]; latestIsMonthToDate: boolean }) {
  const width = 760;
  const height = 230;
  const insetX = 54;
  const insetY = 32;
  const plotWidth = width - insetX * 2;
  const plotHeight = height - insetY * 2;
  const maxValue = Math.max(1, ...points.map((point) => point.activeWallets));
  const coordinates = points.map((point, index) => {
    const x = insetX + (index / Math.max(1, points.length - 1)) * plotWidth;
    const y = insetY + plotHeight - (point.activeWallets / maxValue) * plotHeight;
    return { x, y, point };
  });
  const path = coordinates.map(({ x, y }, index) => `${index ? "L" : "M"} ${x} ${y}`).join(" ");
  const areaPath = coordinates.length
    ? `${path} L ${coordinates.at(-1)?.x} ${height - insetY} L ${coordinates[0].x} ${height - insetY} Z`
    : "";
  const latest = points.at(-1);
  const first = points[0];
  const rangeLabel = first && latest
    ? `${monthLabel(first.month)} through ${monthLabel(latest.month)} 2026`
    : "the tracked period";
  const latestLabel = latest ? `${monthLabel(latest.month)}${latestIsMonthToDate ? " MTD" : ""}` : "Latest";

  return (
    <div className={styles.chartShell}>
      <svg
        className={styles.growthChart}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Tracked monthly active wallets from ${rangeLabel}`}
      >
        <defs>
          <linearGradient id="growth-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#00d7ff" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#00d7ff" stopOpacity="0" />
          </linearGradient>
          <filter id="growth-glow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {[0, 0.5, 1].map((ratio) => (
          <line
            key={ratio}
            x1={insetX}
            x2={width - insetX}
            y1={insetY + plotHeight * ratio}
            y2={insetY + plotHeight * ratio}
            className={styles.chartGridLine}
          />
        ))}
        <path d={areaPath} fill="url(#growth-fill)" />
        <path d={path} className={styles.growthLine} filter="url(#growth-glow)" />
        {coordinates.map(({ x, y, point }) => (
          <g key={point.month}>
            <circle cx={x} cy={y} r="5" className={styles.chartDot} />
            <text x={x} y={y - 17} textAnchor="middle" className={styles.chartValue}>
              {point.activeWallets}
            </text>
            <text
              x={x}
              y={height - 7}
              textAnchor="middle"
              className={styles.chartMonth}
            >
              {monthLabel(point.month)}
            </text>
          </g>
        ))}
      </svg>
      <div className={styles.chartLegend}>
        <span><i className={styles.legendTracked} />Tracked activity</span>
        <span><i className={styles.legendCore} />Core actions: {stats.headline.latestCoreMau}</span>
        <span>
          <i className={styles.legendPlayers} />
          {latestLabel}: {formatNumber(latest?.games ?? 0)} games · {latest?.gamePlayers ?? 0} unique player wallets
        </span>
        {latestIsMonthToDate && <span>* current month to date</span>}
      </div>
    </div>
  );
}

function Metric({
  value,
  label,
  detail,
  tone = "cyan",
}: {
  value: string;
  label: string;
  detail: string;
  tone?: "cyan" | "aqua" | "coral" | "violet";
}) {
  return (
    <article className={`${styles.metric} ${styles[`metric_${tone}`]}`}>
      <span className={styles.metricValue}>{value}</span>
      <strong>{label}</strong>
      <p>{detail}</p>
    </article>
  );
}

function SectionTitle({
  index,
  eyebrow,
  title,
  copy,
}: {
  index: string;
  eyebrow: string;
  title: string;
  copy: string;
}) {
  return (
    <header className={styles.sectionTitle}>
      <span className={styles.sectionIndex}>{index}</span>
      <div>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h2>{title}</h2>
        <p className={styles.sectionCopy}>{copy}</p>
      </div>
    </header>
  );
}

function Donut({
  value,
  label,
  detail,
}: {
  value: number;
  label: string;
  detail: string;
}) {
  return (
    <div className={styles.donutCard}>
      <div
        className={styles.donut}
        style={{ "--donut-value": `${value * 3.6}deg` } as React.CSSProperties}
        role="img"
        aria-label={`${label}: ${value}%`}
      >
        <span>{value}%</span>
      </div>
      <div>
        <strong>{label}</strong>
        <p>{detail}</p>
      </div>
    </div>
  );
}

export default function StatsPage() {
  const modes = Object.entries(stats.gameplay.byMode);
  const maxMode = Math.max(...modes.map(([, value]) => value));
  const latest = stats.acquisition.monthly.at(-1);
  const previous = stats.acquisition.monthly.at(-2);
  const generatedMonth = stats.project.generatedAt.slice(0, 7);
  const latestIsMonthToDate = latest?.month === generatedMonth;
  const latestMonthLabel = latest ? monthLabel(latest.month).toUpperCase() : "LATEST";
  const previousMonthLabel = previous ? monthLabel(previous.month).toUpperCase() : "PREVIOUS";
  const latestPeriodLabel = `${latestMonthLabel}${latestIsMonthToDate ? " MTD" : ""}`;
  const growthLabel = latestIsMonthToDate || stats.headline.latestMauGrowthPct === null
    ? `${formatNumber(latest?.activeWallets ?? 0)} ${latestPeriodLabel}`
    : `${stats.headline.latestMauGrowthPct > 0 ? "+" : ""}${stats.headline.latestMauGrowthPct}% MoM`;

  return (
    <main className={styles.page}>
      <nav className={styles.nav} aria-label="Primary navigation">
        <Link href="/" className={styles.brand}>
          <span className={styles.brandMark}>SB</span>
          <span>
            <strong>SEA BATTLE</strong>
            <small>IMPACT CONSOLE</small>
          </span>
        </Link>
        <div className={styles.navStatus}>
          <span className={styles.liveDot} />
          Daily production snapshot
          <b>{formatDate(stats.project.coverageEnd)}</b>
        </div>
        <div className={styles.navLinks}>
          <a href="#methodology">Methodology</a>
          <a href={BASESCAN_CONTRACT} target="_blank" rel="noreferrer">BaseScan ↗</a>
          <Link href="/play" className={styles.navCta}>Open game</Link>
        </div>
      </nav>

      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>BASE MAINNET · SHIPPED PRODUCT · LIVE TELEMETRY</p>
          <h1>
            Naval strategy with
            <span>proof of play.</span>
          </h1>
          <p className={styles.heroLead}>
            Sea Battle turns a familiar game into a repeatable onchain loop:
            play, compete, collect, return. This is the production record behind it.
          </p>
          <div className={styles.heroActions}>
            <a href="#traction" className={styles.primaryButton}>Read the evidence</a>
            <a href={BASE_GRANT_GUIDE} target="_blank" rel="noreferrer" className={styles.secondaryButton}>
              Base grant criteria ↗
            </a>
          </div>
        </div>

        <div className={styles.sonarCard} aria-label="Sea Battle growth summary">
          <div className={styles.sonarTop}>
            <span>ACTIVITY SIGNAL</span>
            <b>{growthLabel}</b>
          </div>
          <div className={styles.sonarField}>
            <span className={styles.sonarSweep} />
            <span className={styles.sonarRing} />
            <span className={`${styles.sonarPing} ${styles.pingOne}`} />
            <span className={`${styles.sonarPing} ${styles.pingTwo}`} />
            <span className={`${styles.sonarPing} ${styles.pingThree}`} />
            <div className={styles.sonarNumber}>
              <strong>{stats.headline.latestMau}</strong>
              <span>TRACKED MAU</span>
            </div>
          </div>
          <div className={styles.sonarBottom}>
            <span>{monthLabel(stats.acquisition.monthly[0].month).toUpperCase()} {stats.acquisition.monthly[0].activeWallets}</span>
            <i />
            <span>{latestPeriodLabel} {stats.headline.latestMau}</span>
          </div>
        </div>
      </section>

      <section id="traction" className={styles.metricGrid}>
        <Metric
          value={formatNumber(stats.headline.uniqueHumanWallets)}
          label="Human wallets"
          detail="Unique production wallets, system addresses excluded."
        />
        <Metric
          value={formatNumber(stats.headline.totalGames)}
          label="Battles created"
          detail={`${formatNumber(stats.headline.finishedGames)} finished across solo, PvP, and wager play.`}
          tone="violet"
        />
        <Metric
          value={formatNumber(stats.headline.totalShots)}
          label="Shots recorded"
          detail={`${stats.gameplay.hitRatePct}% hit rate · ${stats.gameplay.shotsPerGame} shots per battle.`}
          tone="coral"
        />
        <Metric
          value={`${stats.headline.completionRatePct}%`}
          label="Battle completion"
          detail="Finished games as a share of all production game records."
          tone="aqua"
        />
      </section>

      <section className={styles.section}>
        <SectionTitle
          index="01"
          eyebrow="ADOPTION"
          title="Monthly activity, updated every day."
          copy="Tracked activity and direct gameplay are shown separately. The current month is marked MTD so a partial period is never presented as month-over-month decline."
        />
        <div className={styles.growthLayout}>
          <GrowthChart points={stats.acquisition.monthly} latestIsMonthToDate={latestIsMonthToDate} />
          <aside className={styles.growthNotes}>
            <div>
              <span>{latestPeriodLabel} TRACKED WALLETS</span>
              <strong>{stats.acquisition.latestMau}</strong>
              <small>all attributable product events</small>
            </div>
            <div>
              <span>CORE-ACTION MAU</span>
              <strong>{stats.acquisition.latestCoreMau}</strong>
              <small>game, economy, quest, social, creator</small>
            </div>
            <div>
              <span>{latestPeriodLabel} GAMES</span>
              <strong>{formatNumber(latest?.games ?? 0)}</strong>
              <small>{latest?.gamePlayers} unique player wallets</small>
            </div>
            <div>
              <span>{previousMonthLabel} → {latestPeriodLabel} RETURN</span>
              <strong>{latest?.monthToMonthRetentionPct}%</strong>
              <small>{latest?.retainedFromPreviousMonth} of {previous?.activeWallets} prior-month wallets</small>
            </div>
          </aside>
        </div>
        <div className={styles.monthTableWrap}>
          <table className={styles.monthTable}>
            <thead>
              <tr>
                <th>Month</th>
                <th>New wallets</th>
                <th>Tracked MAU</th>
                <th>Core MAU</th>
                <th>Unique player wallets</th>
                <th>Games</th>
                <th>Completion</th>
              </tr>
            </thead>
            <tbody>
              {stats.acquisition.monthly.map((point) => (
                <tr key={point.month}>
                  <td>{monthLabel(point.month)} ’26</td>
                  <td>+{point.newWallets}</td>
                  <td>{point.activeWallets}</td>
                  <td>{point.coreActiveWallets}</td>
                  <td>{point.gamePlayers}</td>
                  <td>{formatNumber(point.games)}</td>
                  <td>{point.completionRatePct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={`${styles.section} ${styles.telemetrySection}`}>
        <SectionTitle
          index="02"
          eyebrow="GAMEPLAY DEPTH"
          title="A real game loop, not a wallet connect."
          copy="Players generate tactical sessions with enough depth to support progression, competitive modes, inventory, and a sustainable content cadence."
        />
        <div className={styles.telemetryGrid}>
          <Donut
            value={stats.gameplay.completionRatePct}
            label="Completion rate"
            detail={`${formatNumber(stats.gameplay.states.finished)} finished · ${stats.gameplay.states.cancelled} cancelled`}
          />
          <Donut
            value={stats.gameplay.hitRatePct}
            label="Shot accuracy"
            detail={`${formatNumber(stats.gameplay.hits)} hits · ${formatNumber(stats.gameplay.misses)} misses`}
          />
          <div className={styles.modeCard}>
            <div className={styles.cardHeading}>
              <span>BATTLES BY MODE</span>
              <b>{formatNumber(stats.gameplay.totalGames)} TOTAL</b>
            </div>
            <div className={styles.modeBars}>
              {modes.map(([mode, value]) => (
                <div className={styles.modeRow} key={mode}>
                  <span>{modeLabel(mode)}</span>
                  <div><i style={{ width: `${(value / maxMode) * 100}%` }} /></div>
                  <strong>{formatNumber(value)}</strong>
                </div>
              ))}
            </div>
          </div>
          <article className={styles.sessionCard}>
            <span className={styles.cardKicker}>SESSION DENSITY</span>
            <strong>{stats.gameplay.shotsPerFinishedGame}</strong>
            <h3>shots per finished battle</h3>
            <p>
              {formatNumber(stats.gameplay.totalShots)} tactical decisions recorded across
              {" "}{formatNumber(stats.gameplay.totalGames)} battles.
            </p>
          </article>
        </div>
      </section>

      <section className={styles.section}>
        <SectionTitle
          index="03"
          eyebrow="ONCHAIN ECONOMY"
          title="Base is part of the product, not a badge."
          copy="USDC wagers, sponsored contract calls, collectibles, seasonal progression, and inventory connect play to durable onchain ownership."
        />
        <div className={styles.economyGrid}>
          <article className={`${styles.economyCard} ${styles.economyLead}`}>
            <span className={styles.cardKicker}>USDC WAGER VOLUME</span>
            <strong>${formatNumber(stats.economy.representedStakeVolumeUsdc, 2)}</strong>
            <p>Player stakes represented by production wager rooms.</p>
            <div className={styles.economySplit}>
              <span><b>{stats.economy.wagerGames}</b> wager games</span>
              <span><b>{stats.economy.uniqueWagerPlayers}</b> wager players</span>
              <span><b>${stats.economy.completedWagerVolumeUsdc}</b> completed volume</span>
            </div>
          </article>
          <article className={styles.economyCard}>
            <span className={styles.cardKicker}>FLEET NFT UTILITY</span>
            <strong>{formatNumber(stats.seasonAndCollectibles.fleetNftClaims)}</strong>
            <p>Fleet point claims by {stats.seasonAndCollectibles.uniqueFleetClaimers} unique wallets.</p>
            <small>{formatNumber(stats.seasonAndCollectibles.fleetPointsClaimed)} points claimed</small>
          </article>
          <article className={styles.economyCard}>
            <span className={styles.cardKicker}>SEASON PROGRESSION</span>
            <strong>{formatNumber(stats.seasonAndCollectibles.seasonPoints)}</strong>
            <p>Season points across {stats.seasonAndCollectibles.uniqueSeasonParticipants} participants.</p>
            <small>{Object.keys(stats.seasonAndCollectibles.seasons).length} seasons tracked</small>
          </article>
          <article className={styles.economyCard}>
            <span className={styles.cardKicker}>PLAYER INVENTORY</span>
            <strong>{formatNumber(stats.economy.itemsInInventories)}</strong>
            <p>Tactical items held by {stats.economy.inventoryOwners} wallet inventories.</p>
            <small>{Object.keys(stats.economy.inventoryByItem).length} utility item types</small>
          </article>
        </div>
        <div className={styles.contractBand}>
          <span className={styles.baseGlyph}>BASE</span>
          <div>
            <small>PRIMARY GAME CONTRACT · BASE MAINNET</small>
            <code>{stats.project.primaryContract}</code>
          </div>
          <a href={BASESCAN_CONTRACT} target="_blank" rel="noreferrer">Verify on BaseScan ↗</a>
        </div>
      </section>

      <section className={styles.section}>
        <SectionTitle
          index="04"
          eyebrow="COMMUNITY LOOP"
          title="Players create the distribution layer."
          copy="Quests, sharing, referrals, and creator rewards turn play sessions into community content and repeat acquisition."
        />
        <div className={styles.communityGrid}>
          <Metric
            value={formatNumber(stats.community.externalQuestClaims)}
            label="Quest claims"
            detail={`${stats.community.uniqueQuesters} unique questing wallets.`}
          />
          <Metric
            value={formatNumber(stats.community.socialShareRewards)}
            label="Rewarded shares"
            detail={`${stats.community.uniqueSharers} wallets created attributed social posts.`}
            tone="violet"
          />
          <Metric
            value={formatNumber(stats.community.creatorSubmissions)}
            label="Creator submissions"
            detail={`${stats.community.creatorSubmissionStatuses.rewarded} already rewarded.`}
            tone="coral"
          />
          <Metric
            value={formatNumber(stats.community.creatorRewards)}
            label="Creator rewards"
            detail={`${stats.community.uniqueCreatorsRewarded} creators reached the reward ledger.`}
            tone="aqua"
          />
        </div>
      </section>

      <section className={`${styles.section} ${styles.grantSection}`}>
        <div className={styles.grantStatement}>
          <p className={styles.eyebrow}>5 ETH BUILDER GRANT · NEXT 90 DAYS</p>
          <h2>Scale the loop that is already working.</h2>
          <p>
            The grant funds measurable product improvements: faster onboarding,
            verifiable onchain attribution, more competitive formats, and public analytics.
          </p>
        </div>
        <div className={styles.milestones}>
          <article>
            <span>01 · DISTRIBUTION</span>
            <strong>500 MAU</strong>
            <p>Base App growth loops, referral experiments, and creator campaigns.</p>
          </article>
          <article>
            <span>02 · ONCHAIN DEPTH</span>
            <strong>150 wager games</strong>
            <p>Safer matchmaking, clearer settlement UX, and Builder Code attribution.</p>
          </article>
          <article>
            <span>03 · RETENTION</span>
            <strong>35% repeat play</strong>
            <p>Season missions, asynchronous challenges, and re-engagement notifications.</p>
          </article>
          <article>
            <span>04 · TRANSPARENCY</span>
            <strong>Public dashboard</strong>
            <p>Monthly auditable reporting with metric definitions and BaseScan links.</p>
          </article>
        </div>
      </section>

      <section className={`${styles.section} ${styles.registrySection}`}>
        <SectionTitle
          index="05"
          eyebrow="VERIFIABLE INFRASTRUCTURE"
          title="Every live contract, in one registry."
          copy="The production surface is split by responsibility. Each address below opens directly on BaseScan for independent verification."
        />
        <div className={styles.contractRegistry}>
          {CONTRACTS.map((contract) => (
            <a
              key={contract.address}
              className={styles.contractCard}
              href={`https://basescan.org/address/${contract.address}`}
              target="_blank"
              rel="noreferrer"
              aria-label={`Verify ${contract.name} on BaseScan`}
            >
              <span>{contract.role}</span>
              <strong>{contract.name}</strong>
              <code>{contract.address}</code>
              <small>BASE MAINNET <b>VERIFY ↗</b></small>
            </a>
          ))}
        </div>
      </section>

      <section id="methodology" className={`${styles.section} ${styles.methodSection}`}>
        <SectionTitle
          index="06"
          eyebrow="AUDIT NOTES"
          title="Every number has a definition."
          copy="The dashboard is generated from a read-only production export. It does not expose full wallet addresses, credentials, or player-level private data."
        />
        <div className={styles.methodGrid}>
          <div>
            <span>DATA WINDOW</span>
            <strong>{formatDate(stats.project.coverageStart)} — {formatDate(stats.project.coverageEnd)}</strong>
          </div>
          <div>
            <span>GENERATED</span>
            <strong>{formatDate(stats.project.generatedAt)}</strong>
          </div>
          <div>
            <span>IDENTITY RULE</span>
            <strong>Zero address + internal bot excluded</strong>
          </div>
        </div>
        <p className={styles.methodCopy}>{stats.project.methodology}</p>

        <details className={styles.sourceDetails}>
          <summary>View all production source counters</summary>
          <div className={styles.sourceGrid}>
            {Object.entries(stats.sourceRows).map(([table, count]) => (
              <div key={table}>
                <code>{table}</code>
                <strong>{formatNumber(count)}</strong>
              </div>
            ))}
          </div>
        </details>
      </section>

      <footer className={styles.footer}>
        <div>
          <span className={styles.brandMark}>SB</span>
          <p><strong>SEA BATTLE</strong><br />Proof of play on Base.</p>
        </div>
        <div className={styles.footerLinks}>
          <Link href="/">Home</Link>
          <Link href="/leaderboard">Leaderboard</Link>
          <a href={BASESCAN_CONTRACT} target="_blank" rel="noreferrer">Contract</a>
          <a href="https://t.me/+xWV1zyGwNOM1ZTFi" target="_blank" rel="noreferrer">Community</a>
        </div>
      </footer>
    </main>
  );
}
