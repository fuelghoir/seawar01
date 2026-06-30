import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Space_Grotesk, Orbitron, Rajdhani } from "next/font/google";
import { SafeArea } from "./components/SafeArea";
import { farcasterConfig } from "../farcaster.config";
import { Providers } from "./providers";
import { SettingsProvider } from "./lib/settings";
import {
  absoluteUrl,
  buildRootJsonLd,
  createSeoMetadata,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TITLE,
  stringifyJsonLd,
} from "./lib/seo";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const baseMetadata = createSeoMetadata({
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    path: "/",
  });
  const miniAppEmbed = {
    version: farcasterConfig.miniapp.version,
    imageUrl: farcasterConfig.miniapp.heroImageUrl,
    button: {
      title: "Play Sea Battle",
      action: {
        name: "Sea Battle",
        type: "launch_frame",
        url: farcasterConfig.miniapp.homeUrl,
      },
    },
  };

  return {
    ...baseMetadata,
    metadataBase: new URL(absoluteUrl("/")),
    applicationName: SITE_NAME,
    title: {
      default: SITE_TITLE,
      template: `%s | ${SITE_NAME}`,
    },
    description: SITE_DESCRIPTION,
    category: "games",
    icons: {
      icon: [
        { url: "/favicon.ico", sizes: "any" },
        { url: "/icon.png", type: "image/png", sizes: "1024x1024" },
      ],
      shortcut: "/favicon.ico",
      apple: [{ url: "/apple-touch-icon.png", sizes: "1024x1024", type: "image/png" }],
    },
    openGraph: baseMetadata.openGraph,
    twitter: baseMetadata.twitter,
    other: {
      "base:app_id": "69dbfc9ded56423f0cd3e692",
      "fc:frame": JSON.stringify(miniAppEmbed),
      "fc:miniapp": JSON.stringify(miniAppEmbed),
    },
  };
}

const themeInitScript = `
(() => {
  let effectsMode = "full";
  try {
    const theme = localStorage.getItem("sw_theme");
    if (/^(ocean|midnight|abyss|inferno)$/.test(theme || "")) {
      document.documentElement.setAttribute("data-theme", theme);
    }
    const effects = localStorage.getItem("sw_effects");
    if (/^(full|reduced)$/.test(effects || "")) effectsMode = effects;
  } catch {}
  document.documentElement.setAttribute("data-effects", effectsMode);
})();
`;

const rootJsonLd = stringifyJsonLd(buildRootJsonLd());

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono-raw",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-display-raw",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const orbitron = Orbitron({
  variable: "--font-orbitron",
  subsets: ["latin"],
  weight: ["400", "600", "700", "900"],
});

const rajdhani = Rajdhani({
  variable: "--font-rajdhani",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: rootJsonLd }}
        />
      </head>
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} ${spaceGrotesk.variable} ${orbitron.variable} ${rajdhani.variable}`}
      >
        <Providers>
          <SettingsProvider>
            <div className="aurora" aria-hidden="true">
              <span className="aurora-blob aurora-blob--1" />
              <span className="aurora-blob aurora-blob--2" />
              <span className="aurora-blob aurora-blob--3" />
              <span className="aurora-blob aurora-blob--4" />
              <span className="aurora-blob aurora-blob--5" />
            </div>
            <SafeArea>{children}</SafeArea>
          </SettingsProvider>
        </Providers>
      </body>
    </html>
  );
}
