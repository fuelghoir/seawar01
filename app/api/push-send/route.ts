import { NextRequest, NextResponse } from "next/server";
import { supabase } from "../../lib/supabase";

// Notification variants — server picks randomly for each send
const CHECKIN_MESSAGES = [
  {
    title: "Ежедневный бонус ждёт тебя!",
    body: "Зайди и забери очки чек-ина. Не ломай стрик!",
  },
  {
    title: "Море зовёт, Капитан!",
    body: "Твой ежедневный бонус готов. Заходи за наградой.",
  },
  {
    title: "Стрик под угрозой!",
    body: "Зайди сегодня, чтобы сохранить бонусный стрик.",
  },
  {
    title: "Твой флот нуждается в тебе",
    body: "Бонусные очки ждут на Sea Battle. Чек-ин уже доступен!",
  },
  {
    title: "Очки сгорят в полночь UTC",
    body: "Забери ежедневный чек-ин до конца дня.",
  },
];

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-push-secret");
  if (!secret || secret !== process.env.PUSH_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const vapidPublic = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  const vapidEmail = process.env.VAPID_EMAIL || "mailto:admin@example.com";

  if (!vapidPublic || !vapidPrivate) {
    return NextResponse.json({ error: "VAPID keys not configured. Run: npx web-push generate-vapid-keys" }, { status: 500 });
  }

  // web-push must be installed: npm install web-push
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let webPush: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    webPush = require("web-push");
  } catch {
    return NextResponse.json({ error: "web-push not installed. Run: npm install web-push" }, { status: 500 });
  }

  webPush.setVapidDetails(vapidEmail, vapidPublic, vapidPrivate);

  const today = new Date().toISOString().slice(0, 10);

  const { data: subs } = await supabase
    .from("push_subscriptions")
    .select("wallet, subscription");

  if (!subs || subs.length === 0) {
    return NextResponse.json({ sent: 0, total: 0 });
  }

  const wallets = subs.map(s => s.wallet as string);
  const { data: stats } = await supabase
    .from("player_stats")
    .select("wallet, last_checkin")
    .in("wallet", wallets);

  const checkedInToday = new Set(
    (stats || [])
      .filter(s => s.last_checkin === today)
      .map(s => s.wallet as string)
  );

  const eligible = subs.filter(s => !checkedInToday.has(s.wallet as string));
  const msg = CHECKIN_MESSAGES[Math.floor(Math.random() * CHECKIN_MESSAGES.length)];
  const payload = JSON.stringify({ ...msg, url: "/" });

  let sent = 0;
  const expired: string[] = [];

  for (const sub of eligible) {
    try {
      await webPush.sendNotification(sub.subscription, payload);
      sent++;
    } catch (err: unknown) {
      if ((err as { statusCode?: number }).statusCode === 410) {
        expired.push(sub.wallet as string);
      }
    }
  }

  if (expired.length > 0) {
    await supabase.from("push_subscriptions").delete().in("wallet", expired);
  }

  return NextResponse.json({ sent, total: eligible.length, expired: expired.length });
}
