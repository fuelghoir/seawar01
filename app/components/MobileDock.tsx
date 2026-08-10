"use client";

import { useRouter } from "next/navigation";
import { AnchorIcon, ShieldIcon, ShopIcon, TrophyIcon, UserIcon } from "./Icons";
import { TR, useSettings } from "../lib/settings";
import styles from "./MobileDock.module.css";

export type MobileDockTab = "home" | "quests" | "profile" | "shop" | "leaderboard";

type MobileDockProps = {
  active: MobileDockTab;
  onSelect?: (tab: MobileDockTab) => void;
};

export function MobileDock({ active, onSelect }: MobileDockProps) {
  const router = useRouter();
  const { lang } = useSettings();
  const tr = TR[lang];

  const items: Array<{
    id: MobileDockTab;
    label: string;
    ariaLabel: string;
    href: string;
    Icon: typeof AnchorIcon;
  }> = [
    { id: "home", label: tr.mobile_home, ariaLabel: tr.mobile_home, href: "/", Icon: AnchorIcon },
    { id: "quests", label: tr.mobile_quests, ariaLabel: tr.mobile_quests, href: "/?tab=quests", Icon: ShieldIcon },
    { id: "profile", label: tr.mobile_profile, ariaLabel: tr.mobile_profile, href: "/?tab=profile", Icon: UserIcon },
    { id: "shop", label: tr.mobile_shop, ariaLabel: tr.mobile_shop, href: "/shop", Icon: ShopIcon },
    {
      id: "leaderboard",
      label: lang === "ru" ? "\u0422\u043e\u043f" : "Ranks",
      ariaLabel: tr.home_leaderboard,
      href: "/leaderboard",
      Icon: TrophyIcon,
    },
  ];

  const select = (item: (typeof items)[number]) => {
    if (onSelect) {
      onSelect(item.id);
      return;
    }
    router.push(item.href);
  };

  return (
    <nav className={styles.dock} aria-label={lang === "ru" ? "\u041e\u0441\u043d\u043e\u0432\u043d\u0430\u044f \u043d\u0430\u0432\u0438\u0433\u0430\u0446\u0438\u044f" : "Primary navigation"}>
      {items.map(({ id, label, ariaLabel, Icon, ...item }) => (
        <button
          data-tour={id === "quests" ? "quests" : id === "shop" ? "shop" : undefined}
          key={id}
          className={`${styles.item} ${active === id ? styles.active : ""}`}
          onClick={() => select({ id, label, ariaLabel, Icon, ...item })}
          type="button"
          aria-label={ariaLabel}
          aria-current={active === id ? "page" : undefined}
        >
          <Icon size={20} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
