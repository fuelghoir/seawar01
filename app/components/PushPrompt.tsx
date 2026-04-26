"use client";

import { useState, useEffect } from "react";
import styles from "./PushPrompt.module.css";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export default function PushPrompt({ address }: { address: string }) {
  const [status, setStatus] = useState<"unknown" | "granted" | "denied" | "loading">("unknown");
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      "Notification" in window &&
      "serviceWorker" in navigator &&
      VAPID_PUBLIC_KEY
    ) {
      setSupported(true);
      const perm = Notification.permission;
      if (perm === "granted") setStatus("granted");
      else if (perm === "denied") setStatus("denied");
    }
  }, []);

  const handleEnable = async () => {
    if (!VAPID_PUBLIC_KEY) return;
    setStatus("loading");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus("denied");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
      await fetch("/api/push-subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: address, subscription }),
      });
      setStatus("granted");
    } catch {
      setStatus("unknown");
    }
  };

  // Don't render if not supported, already subscribed, or explicitly denied
  if (!supported || status === "granted") return null;

  return (
    <div className={styles.prompt}>
      <div className={styles.text}>
        <span className={styles.icon}>🔔</span>
        <span>Напоминания о чек-ине</span>
      </div>
      <button
        className={`${styles.btn} ${status === "denied" ? styles.btnDenied : ""}`}
        onClick={handleEnable}
        disabled={status === "loading" || status === "denied"}
      >
        {status === "loading"
          ? "Включаем..."
          : status === "denied"
            ? "Заблокировано"
            : "Включить"}
      </button>
    </div>
  );
}
