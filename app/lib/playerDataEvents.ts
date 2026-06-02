"use client";

export const PLAYER_DATA_REFRESH_EVENT = "seabattle:player-data-refresh";

export function notifyPlayerDataRefresh() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(PLAYER_DATA_REFRESH_EVENT));
}
