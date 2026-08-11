import type { Metadata } from "next";
import { headers } from "next/headers";
import { farcasterConfig } from "../farcaster.config";
import HomeClient from "./HomeClient";
import { normalizeReferralToken } from "./lib/referralIdentity";
import { createSeoMetadata, SITE_DESCRIPTION, SITE_TITLE } from "./lib/seo";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const TALENTAPP_PROJECT_VERIFICATION =
  "3c54274f5cae630fe5ba64279d90f064dbde544a89378cbc57aaa12325e2ae248d50baa1e60add397d0e9cc296346513abf365388f398662810b7b84d955b59b";

export async function generateMetadata({
  searchParams,
}: {
  searchParams?: SearchParams;
}): Promise<Metadata> {
  const params = searchParams ? await searchParams : {};
  const ref = normalizeReferralToken(firstParam(params.ref));
  const launchUrl = withLaunchParams(farcasterConfig.miniapp.homeUrl, params, ref);
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
  const seoMetadata = createSeoMetadata({
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    path: "/",
  });

  return {
    ...seoMetadata,
    title: {
      absolute: SITE_TITLE,
    },
    other: {
      "base:app_id": "69dbfc9ded56423f0cd3e692",
      "fc:frame": JSON.stringify(miniAppEmbed),
      "fc:miniapp": JSON.stringify(miniAppEmbed),
      "talentapp:project_verification": TALENTAPP_PROJECT_VERIFICATION,
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

export default async function Page({ searchParams }: { searchParams?: SearchParams }) {
  const headersList = await headers();
  const params = searchParams ? await searchParams : {};
  const tabParam = firstParam(params.tab);
  const initialTab = tabParam === "quests" || tabParam === "profile" ? tabParam : null;

  return (
    <HomeClient
      initialIsNarrowScreen={getInitialIsNarrowScreen(headersList)}
      initialTab={initialTab}
    />
  );
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function withLaunchParams(
  baseUrl: string,
  params: Record<string, string | string[] | undefined>,
  ref: string | null,
): string {
  const url = new URL(baseUrl);
  if (ref) url.searchParams.set("ref", ref);

  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_content"] as const) {
    const value = normalizeLaunchParam(firstParam(params[key]));
    if (value) url.searchParams.set(key, value);
  }

  return url.toString();
}

function normalizeLaunchParam(value: string | undefined): string | null {
  const normalized = value?.trim().slice(0, 80) ?? "";
  return normalized && !/[\u0000-\u001f\u007f]/.test(normalized) ? normalized : null;
}
