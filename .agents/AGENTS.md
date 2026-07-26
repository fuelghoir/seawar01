# Project Rules

## UI Layout & Image Loading Rules
- **Control Proximity**: Always render filter controls, toggle tabs, and search bars directly above the specific table or list they modify. Do not place unrelated cards or widgets between controls and their target content.
- **Static Asset Optimization**: For local static image assets in `/public`, ensure `images: { unoptimized: true }` is set in `next.config.ts` (or use standard `<img>` tags for static public assets) to prevent `/_next/image` 404 rendering errors on mobile webviews and Netlify.
- **Card Dimension Parity**: When embedding shared components across multiple views (e.g., SeasonPoolCard in Profile vs Airdrop page), wrap them in consistent container classes (`mobileSeasonRewardBlock`) so padding, width, and typography remain identical.
