import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

const MAX_SUPPLY = 20;
const WEEKLY_POINTS = 10_000;
const REQUIRED_WINS = 100;

const imageUri = process.env.CAPTAIN_SBT_IMAGE_URI;
const animationUrl = process.env.CAPTAIN_SBT_ANIMATION_URI || "";
const externalUrl = process.env.CAPTAIN_SBT_EXTERNAL_URL || process.env.NEXT_PUBLIC_URL || "";
const outputDir = path.resolve(process.env.CAPTAIN_SBT_METADATA_DIR || "metadata/captain-sbt");

if (!imageUri) {
  console.error("CAPTAIN_SBT_IMAGE_URI is required. Example: CAPTAIN_SBT_IMAGE_URI=ipfs://CID/captain-sbt.png");
  process.exit(1);
}

await mkdir(outputDir, { recursive: true });

for (let tokenId = 1; tokenId <= MAX_SUPPLY; tokenId++) {
  const paddedId = String(tokenId).padStart(2, "0");
  const metadata = {
    name: `Sea Battle Captain SBT #${paddedId}`,
    description:
      "A limited soulbound Sea Battle Captain pass. Claimable after 100 total wins and grants 10,000 points once per week in the Sea Battle app.",
    image: imageUri,
    attributes: [
      { trait_type: "Collection", value: "Sea Battle Captain SBT" },
      { trait_type: "Token Type", value: "Soulbound" },
      { trait_type: "Network", value: "Base" },
      { trait_type: "Supply", value: "20 Total" },
      { trait_type: "Captain Number", value: paddedId },
      { trait_type: "Required Wins", value: REQUIRED_WINS },
      { trait_type: "Weekly Points", value: WEEKLY_POINTS },
    ],
  };

  if (externalUrl) {
    metadata.external_url = externalUrl;
  }

  if (animationUrl) {
    metadata.animation_url = animationUrl;
  }

  await writeFile(
    path.join(outputDir, String(tokenId)),
    `${JSON.stringify(metadata, null, 2)}\n`,
    "utf8"
  );
}

console.log(`Generated ${MAX_SUPPLY} Captain SBT metadata files in ${outputDir}`);
console.log("Upload this folder and set baseURI to the folder URL ending with /");
