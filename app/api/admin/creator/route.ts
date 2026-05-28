import { NextResponse } from "next/server";
import { adminSupabase, requireAdminSession } from "../../../lib/adminAuth";

export const runtime = "nodejs";

type PlayerStats = {
  wallet: string;
  points?: number | null;
  wins?: number | null;
  games_played?: number | null;
  total_hits?: number | null;
  total_checkins?: number | null;
};

export async function GET() {
  try {
    await requireAdminSession();
    const admin = adminSupabase();

    const [submissions, rewards, referrals, stats, activity] = await Promise.all([
      admin
        .from("creator_submissions")
        .select("id,wallet,url,status,admin_note,reviewed_by,reviewed_at,created_at,updated_at")
        .order("created_at", { ascending: false })
        .limit(250),
      admin
        .from("creator_rewards")
        .select("id,wallet,source_submission_id,reward_kind,points,item_slug,quantity,token_address,amount_raw,reward_label,tx_hash,status,admin_note,created_by,created_at")
        .order("created_at", { ascending: false })
        .limit(250),
      admin
        .from("referrals")
        .select("referrer,referee,first_game_bonus_paid_at,first_game_bonus_points,created_at")
        .limit(10000),
      admin
        .from("player_stats")
        .select("wallet,points,wins,games_played,total_hits,total_checkins")
        .limit(10000),
      admin
        .from("wallet_activity")
        .select("wallet,tx_hash,action,created_at")
        .limit(10000),
    ]);

    for (const result of [submissions, rewards, referrals, stats]) {
      if (result.error) {
        return NextResponse.json({ error: result.error.message }, { status: 500 });
      }
    }

    const statsMap = new Map<string, PlayerStats>();
    for (const row of (stats.data ?? []) as PlayerStats[]) {
      statsMap.set(row.wallet.toLowerCase(), row);
    }

    const txCount = new Map<string, number>();
    for (const row of activity.error ? [] : (activity.data ?? [])) {
      const wallet = String(row.wallet ?? "").toLowerCase();
      txCount.set(wallet, (txCount.get(wallet) ?? 0) + 1);
    }

    const creatorWallets = new Set<string>();
    for (const row of submissions.data ?? []) creatorWallets.add(String(row.wallet).toLowerCase());
    for (const row of rewards.data ?? []) creatorWallets.add(String(row.wallet).toLowerCase());
    for (const row of referrals.data ?? []) creatorWallets.add(String(row.referrer).toLowerCase());

    const referralsByCreator = new Map<string, typeof referrals.data>();
    for (const row of referrals.data ?? []) {
      const referrer = String(row.referrer).toLowerCase();
      const list = referralsByCreator.get(referrer) ?? [];
      list.push(row);
      referralsByCreator.set(referrer, list);
    }

    const creators = Array.from(creatorWallets).map((wallet) => {
      const refs = referralsByCreator.get(wallet) ?? [];
      const ownStats = statsMap.get(wallet);
      const refereeStats = refs.map((ref) => statsMap.get(String(ref.referee).toLowerCase()));
      const activeReferrals = refereeStats.filter((row) => Number(row?.games_played ?? 0) > 0);

      return {
        wallet,
        submissions: (submissions.data ?? []).filter((row) => String(row.wallet).toLowerCase() === wallet).length,
        pendingSubmissions: (submissions.data ?? []).filter(
          (row) => String(row.wallet).toLowerCase() === wallet && row.status === "pending",
        ).length,
        rewards: (rewards.data ?? []).filter((row) => String(row.wallet).toLowerCase() === wallet).length,
        referrals: refs.length,
        activeReferrals: activeReferrals.length,
        referralGames: refereeStats.reduce((sum, row) => sum + Number(row?.games_played ?? 0), 0),
        referralWins: refereeStats.reduce((sum, row) => sum + Number(row?.wins ?? 0), 0),
        referralPoints: refereeStats.reduce((sum, row) => sum + Number(row?.points ?? 0), 0),
        referralTxs: refs.reduce(
          (sum, ref) => sum + Number(txCount.get(String(ref.referee).toLowerCase()) ?? 0),
          0,
        ),
        points: Number(ownStats?.points ?? 0),
        wins: Number(ownStats?.wins ?? 0),
        games: Number(ownStats?.games_played ?? 0),
        txs: Number(txCount.get(wallet) ?? 0),
      };
    }).sort((a, b) => b.referrals - a.referrals || b.submissions - a.submissions);

    return NextResponse.json({
      submissions: submissions.data ?? [],
      rewards: rewards.data ?? [],
      creators,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Admin request failed" },
      { status: 401 },
    );
  }
}
