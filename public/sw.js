// Sea Battle — Push Notification Service Worker

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

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch {
    // Pick a random message if payload can't be parsed
    data = CHECKIN_MESSAGES[Math.floor(Math.random() * CHECKIN_MESSAGES.length)];
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icon.png",
      badge: "/icon.png",
      tag: "checkin-reminder",
      renotify: false,
      data: { url: data.url || "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      const url = event.notification.data?.url || "/";
      for (const client of clientList) {
        if ("focus" in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
