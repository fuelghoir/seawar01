import type { Metadata } from "next";
import { headers } from "next/headers";
import { farcasterConfig } from "../farcaster.config";
import HomeClient from "./HomeClient";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({
  searchParams,
}: {
  searchParams?: SearchParams;
}): Promise<Metadata> {
  const params = searchParams ? await searchParams : {};
  const ref = normalizeMetadataRef(firstParam(params.ref));
  const launchUrl = ref
    ? withReferralParam(farcasterConfig.miniapp.homeUrl, ref)
    : farcasterConfig.miniapp.homeUrl;
  const miniAppEmbed = {
    version: farcasterConfig.miniapp.version,
    imageUrl: farcasterConfig.miniapp.heroImageUrl,
    button: {
      title: "Play Sea Battle",
      action: {
        name: "Sea Battle",
        type: "launch_frame",
        url: launchUrl,
      },
    },
  };

  return {
    other: {
      "base:app_id": "69dbfc9ded56423f0cd3e692",
      "fc:frame": JSON.stringify(miniAppEmbed),
      "fc:miniapp": JSON.stringify(miniAppEmbed),
    },
  };
}

function getInitialIsNarrowScreen(headersList: Headers) {
  const ua = headersList.get("user-agent") ?? "";
  const clientHintMobile = headersList.get("sec-ch-ua-mobile");
  const viewportWidth = Number(
    headersList.get("viewport-width") ?? headersList.get("sec-ch-viewport-width")
  );

  if (clientHintMobile === "?1") return true;
  if (Number.isFinite(viewportWidth) && viewportWidth <= 720) return true;

  return /Android|iPhone|iPad|iPod|Mobile|Windows Phone|webOS|BlackBerry|Opera Mini|IEMobile|BaseApp|CoinbaseWallet|Farcaster/i.test(
    ua
  );
}

export default async function Page() {
  const headersList = await headers();

  return (
    <HomeClient
      initialIsNarrowScreen={getInitialIsNarrowScreen(headersList)}
    />
  );
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeMetadataRef(ref: string | undefined): string | null {
  const normalized = ref?.trim().toLowerCase();
  if (!normalized) return null;
  return /^0x[a-f0-9]{40}$/.test(normalized) ? normalized : null;
}

function withReferralParam(baseUrl: string, ref: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set("ref", ref);
  return url.toString();
}
