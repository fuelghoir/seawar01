"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";

export type Theme = "ocean" | "midnight" | "abyss" | "inferno";
export type Lang = "en" | "ru";

interface SettingsCtx {
  theme: Theme;
  lang: Lang;
  setTheme: (t: Theme) => void;
  setLang: (l: Lang) => void;
}

const Ctx = createContext<SettingsCtx>({
  theme: "ocean", lang: "en",
  setTheme: () => {}, setLang: () => {},
});

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("ocean");
  const [lang, setLangState] = useState<Lang>("en");

  useEffect(() => {
    const t = localStorage.getItem("sw_theme") as Theme | null;
    const l = localStorage.getItem("sw_lang") as Lang | null;
    if (t) setThemeState(t);
    if (l) setLangState(l);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const setTheme = (t: Theme) => {
    setThemeState(t);
    localStorage.setItem("sw_theme", t);
  };

  const setLang = (l: Lang) => {
    setLangState(l);
    localStorage.setItem("sw_lang", l);
  };

  return <Ctx.Provider value={{ theme, lang, setTheme, setLang }}>{children}</Ctx.Provider>;
}

export const useSettings = () => useContext(Ctx);

export const THEMES: { id: Theme; label: string; color: string }[] = [
  { id: "ocean",    label: "Ocean",    color: "#00d4ff" },
  { id: "midnight", label: "Midnight", color: "#b47fff" },
  { id: "abyss",    label: "Abyss",    color: "#00ff88" },
  { id: "inferno",  label: "Inferno",  color: "#ff6600" },
];

type Tr = Record<string, string>;

export const TR: Record<Lang, Tr> = {
  en: {
    subtitle_bot:    "Play vs AI. Save result onchain after the match.",
    subtitle_friend: "Play with a friend. Each captain saves their own result.",
    subtitle_wager:  "Bet USDC, winner takes 90%.",
    mode_bot:        "Bot",    mode_bot_hint:    "Solo vs AI",
    mode_friend:     "Friend", mode_friend_hint: "PvP via invite ID",
    mode_wager:      "Wager",  mode_wager_hint:  "USDC stakes",
    connect:         "Connect Wallet",
    play_bot:        "Play vs Bot",
    create_game:     "Create Game",
    join:            "Join",
    joining:         "Joining...",
    private_game:    "Private game (invite only)",
    join_by_id:      "or join by ID",
    game_id:         "Game ID",
    open_games:      "Open Games",
    no_open_games:   "No open games. Create one!",
    checkin_btn:     "Daily Check-in",
    checkin_done:    "Checked in! Streak:",
    checkin_free:    "FREE",
    leaderboard:     "Leaderboard",
    profile:         "Profile",
    wins:            "Wins",
    shots:           "Shots",
    streak:          "Streak",
    checkins:        "Check-ins",
    onchain_winrate: "Onchain winrate",
    net_pnl:         "Net P&L (wager)",
    unclaimed:       "Unclaimed Prizes",
    refundable:      "Refundable Games",
    claim:           "Claim",
    refund:          "Refund",
    footer:          "Sea Battle on Base",
    settings_title:  "Settings",
    theme_label:     "Theme",
    lang_label:      "Language",
    referrals:       "Referrals",
    referrals_sub:   "1,000 pts per player · 10% of their points",
    referrals_desc:  "Invite a player — get 1,000 pts when they play their first game, plus 10% of all their game points forever.",
    direct_link:     "Direct link",
    copy:            "Copy",
    copied_ok:       "Copied!",
    invited:         "Invited",
    playing:         "Playing",
    pending_ref:     "Pending",
    recent_games:    "Recent Games",
    hist_loading:    "Loading...",
    hist_empty:      "No finished games yet.",
  },
  ru: {
    subtitle_bot:    "Играй против ИИ. Запиши результат в блокчейн после матча.",
    subtitle_friend: "Играй с другом. Каждый капитан сохраняет свой результат.",
    subtitle_wager:  "Ставь USDC — победитель забирает 90%.",
    mode_bot:        "Бот",    mode_bot_hint:    "Соло против ИИ",
    mode_friend:     "Друг",   mode_friend_hint: "PvP по ID приглашения",
    mode_wager:      "Ставка", mode_wager_hint:  "Ставки в USDC",
    connect:         "Подключить кошелёк",
    play_bot:        "Играть с ботом",
    create_game:     "Создать игру",
    join:            "Войти",
    joining:         "Подключение...",
    private_game:    "Приватная игра (по приглашению)",
    join_by_id:      "или войти по ID",
    game_id:         "ID игры",
    open_games:      "Открытые игры",
    no_open_games:   "Нет открытых игр. Создай первым!",
    checkin_btn:     "Ежедневный чекин",
    checkin_done:    "Зачекинился! Серия:",
    checkin_free:    "БЕСПЛАТНО",
    leaderboard:     "Таблица лидеров",
    profile:         "Профиль",
    wins:            "Победы",
    shots:           "Выстрелы",
    streak:          "Серия",
    checkins:        "Чекины",
    onchain_winrate: "Ончейн винрейт",
    net_pnl:         "Прибыль/убыток",
    unclaimed:       "Невостребованные призы",
    refundable:      "Возврат ставок",
    claim:           "Получить",
    refund:          "Вернуть",
    footer:          "Sea Battle на Base",
    settings_title:  "Настройки",
    theme_label:     "Тема",
    lang_label:      "Язык",
    referrals:       "Рефералы",
    referrals_sub:   "1 000 pts за игрока · 10% с их очков",
    referrals_desc:  "Пригласи игрока — получи 1 000 pts когда он сыграет первую игру, плюс 10% от всех его игровых очков навсегда.",
    direct_link:     "Прямая ссылка",
    copy:            "Копировать",
    copied_ok:       "Скопировано!",
    invited:         "Приглашено",
    playing:         "Играют",
    pending_ref:     "Ожидают",
    recent_games:    "История игр",
    hist_loading:    "Загрузка...",
    hist_empty:      "Нет завершённых игр.",
  },
};
