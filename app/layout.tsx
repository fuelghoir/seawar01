import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Space_Grotesk, Orbitron, Rajdhani } from "next/font/google";
import { SafeArea } from "./components/SafeArea";
import { farcasterConfig } from "../farcaster.config";
import { Providers } from "./providers";
import { SettingsProvider } from "./lib/settings";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
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
    title: farcasterConfig.miniapp.name,
    description: farcasterConfig.miniapp.description,
    other: {
      "base:app_id": "69dbfc9ded56423f0cd3e692",
      "fc:frame": JSON.stringify(miniAppEmbed),
      "fc:miniapp": JSON.stringify(miniAppEmbed),
    },
  };
}

const themeInitScript = `
(() => {
  try {
    const theme = localStorage.getItem("sw_theme");
    if (/^(ocean|midnight|abyss|inferno)$/.test(theme || "")) {
      document.documentElement.setAttribute("data-theme", theme);
    }
  } catch {}
})();
`;

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
