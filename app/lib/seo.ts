import type { Metadata } from "next";
import { getPublicAppUrl } from "./publicUrl";

export const SITE_NAME = "Sea Battle";
export const SITE_TITLE = "Sea Battle - Onchain Battleship on Base";
export const SITE_DESCRIPTION =
  "Play Sea Battle, an onchain Battleship strategy game on Base with AI battles, PvP, daily rewards, promo codes, leaderboards, and creator rewards.";

export const OG_IMAGE_PATH = "/hero.png";
export const ICON_IMAGE_PATH = "/icon.png";

const BASE_KEYWORDS = [
  "Sea Battle",
  "Battleship",
  "onchain game",
  "Base game",
  "Base App",
  "crypto game",
  "PvP strategy game",
  "promo codes",
];

export function getSiteUrl() {
  return getPublicAppUrl();
}

export function absoluteUrl(path = "/") {
  return new URL(path, getSiteUrl()).toString();
}

export function createSeoMetadata({
  title,
  description = SITE_DESCRIPTION,
  path = "/",
  imagePath = OG_IMAGE_PATH,
  keywords = [],
  noIndex = false,
}: {
  title: string;
  description?: string;
  path?: string;
  imagePath?: string;
  keywords?: string[];
  noIndex?: boolean;
}): Metadata {
  const url = absoluteUrl(path);
  const imageUrl = absoluteUrl(imagePath);

  return {
    title,
    description,
    keywords: [...BASE_KEYWORDS, ...keywords],
    alternates: {
      canonical: url,
    },
    openGraph: {
      title,
      description,
      url,
      siteName: SITE_NAME,
      images: [
        {
          url: imageUrl,
          width: 1200,
          height: 630,
          alt: "Sea Battle onchain Battleship game on Base",
        },
      ],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [imageUrl],
    },
    robots: noIndex
      ? {
          index: false,
          follow: false,
          googleBot: {
            index: false,
            follow: false,
          },
        }
      : {
          index: true,
          follow: true,
          googleBot: {
            index: true,
            follow: true,
            "max-image-preview": "large",
            "max-snippet": -1,
            "max-video-preview": -1,
          },
        },
  };
}

export function buildRootJsonLd() {
  const siteUrl = absoluteUrl("/");
  const imageUrl = absoluteUrl(OG_IMAGE_PATH);
  const iconUrl = absoluteUrl(ICON_IMAGE_PATH);

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${siteUrl}#organization`,
        name: SITE_NAME,
        url: siteUrl,
        logo: {
          "@type": "ImageObject",
          url: iconUrl,
        },
      },
      {
        "@type": "WebSite",
        "@id": `${siteUrl}#website`,
        name: SITE_NAME,
        url: siteUrl,
        description: SITE_DESCRIPTION,
        inLanguage: "en",
        publisher: {
          "@id": `${siteUrl}#organization`,
        },
      },
      {
        "@type": "VideoGame",
        "@id": `${siteUrl}#game`,
        name: SITE_NAME,
        url: siteUrl,
        image: imageUrl,
        description: SITE_DESCRIPTION,
        genre: ["Strategy", "Board game", "Onchain game"],
        gamePlatform: ["Web browser", "Base App"],
        playMode: ["SinglePlayer", "MultiPlayer"],
        isAccessibleForFree: true,
        publisher: {
          "@id": `${siteUrl}#organization`,
        },
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${siteUrl}#app`,
        name: SITE_NAME,
        url: siteUrl,
        image: imageUrl,
        description: SITE_DESCRIPTION,
        applicationCategory: "GameApplication",
        operatingSystem: "Web, iOS, Android",
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "USD",
        },
      },
    ],
  };
}

export function stringifyJsonLd(data: Record<string, unknown>) {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
