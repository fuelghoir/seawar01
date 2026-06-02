/**
 * Generate the nine Fleet Pass metadata variants.
 *
 * Required:
 *   FLEET_NFT_IMAGE_BASE_URI=ipfs://CID/
 */

import fs from "fs";
import path from "path";

const imageBaseURI = process.env.FLEET_NFT_IMAGE_BASE_URI;
const externalUrl = process.env.FLEET_NFT_EXTERNAL_URL || process.env.NEXT_PUBLIC_URL || "";
const outputDir = path.resolve(process.env.FLEET_NFT_METADATA_DIR || "metadata/fleet-pass");
const rates = [[50, 75, 100], [200, 250, 300], [400, 450, 500]];
const classes = ["Patrol Corvette", "Aegis Destroyer", "Abyss Dreadnought"];

if (!imageBaseURI) {
  console.error("Set FLEET_NFT_IMAGE_BASE_URI, for example ipfs://CID/");
  process.exit(1);
}

fs.mkdirSync(outputDir, { recursive: true });
for (let tier = 1; tier <= 3; tier++) {
  for (let level = 1; level <= 3; level++) {
    const variant = ((tier - 1) * 3) + level;
    const metadata = {
      name: `Sea Battle Fleet Pass - ${classes[tier - 1]} - Level ${level}`,
      description: "A transferable evolving Sea Battle fleet NFT. Upgrades burn the previous token and mint its evolved form while preserving accrued points.",
      image: `${imageBaseURI}fleet-tier-${tier}.png`,
      external_url: externalUrl,
      attributes: [
        { trait_type: "Tier", value: tier },
        { trait_type: "Level", value: level },
        { trait_type: "Fleet class", value: classes[tier - 1] },
        { trait_type: "Points per hour", value: rates[tier - 1][level - 1] },
      ],
    };
    fs.writeFileSync(path.join(outputDir, `${variant}.json`), JSON.stringify(metadata, null, 2));
  }
}

console.log(`Generated nine Fleet Pass metadata files in ${outputDir}`);
