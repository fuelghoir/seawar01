const fs = require('fs');
let c = fs.readFileSync('app/api/admin/drops/route.ts', 'utf8');

c = c.replace(/const admin = adminSupabase\(\);[\s\S]*?row\.totalCheckins >= minCheckins,\s*\);/m, 
`    const admin = adminSupabase();
    let allWallets: { wallet: string; points: bigint; gamesPlayed: number; totalCheckins: number; transactions: number; }[] = [];

    if (pointsSource === "season_current") {
      const seasonConfig = await admin.from("season_config").select("season_key").eq("id", "default").single();
      const seasonKey = seasonConfig.data?.season_key || "S1";

      const [statsRes, seasonRes] = await Promise.all([
        admin.from("player_stats").select("wallet,games_played,total_checkins").limit(100000),
        admin.from("season_progress").select("wallet,xp").eq("season_key", seasonKey).gte("xp", minPoints).limit(100000)
      ]);

      if (seasonRes.error) return NextResponse.json({ error: seasonRes.error.message }, { status: 500 });
      if (statsRes.error) return NextResponse.json({ error: statsRes.error.message }, { status: 500 });

      const statsMap = new Map();
      for (const row of statsRes.data || []) {
        statsMap.set(String(row.wallet).toLowerCase(), row);
      }

      for (const row of seasonRes.data || []) {
        const w = String(row.wallet).toLowerCase();
        const stat = statsMap.get(w);
        const gamesPlayed = Math.max(0, Math.floor(Number(stat?.games_played ?? 0)));
        const totalCheckins = Math.max(0, Math.floor(Number(stat?.total_checkins ?? 0)));
        const transactions = gamesPlayed + totalCheckins;
        allWallets.push({
          wallet: w,
          points: BigInt(Math.max(0, Math.floor(Number(row.xp ?? 0)))),
          gamesPlayed,
          totalCheckins,
          transactions
        });
      }
    } else {
      const stats = await admin
        .from("player_stats")
        .select("wallet,points,games_played,total_checkins")
        .gte("points", minPoints)
        .limit(100000);

      if (stats.error) return NextResponse.json({ error: stats.error.message }, { status: 500 });

      for (const row of stats.data || []) {
        const gamesPlayed = Math.max(0, Math.floor(Number(row.games_played ?? 0)));
        const totalCheckins = Math.max(0, Math.floor(Number(row.total_checkins ?? 0)));
        const transactions = gamesPlayed + totalCheckins;
        allWallets.push({
          wallet: String(row.wallet).toLowerCase(),
          points: BigInt(Math.max(0, Math.floor(Number(row.points ?? 0)))),
          gamesPlayed,
          totalCheckins,
          transactions
        });
      }
    }

    const rows = allWallets.filter(
      (row) =>
        ADDR_RE.test(row.wallet) &&
        row.points >= BigInt(minPoints) &&
        row.transactions >= minTransactions &&
        row.totalCheckins >= minCheckins,
    );`
);

fs.writeFileSync('app/api/admin/drops/route.ts', c);
