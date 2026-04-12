const ROOT_URL =
  process.env.NEXT_PUBLIC_URL ||
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
    description: "Classic Battleship game on Base. Every shot is an onchain transaction. Create a game, share with a friend, place ships, fire!",
    screenshotUrls: [`${ROOT_URL}/screenshots/gameplay.png`],
    iconUrl: `${ROOT_URL}/icon.png`,
    splashImageUrl: `${ROOT_URL}/splash.png`,
    splashBackgroundColor: "#0A1628",
    homeUrl: ROOT_URL,
    webhookUrl: `${ROOT_URL}/api/webhook`,
    primaryCategory: "games",
    tags: ["battleship", "pvp", "onchain", "base", "strategy"],
    heroImageUrl: `${ROOT_URL}/hero.png`,
    tagline: "Every shot is a transaction",
    ogTitle: "Sea Battle - Onchain Battleship",
    ogDescription: "Play Battleship with friends on Base. Each shot = 1 tx.",
    ogImageUrl: `${ROOT_URL}/og.png`,
  },
} as const;
