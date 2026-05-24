"use client";

import { ComponentType, ReactNode } from "react";
import { ChevronRightIcon } from "./Icons";
import styles from "./HomeCard.module.css";

interface HomeCardProps {
  Icon?: ComponentType<{ size?: number }>;
  media?: ReactNode;
  title: string;
  subtitle?: string;
  badge?: string;
  accent?: string;
  active?: boolean;
  onClick?: () => void;
  children?: ReactNode;
}

export function HomeCard({
  Icon,
  media,
  title,
  subtitle,
  badge,
  accent = "#00dcb4",
  active = false,
  onClick,
  children,
}: HomeCardProps) {
  return (
    <div
      onClick={onClick}
      className={[
        styles.card,
        active && styles.cardActive,
        onClick && styles.cardClickable,
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ ["--accent" as string]: accent }}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
    >
      {media ? (
        <div className={styles.mediaWrap}>
          {media}
        </div>
      ) : Icon && (
        <div className={styles.iconWrap}>
          <Icon size={20} />
        </div>
      )}
      <div className={styles.body}>
        <div className={styles.titleRow}>
          <span className={styles.title}>{title}</span>
          {badge && <span className={styles.badge}>{badge}</span>}
        </div>
        {subtitle && <div className={styles.subtitle}>{subtitle}</div>}
        {children}
      </div>
      {onClick && (
        <span className={styles.chevron}>
          <ChevronRightIcon size={16} />
        </span>
      )}
    </div>
  );
}
