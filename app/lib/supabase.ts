import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export interface OffchainGame {
  id: number;
  player1: string;
  player2: string | null;
  state: number;
  current_turn: number;
  turn_phase: number;
  player1_hits: number;
  player2_hits: number;
  player1_board_hash: string | null;
  player2_board_hash: string | null;
  last_shot_x: number | null;
  last_shot_y: number | null;
  last_shooter: string | null;
  winner: string | null;
  is_private: boolean;
  created_at: string;
}

export interface OffchainShot {
  id: number;
  game_id: number;
  player_num: number;
  x: number;
  y: number;
  is_hit: boolean | null;
  created_at: string;
}
