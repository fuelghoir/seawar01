"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../lib/supabase";
import styles from "./EmojiReactions.module.css";

const EMOJIS = ["⚓", "💥", "🔥", "💀", "😤", "🤣", "😱", "🫡", "👑", "🌊"];

interface FloatingEmoji {
  id: number;
  emoji: string;
  x: number;
  fromMe: boolean;
}

interface Props {
  gameId: number;
  playerNum: number; // 1 or 2
}

let eid = 0;

export function EmojiReactions({ gameId, playerNum }: Props) {
  const [floating, setFloating] = useState<FloatingEmoji[]>([]);
  const cooldownRef = useRef(false);

  const spawnEmoji = useCallback((emoji: string, fromMe: boolean) => {
    const id = ++eid;
    const x = 15 + Math.random() * 70; // 15–85% of screen width
    setFloating(prev => [...prev, { id, emoji, x, fromMe }]);
    // Remove after animation ends (2.5s)
    setTimeout(() => {
      setFloating(prev => prev.filter(e => e.id !== id));
    }, 2500);
  }, []);

  // Subscribe to reactions from opponent
  useEffect(() => {
    const channel = supabase
      .channel(`reactions-${gameId}`)
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
          // Show all reactions (own ones already spawned optimistically)
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

    // Optimistic spawn immediately
    spawnEmoji(emoji, true);

    await supabase.from("game_reactions").insert({
      game_id: gameId,
      player_num: playerNum,
      emoji,
    });
  };

  return (
    <>
      {/* Floating emoji overlay — covers full viewport */}
      <div className={styles.overlay} aria-hidden>
        {floating.map(e => (
          <span
            key={e.id}
            className={`${styles.floater} ${e.fromMe ? styles.floaterMe : styles.floaterOpp}`}
            style={{ left: `${e.x}%` }}
          >
            {e.emoji}
          </span>
        ))}
      </div>

      {/* Emoji picker bar */}
      <div className={styles.bar}>
        {EMOJIS.map(emoji => (
          <button
            key={emoji}
            className={styles.emojiBtn}
            onClick={() => handleSend(emoji)}
            type="button"
            aria-label={emoji}
          >
            {emoji}
          </button>
        ))}
      </div>
    </>
  );
}
