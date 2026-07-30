const ROOT_URL =
  process.env.NEXT_PUBLIC_APP_URL ||
  process.env.NEXT_PUBLIC_URL ||
  (process.env.VERCEL_ENV === "production" ? "https://seabattle.top" : "") ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'http://localhost:3000');

export const farcasterConfig = {
  accountAssociation: {
    header: "",
    payload: "",
    signature: ""
  },
  miniapp: {
    version: "1",
    name: "Sea Battle",
    subtitle: "Onchain Battleship with friends",
    description: "Classic Battleship on Base with solo play, friend PvP, USDC wagers, seasons, and rewards.",
    screenshotUrls: [
      `${ROOT_URL}/app-screenshots/01-home.png`,
      `${ROOT_URL}/app-screenshots/02-game-modes.png`,
      `${ROOT_URL}/app-screenshots/03-leaderboard.png`,
    ],
    iconUrl: `${ROOT_URL}/icon.png`,
    splashImageUrl: `${ROOT_URL}/splash.png`,
    splashBackgroundColor: "#0A1628",
    homeUrl: ROOT_URL,
    primaryCategory: "games",
    tags: ["battleship", "pvp", "onchain", "base", "strategy"],
    heroImageUrl: `${ROOT_URL}/hero.png`,
    tagline: "Naval strategy, rebuilt onchain",
    ogTitle: "Sea Battle - Onchain Battleship",
    ogDescription: "Play solo, challenge friends, and compete in USDC wager battles on Base.",
    ogImageUrl: `${ROOT_URL}/hero.png`,
  },
} as const;
