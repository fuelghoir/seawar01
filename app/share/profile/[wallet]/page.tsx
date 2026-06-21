import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  buildPublicReferralUrl,
  getPublicAppUrl,
  normalizePublicWallet,
  shortWallet,
} from "../../../lib/publicUrl";
import { emptyShareProfile, getShareProfileStats } from "../../../lib/shareProfileServer";

type Params = Promise<{ wallet: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({
  params,
}: {
  params: Params;
  searchParams?: SearchParams;
}): Promise<Metadata> {
  const { wallet: rawWallet } = await params;
  const wallet = normalizePublicWallet(rawWallet);
  const baseUrl = getPublicAppUrl();
  const imageUrl = wallet
    ? `${baseUrl}/api/share-card/profile/${wallet}`
    : `${baseUrl}/hero.png`;
  const profile = wallet
    ? await getShareProfileStats(wallet).catch(() => emptyShareProfile(wallet))
    : emptyShareProfile(rawWallet);
  const title = `My Sea Battle Stats - ${profile.points.toLocaleString("en-US")} PTS`;
  const description = `${profile.wins.toLocaleString("en-US")} wins - ${profile.shots.toLocaleString("en-US")} shots - ${profile.streak}d streak`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      url: wallet ? buildPublicReferralUrl(wallet, `/share/profile/${wallet}`) : baseUrl,
      images: [
        {
          url: imageUrl,
          width: 1200,
          height: 630,
          alt: title,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [imageUrl],
    },
  };
}

export default async function ShareProfilePage({ params }: { params: Params }) {
  const { wallet: rawWallet } = await params;
  const wallet = normalizePublicWallet(rawWallet);
  const profile = wallet
    ? await getShareProfileStats(wallet).catch(() => emptyShareProfile(wallet))
    : emptyShareProfile(rawWallet);
  const referralUrl = wallet ? buildPublicReferralUrl(wallet) : getPublicAppUrl();
  const imageUrl = wallet ? `/api/share-card/profile/${wallet}` : "/hero.png";

  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        background:
          "radial-gradient(circle at 20% 0%, rgba(0,220,180,0.22), transparent 34%), linear-gradient(135deg, #04111f, #160d2d)",
        color: "#eef7ff",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <section
        style={{
          width: "min(920px, 100%)",
          display: "flex",
          flexDirection: "column",
          gap: 18,
          padding: 20,
          border: "1px solid rgba(0,245,212,0.22)",
          borderRadius: 24,
          background: "rgba(2, 8, 20, 0.58)",
          boxShadow: "0 24px 70px rgba(0,0,0,0.42)",
        }}
      >
        <Image
          src={imageUrl}
          alt="Sea Battle profile stats"
          width={1200}
          height={630}
          unoptimized
          style={{
            width: "100%",
            height: "auto",
            borderRadius: 18,
            border: "1px solid rgba(255,255,255,0.12)",
          }}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <p style={{ margin: 0, color: "#00f5d4", fontWeight: 900, letterSpacing: 2 }}>
            SEA BATTLE PROFILE
          </p>
          <h1 style={{ margin: 0, fontSize: 34 }}>
            {shortWallet(profile.wallet)} - {profile.points.toLocaleString("en-US")} PTS
          </h1>
          <p style={{ margin: 0, color: "rgba(238,247,255,0.72)", fontSize: 18 }}>
            {profile.wins.toLocaleString("en-US")} wins - {profile.shots.toLocaleString("en-US")} shots - {profile.streak}d streak
          </p>
        </div>
        <Link
          href={referralUrl}
          style={{
            minHeight: 48,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 14,
            background: "linear-gradient(90deg, #00f5d4, #8b5cf6)",
            color: "#04111f",
            textDecoration: "none",
            fontWeight: 900,
            letterSpacing: 1,
          }}
        >
          Play with my invite link
        </Link>
      </section>
    </main>
  );
}
