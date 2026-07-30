import fs from "node:fs";
import path from "node:path";
import PptxGenJS from "pptxgenjs";

const root = path.resolve(import.meta.dirname, "..");
const outDir = path.join(root, "deliverables");
const shotsDir = path.join(outDir, "screenshots");
const stats = JSON.parse(
  fs.readFileSync(path.join(root, "app", "stats", "grant-stats.json"), "utf8")
);

fs.mkdirSync(outDir, { recursive: true });

const pptx = new PptxGenJS();
pptx.layout = "LAYOUT_WIDE";
pptx.author = "Sea Battle";
pptx.company = "Sea Battle";
pptx.subject = "Base Builder Grant application";
pptx.title = "Sea Battle — Base Builder Grant";
pptx.lang = "en-US";
pptx.theme = {
  headFontFace: "Aptos Display",
  bodyFontFace: "Aptos",
  lang: "en-US",
};
pptx.defineSlideMaster({
  title: "NAVAL",
  background: { color: "020712" },
  objects: [
    {
      rect: {
        x: 0,
        y: 0,
        w: 13.333,
        h: 0.06,
        fill: { color: "00D7FF" },
        line: { color: "00D7FF", transparency: 100 },
      },
    },
    {
      text: {
        text: "SEA BATTLE · BASE MAINNET",
        options: {
          x: 0.45,
          y: 0.18,
          w: 3.3,
          h: 0.22,
          fontFace: "Consolas",
          fontSize: 7.5,
          bold: true,
          color: "5F8299",
          charSpacing: 1.8,
          margin: 0,
        },
      },
    },
    {
      text: {
        text: "PROOF OF PLAY",
        options: {
          x: 10.45,
          y: 0.18,
          w: 2.42,
          h: 0.22,
          fontFace: "Consolas",
          fontSize: 7.5,
          bold: true,
          color: "5F8299",
          charSpacing: 1.8,
          align: "right",
          margin: 0,
        },
      },
    },
  ],
  slideNumber: {
    x: 12.25,
    y: 7.08,
    w: 0.6,
    h: 0.2,
    color: "5F8299",
    fontFace: "Consolas",
    fontSize: 8,
    align: "right",
    margin: 0,
  },
});

const C = {
  bg: "020712",
  panel: "071524",
  panel2: "0A1D30",
  line: "16364A",
  cyan: "00D7FF",
  aqua: "55F0D0",
  coral: "FF5D7C",
  violet: "8B7DFF",
  ice: "E9FBFF",
  body: "9AB6C8",
  muted: "66859A",
  base: "0052FF",
};

const shot = (name) => path.join(shotsDir, name);
const exists = (filePath) => fs.existsSync(filePath);
const fmt = (value, digits = 0) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(value);

function addGrid(slide, opacity = 88) {
  for (let x = 0.45; x < 13.1; x += 0.62) {
    slide.addShape(pptx.ShapeType.line, {
      x,
      y: 0.54,
      w: 0,
      h: 6.38,
      line: { color: C.line, transparency: opacity, width: 0.35 },
    });
  }
  for (let y = 0.65; y < 7.0; y += 0.62) {
    slide.addShape(pptx.ShapeType.line, {
      x: 0.35,
      y,
      w: 12.55,
      h: 0,
      line: { color: C.line, transparency: opacity, width: 0.35 },
    });
  }
}

function addFooter(slide, text = "Production snapshot · Jul 29, 2026") {
  slide.addText(text, {
    x: 0.45,
    y: 7.06,
    w: 6.2,
    h: 0.18,
    fontFace: "Consolas",
    fontSize: 7,
    color: C.muted,
    margin: 0,
  });
}

function addKicker(slide, text, x = 0.68, y = 0.72, w = 7.2) {
  slide.addText(text.toUpperCase(), {
    x,
    y,
    w,
    h: 0.22,
    fontFace: "Consolas",
    fontSize: 8.5,
    bold: true,
    color: C.cyan,
    charSpacing: 1.7,
    margin: 0,
  });
}

function addTitle(slide, title, subtitle, options = {}) {
  const x = options.x ?? 0.68;
  const y = options.y ?? 1.03;
  const w = options.w ?? 8.8;
  slide.addText(title, {
    x,
    y,
    w,
    h: options.h ?? 0.82,
    fontFace: "Aptos Display",
    fontSize: options.size ?? 30,
    bold: true,
    color: C.ice,
    breakLine: false,
    margin: 0,
    valign: "mid",
    fit: "shrink",
  });
  if (subtitle) {
    slide.addText(subtitle, {
      x,
      y: y + (options.subtitleOffset ?? 0.9),
      w: options.subtitleW ?? Math.min(w, 9.8),
      h: options.subtitleH ?? 0.56,
      fontSize: options.subtitleSize ?? 12,
      color: C.body,
      margin: 0,
      breakLine: false,
      fit: "shrink",
      valign: "top",
      lineSpacingMultiple: 1.08,
    });
  }
}

function addPanel(slide, x, y, w, h, accent = C.line, fill = C.panel) {
  slide.addShape(pptx.ShapeType.rect, {
    x,
    y,
    w,
    h,
    fill: { color: fill, transparency: 5 },
    line: { color: accent, transparency: accent === C.line ? 20 : 38, width: 0.8 },
  });
}

function addMetric(slide, { x, y, w, value, label, detail, color = C.cyan }) {
  addPanel(slide, x, y, w, 1.55);
  slide.addShape(pptx.ShapeType.rect, {
    x,
    y: y + 1.51,
    w: 0.52,
    h: 0.04,
    fill: { color },
    line: { color, transparency: 100 },
  });
  slide.addText(String(value), {
    x: x + 0.18,
    y: y + 0.15,
    w: w - 0.34,
    h: 0.48,
    fontFace: "Aptos Display",
    fontSize: 28,
    bold: true,
    color,
    margin: 0,
    fit: "shrink",
  });
  slide.addText(label, {
    x: x + 0.18,
    y: y + 0.7,
    w: w - 0.34,
    h: 0.25,
    fontSize: 10,
    bold: true,
    color: C.ice,
    margin: 0,
  });
  slide.addText(detail, {
    x: x + 0.18,
    y: y + 1.02,
    w: w - 0.34,
    h: 0.34,
    fontSize: 7.5,
    color: C.muted,
    margin: 0,
    fit: "shrink",
    breakLine: false,
  });
}

function addImageFrame(slide, filePath, x, y, w, h, options = {}) {
  addPanel(slide, x - 0.04, y - 0.04, w + 0.08, h + 0.08, options.accent ?? C.cyan, "030A14");
  if (exists(filePath)) {
    slide.addImage({ path: filePath, x, y, w, h, transparency: options.transparency ?? 0 });
  } else {
    slide.addText("SCREENSHOT", {
      x,
      y: y + h / 2 - 0.15,
      w,
      h: 0.3,
      align: "center",
      fontFace: "Consolas",
      fontSize: 9,
      color: C.muted,
      margin: 0,
    });
  }
}

function addPill(slide, text, x, y, w, color = C.aqua) {
  slide.addShape(pptx.ShapeType.roundRect, {
    x,
    y,
    w,
    h: 0.34,
    rectRadius: 0.08,
    fill: { color, transparency: 86 },
    line: { color, transparency: 44, width: 0.6 },
  });
  slide.addText(text, {
    x: x + 0.08,
    y: y + 0.075,
    w: w - 0.16,
    h: 0.14,
    fontFace: "Consolas",
    fontSize: 7.2,
    bold: true,
    color,
    align: "center",
    margin: 0,
    fit: "shrink",
  });
}

// 01 — Cover
{
  const slide = pptx.addSlide("NAVAL");
  addGrid(slide, 91);
  slide.addShape(pptx.ShapeType.rect, {
    x: 7.55,
    y: 0.06,
    w: 5.78,
    h: 7.44,
    fill: { color: "061A2A", transparency: 4 },
    line: { color: "061A2A", transparency: 100 },
  });
  addKicker(slide, "BASE BUILDER GRANT · 5 ETH REQUEST", 0.72, 0.92, 6.2);
  slide.addText("Sea Battle", {
    x: 0.72,
    y: 1.35,
    w: 6.25,
    h: 0.82,
    fontFace: "Aptos Display",
    fontSize: 48,
    bold: true,
    color: C.ice,
    margin: 0,
  });
  slide.addText("Naval strategy with proof of play.", {
    x: 0.72,
    y: 2.24,
    w: 6.15,
    h: 1.24,
    fontFace: "Aptos Display",
    fontSize: 27,
    bold: true,
    color: C.cyan,
    margin: 0,
    breakLine: false,
    fit: "shrink",
  });
  slide.addText(
    "A shipped Base Mainnet game with measurable adoption, repeatable sessions, USDC wagers, collectibles, seasons, and a creator-led growth loop.",
    {
      x: 0.72,
      y: 3.67,
      w: 5.82,
      h: 0.98,
      fontSize: 13,
      color: C.body,
      breakLine: false,
      margin: 0,
      fit: "shrink",
    }
  );
  addPill(slide, `${fmt(stats.headline.uniqueHumanWallets)} HUMAN WALLETS`, 0.72, 5.1, 1.82, C.cyan);
  addPill(slide, `${fmt(stats.headline.totalGames)} BATTLES`, 2.7, 5.1, 1.58, C.violet);
  addPill(slide, `${fmt(stats.headline.totalShots)} SHOTS`, 4.44, 5.1, 1.55, C.coral);
  slide.addText("seabattle.top", {
    x: 0.72,
    y: 6.35,
    w: 2.1,
    h: 0.25,
    fontFace: "Consolas",
    fontSize: 10,
    bold: true,
    color: C.aqua,
    hyperlink: { url: "https://seabattle.top" },
    margin: 0,
  });
  addImageFrame(slide, shot("01-app-home-current.png"), 8.38, 0.73, 2.38, 5.15, {
    accent: C.cyan,
  });
  addImageFrame(slide, shot("06-stats-video-hero-1920x1080.png"), 7.15, 5.18, 5.22, 1.63, {
    accent: C.violet,
  });
  addFooter(slide);
}

// 02 — Product
{
  const slide = pptx.addSlide("NAVAL");
  addGrid(slide);
  addKicker(slide, "01 · PRODUCT");
  addTitle(
    slide,
    "A familiar game becomes an onchain habit.",
    "The loop is legible in seconds: choose a mode, play a tactical battle, earn progression, and return for the next season."
  );
  const cards = [
    {
      x: 0.75,
      image: "01-app-home-current.png",
      number: "01",
      title: "Enter the fleet",
      copy: "One-tap access to solo, friend PvP, and USDC wager modes.",
      color: C.cyan,
    },
    {
      x: 4.47,
      image: "02-app-game-modes-current.png",
      number: "02",
      title: "Choose the stakes",
      copy: "Free play removes friction; Base USDC creates competitive depth.",
      color: C.violet,
    },
    {
      x: 8.19,
      image: "03-app-shop-current.png",
      number: "03",
      title: "Build the loadout",
      copy: "Season rewards, tactical inventory, and Fleet NFT utility drive return play.",
      color: C.aqua,
    },
  ];
  for (const card of cards) {
    addImageFrame(slide, shot(card.image), card.x, 2.45, 1.82, 3.93, { accent: card.color });
    slide.addText(card.number, {
      x: card.x + 2.05,
      y: 2.56,
      w: 0.45,
      h: 0.25,
      fontFace: "Consolas",
      fontSize: 9,
      bold: true,
      color: card.color,
      margin: 0,
    });
    slide.addText(card.title, {
      x: card.x + 2.05,
      y: 2.92,
      w: 1.35,
      h: 0.46,
      fontSize: 14,
      bold: true,
      color: C.ice,
      margin: 0,
      fit: "shrink",
    });
    slide.addText(card.copy, {
      x: card.x + 2.05,
      y: 3.55,
      w: 1.35,
      h: 1.08,
      fontSize: 9,
      color: C.body,
      margin: 0,
      fit: "shrink",
      breakLine: false,
    });
  }
  addFooter(slide, "Current production UI · captured Jul 29, 2026");
}

// 03 — Traction snapshot
{
  const slide = pptx.addSlide("NAVAL");
  addGrid(slide);
  addKicker(slide, "02 · TRACTION");
  addTitle(
    slide,
    "Shipped code. Production usage. Verifiable impact.",
    "Base’s grant guidance prioritizes working products, clear documentation, and measured adoption. Sea Battle already has all three."
  );
  const metrics = [
    [0.72, 2.38, 2.84, fmt(stats.headline.uniqueHumanWallets), "Human wallets", "System and bot addresses excluded", C.cyan],
    [3.75, 2.38, 2.84, fmt(stats.headline.totalGames), "Battles created", `${fmt(stats.headline.finishedGames)} finished`, C.violet],
    [6.78, 2.38, 2.84, fmt(stats.headline.totalShots), "Shots recorded", `${stats.gameplay.hitRatePct}% hit rate`, C.coral],
    [9.81, 2.38, 2.84, `${stats.headline.completionRatePct}%`, "Completion rate", "Finished / all game records", C.aqua],
    [0.72, 4.32, 2.84, stats.headline.latestMau, "Tracked MAU", "Full product-event footprint", C.cyan],
    [3.75, 4.32, 2.84, stats.headline.latestCoreMau, "Core-action MAU", "Game, economy, quest, social", C.aqua],
    [6.78, 4.32, 2.84, fmt(stats.acquisition.monthly.at(-1).games), "Games in July", `${stats.headline.latestGamePlayers} unique player wallets`, C.violet],
    [9.81, 4.32, 2.84, `+${stats.headline.latestMauGrowthPct}%`, "Tracked MoM growth", "June → July", C.coral],
  ];
  for (const [x, y, w, value, label, detail, color] of metrics) {
    addMetric(slide, { x, y, w, value, label, detail, color });
  }
  addFooter(slide);
}

// 04 — Growth
{
  const slide = pptx.addSlide("NAVAL");
  addGrid(slide);
  addKicker(slide, "03 · ADOPTION");
  addTitle(
    slide,
    "The activity signal accelerated in July.",
    "Tracked MAU rose from 30 in April to 255 in July. We keep broad activity, core actions, and unique wallets recorded in games separate."
  );
  addPanel(slide, 0.72, 2.35, 8.15, 3.85);
  const months = stats.acquisition.monthly;
  const max = Math.max(...months.map((point) => point.activeWallets));
  months.forEach((point, index) => {
    const x = 1.18 + index * 1.82;
    const height = 2.54 * (point.activeWallets / max);
    slide.addShape(pptx.ShapeType.rect, {
      x,
      y: 5.52 - height,
      w: 0.68,
      h: height,
      fill: {
        color: index === months.length - 1 ? C.cyan : "17637D",
        transparency: index === months.length - 1 ? 0 : 18,
      },
      line: { color: C.cyan, transparency: 65 },
    });
    slide.addText(String(point.activeWallets), {
      x: x - 0.16,
      y: 5.17 - height,
      w: 1,
      h: 0.26,
      fontFace: "Consolas",
      fontSize: 10,
      bold: true,
      align: "center",
      color: C.ice,
      margin: 0,
    });
    slide.addText(point.month.slice(5) === "04" ? "APR" : point.month.slice(5) === "05" ? "MAY" : point.month.slice(5) === "06" ? "JUN" : "JUL", {
      x: x - 0.16,
      y: 5.72,
      w: 1,
      h: 0.2,
      fontFace: "Consolas",
      fontSize: 8,
      bold: true,
      align: "center",
      color: C.muted,
      charSpacing: 1.2,
      margin: 0,
    });
  });
  slide.addText("TRACKED MONTHLY ACTIVE WALLETS", {
    x: 5.9,
    y: 2.65,
    w: 2.5,
    h: 0.2,
    fontFace: "Consolas",
    fontSize: 7.5,
    bold: true,
    align: "right",
    color: C.muted,
    charSpacing: 1.2,
    margin: 0,
  });
  const side = [
    ["255", "Tracked MAU", "All attributable product events", C.cyan],
    ["70", "Core-action MAU", "Strict actions only", C.aqua],
    [fmt(stats.acquisition.monthly.at(-1).games), "Games in July", `${stats.headline.latestGamePlayers} unique player wallets`, C.violet],
    ["96.9%", "MoM return", "94 of 97 June wallets", C.coral],
  ];
  side.forEach(([value, label, detail, color], index) => {
    const y = 2.35 + index * 0.96;
    addPanel(slide, 9.18, y, 3.44, 0.78);
    slide.addText(value, {
      x: 9.4,
      y: y + 0.13,
      w: 0.88,
      h: 0.32,
      fontSize: 19,
      bold: true,
      color,
      margin: 0,
      fit: "shrink",
    });
    slide.addText(label, {
      x: 10.38,
      y: y + 0.12,
      w: 1.85,
      h: 0.2,
      fontSize: 9,
      bold: true,
      color: C.ice,
      margin: 0,
    });
    slide.addText(detail, {
      x: 10.38,
      y: y + 0.38,
      w: 1.85,
      h: 0.18,
      fontSize: 7,
      color: C.muted,
      margin: 0,
    });
  });
  addFooter(slide);
}

// 05 — Metric honesty
{
  const slide = pptx.addSlide("NAVAL");
  addGrid(slide);
  addKicker(slide, "04 · MEASUREMENT");
  addTitle(
    slide,
    "One audience. Three useful lenses.",
    "We report the broadest metric for product reach and strict subsets for action quality. No wallet is counted twice inside a metric."
  );
  const lenses = [
    {
      y: 2.3,
      w: 10.9,
      value: "255",
      title: "TRACKED MAU",
      detail: "Any game, profile, season, economy, social, creator, inventory, booster, or referral record.",
      color: C.cyan,
    },
    {
      y: 3.55,
      w: 8.55,
      value: "70",
      title: "CORE-ACTION MAU",
      detail: "Game, purchase, claim, quest, share, creator, or referral events. Update-only timestamps excluded.",
      color: C.aqua,
    },
    {
      y: 4.8,
      w: 6.35,
      value: String(stats.headline.latestGamePlayers),
      title: "UNIQUE JULY PLAYER WALLETS",
      detail: `${fmt(stats.acquisition.monthly.at(-1).games)} games were recorded across these human wallets in July.`,
      color: C.violet,
    },
  ];
  lenses.forEach((lens) => {
    addPanel(slide, 0.95, lens.y, lens.w, 0.95, lens.color);
    slide.addText(lens.value, {
      x: 1.16,
      y: lens.y + 0.18,
      w: 0.85,
      h: 0.42,
      fontSize: 24,
      bold: true,
      color: lens.color,
      margin: 0,
    });
    slide.addText(lens.title, {
      x: 2.2,
      y: lens.y + 0.16,
      w: 2.2,
      h: 0.22,
      fontFace: "Consolas",
      fontSize: 8,
      bold: true,
      color: C.ice,
      charSpacing: 1.1,
      margin: 0,
    });
    slide.addText(lens.detail, {
      x: 2.2,
      y: lens.y + 0.45,
      w: lens.w - 2.55,
      h: 0.26,
      fontSize: 7.8,
      color: C.body,
      margin: 0,
      fit: "shrink",
    });
  });
  addPanel(slide, 9.52, 3.48, 2.7, 2.27, C.coral, "091623");
  slide.addText("WHY THIS MATTERS", {
    x: 9.8,
    y: 3.78,
    w: 2.15,
    h: 0.2,
    fontFace: "Consolas",
    fontSize: 8,
    bold: true,
    color: C.coral,
    charSpacing: 1.2,
    margin: 0,
  });
  slide.addText(
    "Grant reviewers can distinguish reach from direct gameplay while still seeing the complete product loop.",
    {
      x: 9.8,
      y: 4.24,
      w: 2.05,
      h: 0.94,
      fontSize: 12,
      bold: true,
      color: C.ice,
      margin: 0,
      fit: "shrink",
      breakLine: false,
    }
  );
  addFooter(slide, "Definitions generated with the public /stats dashboard");
}

// 06 — Gameplay depth
{
  const slide = pptx.addSlide("NAVAL");
  addGrid(slide);
  addKicker(slide, "05 · ENGAGEMENT");
  addTitle(
    slide,
    "A real game loop, not a wallet connect.",
    `${fmt(stats.gameplay.totalShots)} tactical decisions across ${fmt(stats.gameplay.totalGames)} battles create room for mastery, progression, and competitive formats.`
  );
  const gameMetrics = [
    [0.75, `${stats.gameplay.completionRatePct}%`, "Battle completion", `${fmt(stats.gameplay.states.finished)} finished`, C.aqua],
    [3.2, `${stats.gameplay.shotsPerFinishedGame}`, "Shots / finished game", "Session density", C.cyan],
    [5.65, `${stats.gameplay.hitRatePct}%`, "Shot accuracy", `${fmt(stats.gameplay.hits)} confirmed hits`, C.coral],
  ];
  gameMetrics.forEach(([x, value, label, detail, color]) =>
    addMetric(slide, { x, y: 2.32, w: 2.2, value, label, detail, color })
  );
  addPanel(slide, 8.15, 2.32, 4.45, 3.83);
  slide.addText("BATTLES BY MODE", {
    x: 8.45,
    y: 2.65,
    w: 2.2,
    h: 0.2,
    fontFace: "Consolas",
    fontSize: 8,
    bold: true,
    color: C.muted,
    charSpacing: 1.2,
    margin: 0,
  });
  const modes = Object.entries(stats.gameplay.byMode);
  const maxMode = Math.max(...modes.map(([, value]) => value));
  modes.forEach(([mode, value], index) => {
    const y = 3.18 + index * 0.64;
    const label = mode === "bot" ? "Solo vs AI" : mode === "free" ? "Friend PvP" : mode === "wager" ? "USDC wager" : "Legacy hybrid";
    slide.addText(label, {
      x: 8.45,
      y,
      w: 1.2,
      h: 0.18,
      fontSize: 8.2,
      color: C.body,
      margin: 0,
    });
    slide.addShape(pptx.ShapeType.rect, {
      x: 9.7,
      y: y + 0.04,
      w: 1.9,
      h: 0.08,
      fill: { color: C.line },
      line: { color: C.line, transparency: 100 },
    });
    slide.addShape(pptx.ShapeType.rect, {
      x: 9.7,
      y: y + 0.04,
      w: 1.9 * (value / maxMode),
      h: 0.08,
      fill: { color: index === 0 ? C.cyan : index === 1 ? C.violet : index === 2 ? C.aqua : C.muted },
      line: { color: C.line, transparency: 100 },
    });
    slide.addText(fmt(value), {
      x: 11.77,
      y,
      w: 0.48,
      h: 0.18,
      align: "right",
      fontFace: "Consolas",
      fontSize: 8,
      bold: true,
      color: C.ice,
      margin: 0,
    });
  });
  addPanel(slide, 0.75, 4.25, 7.1, 1.9, C.cyan);
  slide.addText("Why players return", {
    x: 1.05,
    y: 4.58,
    w: 2.2,
    h: 0.28,
    fontSize: 15,
    bold: true,
    color: C.ice,
    margin: 0,
  });
  const features = ["Daily check-ins", "Seasons", "Fleet NFT utility", "Tactical items", "Leaderboard", "Creator rewards"];
  features.forEach((feature, index) => {
    addPill(slide, feature.toUpperCase(), 1.05 + (index % 3) * 2.08, 5.07 + Math.floor(index / 3) * 0.48, 1.82, index % 2 ? C.violet : C.aqua);
  });
  addFooter(slide);
}

// 07 — Base-native economy
{
  const slide = pptx.addSlide("NAVAL");
  addGrid(slide);
  addKicker(slide, "06 · BASE-NATIVE ECONOMY");
  addTitle(
    slide,
    "Base is part of the product, not a badge.",
    "USDC wagers, sponsored contract calls, collectibles, and season rewards connect gameplay to durable onchain ownership."
  );
  const econ = [
    ["$58.10", "Represented stake volume", `${stats.economy.wagerGames} production wager rooms`, C.aqua],
    [stats.economy.completedWagerGames, "Completed wager games", `${stats.economy.uniqueWagerPlayers} unique wager players`, C.cyan],
    [fmt(stats.seasonAndCollectibles.fleetNftClaims), "Fleet NFT claims", `${fmt(stats.seasonAndCollectibles.fleetPointsClaimed)} points claimed`, C.violet],
    [fmt(stats.seasonAndCollectibles.seasonPoints), "Season points", `${stats.seasonAndCollectibles.uniqueSeasonParticipants} participants`, C.coral],
  ];
  econ.forEach(([value, label, detail, color], index) =>
    addMetric(slide, {
      x: 0.72 + index * 3.03,
      y: 2.25,
      w: 2.84,
      value,
      label,
      detail,
      color,
    })
  );
  addPanel(slide, 0.72, 4.22, 7.4, 1.73, C.base, "06152A");
  slide.addShape(pptx.ShapeType.ellipse, {
    x: 1.05,
    y: 4.57,
    w: 0.82,
    h: 0.82,
    fill: { color: C.base },
    line: { color: C.base },
  });
  slide.addText("BASE", {
    x: 1.14,
    y: 4.9,
    w: 0.64,
    h: 0.12,
    fontSize: 7,
    bold: true,
    color: "FFFFFF",
    align: "center",
    margin: 0,
  });
  slide.addText("PRIMARY GAME CONTRACT", {
    x: 2.15,
    y: 4.54,
    w: 2.2,
    h: 0.18,
    fontFace: "Consolas",
    fontSize: 8,
    bold: true,
    color: "85B5FF",
    charSpacing: 1.1,
    margin: 0,
  });
  slide.addText(stats.project.primaryContract, {
    x: 2.15,
    y: 4.91,
    w: 5.3,
    h: 0.24,
    fontFace: "Consolas",
    fontSize: 10,
    color: C.ice,
    hyperlink: { url: `https://basescan.org/address/${stats.project.primaryContract}` },
    margin: 0,
    fit: "shrink",
  });
  slide.addText("Verify on BaseScan ↗", {
    x: 2.15,
    y: 5.36,
    w: 1.8,
    h: 0.18,
    fontSize: 8,
    bold: true,
    color: "85B5FF",
    hyperlink: { url: `https://basescan.org/address/${stats.project.primaryContract}` },
    margin: 0,
  });
  addPanel(slide, 8.38, 4.22, 4.21, 1.73, C.aqua);
  slide.addText("ONCHAIN LOOP", {
    x: 8.7,
    y: 4.52,
    w: 1.4,
    h: 0.2,
    fontFace: "Consolas",
    fontSize: 8,
    bold: true,
    color: C.aqua,
    charSpacing: 1.1,
    margin: 0,
  });
  slide.addText("PLAY  →  SETTLE  →  OWN  →  RETURN", {
    x: 8.7,
    y: 5.0,
    w: 3.47,
    h: 0.3,
    fontFace: "Consolas",
    fontSize: 11,
    bold: true,
    color: C.ice,
    margin: 0,
    fit: "shrink",
  });
  addFooter(slide);
}

// 08 — Community
{
  const slide = pptx.addSlide("NAVAL");
  addGrid(slide);
  addKicker(slide, "07 · COMMUNITY");
  addTitle(
    slide,
    "Players create the distribution layer.",
    "Quests, rewarded sharing, referrals, and creator payouts turn play sessions into attributable community activity."
  );
  const items = [
    [fmt(stats.community.externalQuestClaims), "Quest claims", `${stats.community.uniqueQuesters} unique questers`, C.cyan],
    [fmt(stats.community.socialShareRewards), "Rewarded shares", `${stats.community.uniqueSharers} attributed sharers`, C.violet],
    [fmt(stats.community.creatorSubmissions), "Creator submissions", `${stats.community.creatorSubmissionStatuses.rewarded} rewarded`, C.coral],
    [fmt(stats.community.creatorRewards), "Creator rewards", `${stats.community.uniqueCreatorsRewarded} rewarded creators`, C.aqua],
  ];
  items.forEach(([value, label, detail, color], index) =>
    addMetric(slide, {
      x: 0.72 + index * 3.03,
      y: 2.32,
      w: 2.84,
      value,
      label,
      detail,
      color,
    })
  );
  addPanel(slide, 0.72, 4.38, 11.98, 1.54);
  const loop = [
    ["PLAY", "A battle creates a story"],
    ["SHARE", "Rewards prompt distribution"],
    ["DISCOVER", "New players enter the fleet"],
    ["RETURN", "Seasons and rank keep momentum"],
  ];
  loop.forEach(([title, detail], index) => {
    const x = 1.0 + index * 2.93;
    slide.addShape(pptx.ShapeType.ellipse, {
      x,
      y: 4.72,
      w: 0.48,
      h: 0.48,
      fill: { color: index % 2 ? C.violet : C.cyan, transparency: 8 },
      line: { color: index % 2 ? C.violet : C.cyan },
    });
    slide.addText(String(index + 1), {
      x: x + 0.13,
      y: 4.86,
      w: 0.22,
      h: 0.12,
      align: "center",
      fontFace: "Consolas",
      fontSize: 7,
      bold: true,
      color: C.bg,
      margin: 0,
    });
    slide.addText(title, {
      x: x + 0.65,
      y: 4.67,
      w: 1.65,
      h: 0.22,
      fontFace: "Consolas",
      fontSize: 8,
      bold: true,
      color: C.ice,
      charSpacing: 1.1,
      margin: 0,
    });
    slide.addText(detail, {
      x: x + 0.65,
      y: 4.98,
      w: 1.7,
      h: 0.35,
      fontSize: 7.5,
      color: C.muted,
      margin: 0,
      fit: "shrink",
    });
    if (index < loop.length - 1) {
      slide.addText("→", {
        x: x + 2.46,
        y: 4.8,
        w: 0.3,
        h: 0.25,
        fontSize: 15,
        color: C.cyan,
        margin: 0,
      });
    }
  });
  addFooter(slide);
}

// 09 — Why Base / moat
{
  const slide = pptx.addSlide("NAVAL");
  addGrid(slide);
  addKicker(slide, "08 · WHY BASE");
  addTitle(
    slide,
    "A consumer game that makes onchain actions feel native.",
    "Sea Battle meets players in a format they already understand, then introduces wallet identity, USDC settlement, ownership, and creator rewards through play."
  );
  const reasons = [
    {
      x: 0.78,
      title: "DISTRIBUTION",
      body: "Built for Base App discovery, social sharing, and low-friction wallet entry.",
      proof: "255 tracked MAU",
      color: C.cyan,
    },
    {
      x: 3.85,
      title: "ECONOMIC ACTIVITY",
      body: "Wagers and shop utility create clear reasons to transact on Base.",
      proof: "$58.10 represented stakes",
      color: C.aqua,
    },
    {
      x: 6.92,
      title: "RETENTION",
      body: "Seasons, rank, inventory, and collectibles make the chain part of progression.",
      proof: "92.1% battle completion",
      color: C.violet,
    },
    {
      x: 9.99,
      title: "ATTRIBUTION",
      body: "Public telemetry and Builder Code work connect activity back to the builder.",
      proof: "Auditable /stats dashboard",
      color: C.coral,
    },
  ];
  reasons.forEach((reason, index) => {
    addPanel(slide, reason.x, 2.35, 2.55, 3.34, reason.color);
    slide.addText(`0${index + 1}`, {
      x: reason.x + 0.22,
      y: 2.62,
      w: 0.45,
      h: 0.22,
      fontFace: "Consolas",
      fontSize: 8,
      bold: true,
      color: reason.color,
      margin: 0,
    });
    slide.addText(reason.title, {
      x: reason.x + 0.22,
      y: 3.04,
      w: 2.08,
      h: 0.28,
      fontFace: "Consolas",
      fontSize: 9,
      bold: true,
      color: C.ice,
      charSpacing: 1.1,
      margin: 0,
      fit: "shrink",
    });
    slide.addText(reason.body, {
      x: reason.x + 0.22,
      y: 3.58,
      w: 2.05,
      h: 0.92,
      fontSize: 10,
      color: C.body,
      margin: 0,
      breakLine: false,
      fit: "shrink",
    });
    slide.addShape(pptx.ShapeType.line, {
      x: reason.x + 0.22,
      y: 4.78,
      w: 2.05,
      h: 0,
      line: { color: C.line, width: 0.6 },
    });
    slide.addText(reason.proof, {
      x: reason.x + 0.22,
      y: 5.02,
      w: 2.05,
      h: 0.3,
      fontSize: 10,
      bold: true,
      color: reason.color,
      margin: 0,
      fit: "shrink",
    });
  });
  addFooter(slide);
}

// 10 — Use of funds
{
  const slide = pptx.addSlide("NAVAL");
  addGrid(slide);
  addKicker(slide, "09 · USE OF FUNDS");
  addTitle(
    slide,
    "5 ETH to scale the loop already working.",
    "The allocation follows the founder’s priorities: a larger player pool, measurable acquisition, stronger mechanics, and dedicated in-house development."
  );
  const allocations = [
    { share: 35, eth: "1.75 ETH", title: "Prize & activity pool", body: "Increase rewards and seasonal prize liquidity to attract more players and trigger more games.", color: C.aqua },
    { share: 25, eth: "1.25 ETH", title: "Advertising & growth", body: "Base-native media, creator campaigns, referral experiments, and retargeting.", color: C.cyan },
    { share: 20, eth: "1.00 ETH", title: "Game mechanics", body: "Challenges, matchmaking, progression balance, anti-abuse, and faster settlement UX.", color: C.violet },
    { share: 20, eth: "1.00 ETH", title: "Dedicated developers", body: "Fund the team’s own engineering capacity for shipping, analytics, security, and support.", color: C.coral },
  ];
  let offset = 0;
  allocations.forEach((item) => {
    const width = 11.88 * (item.share / 100);
    slide.addShape(pptx.ShapeType.rect, {
      x: 0.72 + offset,
      y: 2.35,
      w: width,
      h: 0.38,
      fill: { color: item.color },
      line: { color: C.bg, transparency: 55, width: 0.4 },
    });
    offset += width;
  });
  allocations.forEach((item, index) => {
    const x = 0.72 + index * 3.03;
    addPanel(slide, x, 3.08, 2.84, 2.72, item.color);
    slide.addText(`${item.share}%`, {
      x: x + 0.2,
      y: 3.32,
      w: 0.8,
      h: 0.42,
      fontSize: 23,
      bold: true,
      color: item.color,
      margin: 0,
    });
    slide.addText(item.eth, {
      x: x + 1.14,
      y: 3.45,
      w: 1.42,
      h: 0.23,
      fontFace: "Consolas",
      fontSize: 9,
      bold: true,
      color: C.ice,
      align: "right",
      margin: 0,
    });
    slide.addText(item.title, {
      x: x + 0.2,
      y: 4.02,
      w: 2.35,
      h: 0.48,
      fontSize: 14,
      bold: true,
      color: C.ice,
      margin: 0,
      fit: "shrink",
    });
    slide.addText(item.body, {
      x: x + 0.2,
      y: 4.67,
      w: 2.35,
      h: 0.78,
      fontSize: 8.5,
      color: C.body,
      margin: 0,
      fit: "shrink",
      breakLine: false,
    });
  });
  slide.addText(
    "Grant spend will be reported against public milestones and the same production metrics used in this deck.",
    {
      x: 0.72,
      y: 6.16,
      w: 8.4,
      h: 0.35,
      fontSize: 10,
      bold: true,
      color: C.aqua,
      margin: 0,
    }
  );
  addFooter(slide);
}

// 11 — 90 day plan
{
  const slide = pptx.addSlide("NAVAL");
  addGrid(slide);
  addKicker(slide, "10 · 90-DAY PLAN");
  addTitle(
    slide,
    "Fund milestones, then measure the lift.",
    "Each workstream has a shipping checkpoint and a product outcome. Targets are ambitious but grounded in the current production baseline."
  );
  const phases = [
    {
      x: 0.78,
      period: "DAYS 0–30",
      title: "Activate",
      items: ["Launch larger seasonal pool", "Instrument Builder Code attribution", "Run first Base-native acquisition test"],
      target: "→ 325 tracked MAU",
      color: C.cyan,
    },
    {
      x: 4.4,
      period: "DAYS 31–60",
      title: "Deepen",
      items: ["Ship challenge/matchmaking improvements", "Tune progression and anti-abuse", "Expand creator reward campaigns"],
      target: "→ 100 core-action MAU",
      color: C.violet,
    },
    {
      x: 8.02,
      period: "DAYS 61–90",
      title: "Scale",
      items: ["Optimize paid + referral channels", "Publish grant impact update", "Harden settlement and support"],
      target: "→ 500 tracked MAU",
      color: C.aqua,
    },
  ];
  phases.forEach((phase, index) => {
    addPanel(slide, phase.x, 2.3, 3.28, 3.72, phase.color);
    slide.addText(phase.period, {
      x: phase.x + 0.25,
      y: 2.57,
      w: 1.6,
      h: 0.2,
      fontFace: "Consolas",
      fontSize: 8,
      bold: true,
      color: phase.color,
      charSpacing: 1.2,
      margin: 0,
    });
    slide.addText(phase.title, {
      x: phase.x + 0.25,
      y: 2.98,
      w: 2.4,
      h: 0.48,
      fontSize: 23,
      bold: true,
      color: C.ice,
      margin: 0,
    });
    phase.items.forEach((item, itemIndex) => {
      slide.addShape(pptx.ShapeType.ellipse, {
        x: phase.x + 0.27,
        y: 3.7 + itemIndex * 0.52,
        w: 0.12,
        h: 0.12,
        fill: { color: phase.color },
        line: { color: phase.color },
      });
      slide.addText(item, {
        x: phase.x + 0.52,
        y: 3.64 + itemIndex * 0.52,
        w: 2.34,
        h: 0.3,
        fontSize: 8.8,
        color: C.body,
        margin: 0,
        fit: "shrink",
      });
    });
    slide.addShape(pptx.ShapeType.line, {
      x: phase.x + 0.25,
      y: 5.37,
      w: 2.72,
      h: 0,
      line: { color: C.line, width: 0.7 },
    });
    slide.addText(phase.target, {
      x: phase.x + 0.25,
      y: 5.55,
      w: 2.72,
      h: 0.24,
      fontFace: "Consolas",
      fontSize: 9,
      bold: true,
      color: phase.color,
      margin: 0,
      align: "right",
      fit: "shrink",
    });
    if (index < phases.length - 1) {
      slide.addText("→", {
        x: phase.x + 3.32,
        y: 4.0,
        w: 0.25,
        h: 0.25,
        fontSize: 16,
        color: C.cyan,
        margin: 0,
      });
    }
  });
  addFooter(slide);
}

// 12 — Ask / close
{
  const slide = pptx.addSlide("NAVAL");
  addGrid(slide, 91);
  addImageFrame(slide, shot("06-stats-video-hero-1920x1080.png"), 7.18, 0.82, 5.45, 3.07, {
    accent: C.cyan,
  });
  addImageFrame(slide, shot("07-stats-full-page.png"), 8.34, 4.15, 2.84, 1.6, {
    accent: C.violet,
  });
  addKicker(slide, "THE ASK", 0.72, 1.08, 3.2);
  slide.addText("Back the next 90 days of Sea Battle.", {
    x: 0.72,
    y: 1.55,
    w: 5.85,
    h: 1.35,
    fontFace: "Aptos Display",
    fontSize: 38,
    bold: true,
    color: C.ice,
    margin: 0,
    fit: "shrink",
    breakLine: false,
  });
  slide.addText(
    "5 ETH turns a proven production loop into a larger prize economy, stronger acquisition engine, deeper game, and dedicated shipping cadence.",
    {
      x: 0.72,
      y: 3.25,
      w: 5.55,
      h: 0.86,
      fontSize: 13,
      color: C.body,
      margin: 0,
      fit: "shrink",
      breakLine: false,
    }
  );
  addMetric(slide, {
    x: 0.72,
    y: 4.62,
    w: 2.7,
    value: "5 ETH",
    label: "Builder Grant request",
    detail: "90-day milestone plan",
    color: C.aqua,
  });
  addMetric(slide, {
    x: 3.62,
    y: 4.62,
    w: 2.7,
    value: "500",
    label: "Tracked MAU target",
    detail: "Measured on public dashboard",
    color: C.cyan,
  });
  slide.addText("PLAY", {
    x: 7.35,
    y: 6.15,
    w: 0.55,
    h: 0.2,
    fontFace: "Consolas",
    fontSize: 8,
    bold: true,
    color: C.muted,
    margin: 0,
  });
  slide.addText("seabattle.top", {
    x: 8.05,
    y: 6.12,
    w: 1.8,
    h: 0.24,
    fontFace: "Consolas",
    fontSize: 10,
    bold: true,
    color: C.cyan,
    hyperlink: { url: "https://seabattle.top" },
    margin: 0,
  });
  slide.addText("VERIFY", {
    x: 10.05,
    y: 6.15,
    w: 0.65,
    h: 0.2,
    fontFace: "Consolas",
    fontSize: 8,
    bold: true,
    color: C.muted,
    margin: 0,
  });
  slide.addText("BaseScan ↗", {
    x: 10.85,
    y: 6.12,
    w: 1.15,
    h: 0.24,
    fontFace: "Consolas",
    fontSize: 10,
    bold: true,
    color: "85B5FF",
    hyperlink: { url: `https://basescan.org/address/${stats.project.primaryContract}` },
    margin: 0,
  });
  addFooter(slide, "Sea Battle · Base Builder Grant · July 2026");
}

const outputPath = path.join(outDir, "Sea_Battle_Base_Builder_Grant.pptx");
await pptx.writeFile({ fileName: outputPath });
console.log(`Presentation saved to ${outputPath}`);
