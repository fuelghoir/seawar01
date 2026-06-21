import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";
import { buildPublicReferralUrl, normalizePublicWallet, shortWallet } from "../../../../lib/publicUrl";
import { emptyShareProfile, getShareProfileStats } from "../../../../lib/shareProfileServer";

/* eslint-disable @next/next/no-img-element */

export const runtime = "edge";

type Params = Promise<{ wallet: string }>;

const size = {
  width: 1200,
  height: 630,
};

export async function GET(req: NextRequest, { params }: { params: Params }) {
  const { wallet: rawWallet } = await params;
  const wallet = normalizePublicWallet(rawWallet);
  const profile = wallet
    ? await getShareProfileStats(wallet).catch(() => emptyShareProfile(wallet))
    : emptyShareProfile(rawWallet);
  const referralUrl = buildPublicReferralUrl(profile.wallet);
  const referralDisplay = `${new URL(referralUrl).host}/?ref=${shortWallet(profile.wallet)}`;
  const logoUrl = new URL("/logo.png", req.url).toString();
  const pnl = profile.earningsUsdc >= 0
    ? `+${profile.earningsUsdc.toFixed(2)} USDC`
    : `${profile.earningsUsdc.toFixed(2)} USDC`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 54,
          color: "#eef7ff",
          background:
            "radial-gradient(circle at 15% 0%, rgba(0, 220, 180, 0.32), transparent 33%), radial-gradient(circle at 78% 24%, rgba(168, 85, 247, 0.34), transparent 36%), linear-gradient(135deg, #04111f 0%, #08172a 44%, #180d2d 100%)",
          fontFamily: "Arial, sans-serif",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                color: "#00f5d4",
                fontSize: 26,
                fontWeight: 800,
                letterSpacing: 5,
              }}
            >
              <span>SEA BATTLE</span>
              <span style={{ color: "#8b5cf6" }}>ON BASE</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <div style={{ display: "flex", fontSize: 64, fontWeight: 900, letterSpacing: 2 }}>
                MY SEA BATTLE STATS
              </div>
              <div style={{ display: "flex", color: "rgba(238,247,255,0.68)", fontSize: 30, fontWeight: 700 }}>
                {shortWallet(profile.wallet)} - onchain battleship
              </div>
            </div>
          </div>

          <div
            style={{
              width: 148,
              height: 148,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 34,
              border: "2px solid rgba(0, 245, 212, 0.55)",
              background:
                "linear-gradient(135deg, rgba(0,245,212,0.28), rgba(139,92,246,0.24))",
              color: "#03111f",
            }}
          >
            <img
              src={logoUrl}
              width={126}
              height={126}
              alt="Sea Battle"
              style={{
                width: 126,
                height: 126,
                objectFit: "contain",
              }}
            />
          </div>
        </div>

        <div style={{ display: "flex", gap: 18 }}>
          <Stat label="PTS" value={profile.points.toLocaleString("en-US")} accent="#00f5d4" large />
          <Stat label="WINS" value={profile.wins.toLocaleString("en-US")} accent="#ffd166" />
          <Stat label="SHOTS" value={profile.shots.toLocaleString("en-US")} accent="#38bdf8" />
          <Stat label="STREAK" value={`${profile.streak}d`} accent="#a78bfa" />
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 24 }}>
          <div style={{ display: "flex", gap: 14 }}>
            <Pill label="GAMES" value={profile.games.toLocaleString("en-US")} />
            <Pill label="P&L" value={pnl} />
            <Pill label="CHECK-INS" value={profile.checkins.toLocaleString("en-US")} />
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "15px 20px",
              borderRadius: 18,
              border: "1px solid rgba(255,255,255,0.18)",
              background: "rgba(255,255,255,0.08)",
              color: "#ffffff",
              fontSize: 24,
              fontWeight: 800,
            }}
          >
            {referralDisplay}
          </div>
        </div>
      </div>
    ),
    size,
  );
}

function Stat({
  label,
  value,
  accent,
  large = false,
}: {
  label: string;
  value: string;
  accent: string;
  large?: boolean;
}) {
  return (
    <div
      style={{
        flex: large ? 1.4 : 1,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 8,
        padding: "25px 28px",
        borderRadius: 26,
        border: `1px solid ${accent}66`,
        background: "rgba(2, 8, 20, 0.58)",
      }}
    >
      <div style={{ display: "flex", color: accent, fontSize: 23, fontWeight: 900, letterSpacing: 3 }}>
        {label}
      </div>
      <div style={{ display: "flex", color: "#fff", fontSize: large ? 56 : 48, fontWeight: 900 }}>
        {value}
      </div>
    </div>
  );
}

function Pill({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "13px 17px",
        borderRadius: 999,
        border: "1px solid rgba(0,245,212,0.22)",
        background: "rgba(0,245,212,0.08)",
        color: "rgba(238,247,255,0.84)",
        fontSize: 21,
        fontWeight: 800,
      }}
    >
      <span style={{ color: "rgba(238,247,255,0.52)" }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}
