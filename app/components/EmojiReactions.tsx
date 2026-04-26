"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../lib/supabase";
import styles from "./EmojiReactions.module.css";

const EMOJIS = ["🤣", "😂", "💀", "🤡", "🫠", "😭", "🤦", "🙈", "🫵", "💩"];

interface FloatingEmoji {
  id: number;
  emoji: string;
  x: number;    // % from left
  fromMe: boolean;
}

interface Props {
  gameId: number;
  playerNum: number; // 1 or 2
}

let eid = 0;

export function EmojiReactions({ gameId, playerNum }: Props) {
  const [open, setOpen] = useState(false);
  const [floating, setFloating] = useState<FloatingEmoji[]>([]);
  const cooldownRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const spawnEmoji = useCallback((emoji: string, fromMe: boolean) => {
    const id = ++eid;
    const x = 20 + Math.random() * 60; // 20–80% of viewport width
    setFloating(prev => [...prev, { id, emoji, x, fromMe }]);
    setTimeout(() => setFloating(prev => prev.filter(e => e.id !== id)), 2600);
  }, []);

  // Close picker when clicking outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Subscribe to opponent reactions via Supabase Realtime
  // ⚠️ Requires: ALTER PUBLICATION supabase_realtime ADD TABLE game_reactions;
  //              ALTER TABLE game_reactions REPLICA IDENTITY FULL;
  useEffect(() => {
    const channel = supabase
      .channel(`emoji-${gameId}-${playerNum}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "game_reactions",
          filter: `game_id=eq.${gameId}`,
        },
        (payload) => {
          const row = payload.new as { player_num: number; emoji: string };
          if (row.player_num !== playerNum) {
            spawnEmoji(row.emoji, false);
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [gameId, playerNum, spawnEmoji]);

  const handleSend = async (emoji: string) => {
    if (cooldownRef.current) return;
    cooldownRef.current = true;
    setTimeout(() => { cooldownRef.current = false; }, 1500);

    setOpen(false);
    spawnEmoji(emoji, true); // optimistic

    await supabase.from("game_reactions").insert({
      game_id: gameId,
      player_num: playerNum,
      emoji,
    });
  };

  return (
    <>
      {/* Full-viewport overlay for floating emojis — never blocks clicks */}
      <div className={styles.overlay} aria-hidden>
        {floating.map(e => (
          <span
            key={e.id}
            className={`${styles.floater} ${e.fromMe ? styles.floaterMe : `${styles.floaterOpp} ${styles.floaterOppBig}`}`}
            style={{ left: `${e.x}%` }}
          >
            {e.emoji}
          </span>
        ))}
      </div>

      {/* Left-side toggle button + picker */}
      <div ref={containerRef} className={styles.container}>
        <button
          className={`${styles.toggle} ${open ? styles.toggleOpen : ""}`}
          onClick={() => setOpen(v => !v)}
          type="button"
          title="Emoji reactions"
        >
          <span className={styles.toggleIcon}>💬</span>
        </button>

        {open && (
          <div className={styles.picker}>
            {EMOJIS.map(emoji => (
              <button
                key={emoji}
                className={styles.emojiBtn}
                onClick={() => handleSend(emoji)}
                type="button"
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
