"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useState,
  type CSSProperties,
} from "react";
import styles from "./MissionGuide.module.css";

type TargetRect = {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

export type MissionGuideProps = {
  target?: string;
  eyebrow: string;
  title: string;
  body: string;
  step: number;
  total: number;
  primaryLabel?: string;
  onPrimary?: () => void;
  skipLabel: string;
  onSkip: () => void;
  busy?: boolean;
  error?: string;
  reducedMotion?: boolean;
};

export function MissionGuide({
  target,
  eyebrow,
  title,
  body,
  step,
  total,
  primaryLabel,
  onPrimary,
  skipLabel,
  onSkip,
  busy = false,
  error = "",
  reducedMotion = false,
}: MissionGuideProps) {
  const titleId = useId();
  const bodyId = useId();
  const [rect, setRect] = useState<TargetRect | null>(null);
  const [viewportHeight, setViewportHeight] = useState(0);

  const locate = useCallback(() => {
    setViewportHeight(window.visualViewport?.height ?? window.innerHeight);
    if (!target) {
      setRect(null);
      return;
    }

    let elements: HTMLElement[] = [];
    try {
      elements = Array.from(document.querySelectorAll<HTMLElement>(target));
    } catch {
      setRect(null);
      return;
    }

    const element = elements.find((node) => {
      const box = node.getBoundingClientRect();
      const computed = window.getComputedStyle(node);
      return box.width > 0 && box.height > 0 &&
        computed.display !== "none" && computed.visibility !== "hidden";
    });
    if (!element) {
      setRect(null);
      return;
    }

    const box = element.getBoundingClientRect();
    const gap = 9;
    const left = Math.max(0, box.left - gap);
    const top = Math.max(0, box.top - gap);
    const right = Math.min(window.innerWidth, box.right + gap);
    const bottom = Math.min(window.innerHeight, box.bottom + gap);
    setRect({
      top,
      left,
      right,
      bottom,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top),
    });
  }, [target]);

  useLayoutEffect(() => {
    if (!target) {
      locate();
      return;
    }

    let element: HTMLElement | null = null;
    try {
      element = Array.from(document.querySelectorAll<HTMLElement>(target)).find((node) => {
        const box = node.getBoundingClientRect();
        return box.width > 0 && box.height > 0;
      }) ?? null;
    } catch {
      element = null;
    }
    element?.scrollIntoView({
      behavior: reducedMotion ? "auto" : "smooth",
      block: "center",
      inline: "nearest",
    });

    const timers = [80, 280, 700].map((delay) => window.setTimeout(locate, delay));
    return () => timers.forEach(window.clearTimeout);
  }, [locate, reducedMotion, target]);

  useEffect(() => {
    let frame = 0;
    const schedule = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(locate);
    };
    const resizeObserver = new ResizeObserver(schedule);
    const mutationObserver = new MutationObserver(schedule);

    let element: HTMLElement | null = null;
    if (target) {
      try {
        element = document.querySelector<HTMLElement>(target);
      } catch {
        element = null;
      }
    }
    if (element) resizeObserver.observe(element);
    mutationObserver.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    schedule();

    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
    };
  }, [locate, target]);

  const panelAtTop = Boolean(rect && rect.top > Math.max(420, viewportHeight * 0.52));
  const progress = Math.max(0, Math.min(100, (step / Math.max(1, total)) * 100));

  return (
    <div
      className={`${styles.root} ${reducedMotion ? styles.reducedMotion : ""}`}
      role="dialog"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
    >
      {rect ? (
        <>
          <div className={styles.shade} style={{ top: 0, left: 0, right: 0, height: rect.top }} />
          <div className={styles.shade} style={{ top: rect.bottom, left: 0, right: 0, bottom: 0 }} />
          <div className={styles.shade} style={{ top: rect.top, left: 0, width: rect.left, height: rect.height }} />
          <div className={styles.shade} style={{ top: rect.top, left: rect.right, right: 0, height: rect.height }} />
          <div
            className={styles.focus}
            style={{
              top: rect.top,
              left: rect.left,
              width: rect.width,
              height: rect.height,
            }}
            aria-hidden="true"
          >
            <span className={styles.cornerA} />
            <span className={styles.cornerB} />
            <span className={styles.beacon}><i /></span>
          </div>
        </>
      ) : (
        <div className={`${styles.shade} ${styles.fullShade}`} />
      )}

      <section className={`${styles.panel} ${panelAtTop ? styles.panelTop : ""}`}>
        <div className={styles.chartMeta} aria-hidden="true">
          <span>RECRUIT / {String(step).padStart(2, "0")}</span>
          <span>SONAR LINK</span>
        </div>

        <div className={styles.headingRow}>
          <span className={styles.missionMark} aria-hidden="true"><i /></span>
          <div>
            <span className={styles.eyebrow}>{eyebrow}</span>
            <h2 id={titleId}>{title}</h2>
          </div>
          <span className={styles.stepCount}>{step}<small>/{total}</small></span>
        </div>

        <p id={bodyId}>{body}</p>

        <div className={styles.progressTrack} aria-hidden="true">
          <span style={{ "--mission-progress": `${progress}%` } as CSSProperties} />
        </div>

        <div className={styles.actions}>
          {primaryLabel && onPrimary && (
            <button className={styles.primary} type="button" onClick={onPrimary} disabled={busy}>
              <span>{primaryLabel}</span>
              <svg viewBox="0 0 18 18" aria-hidden="true">
                <path d="M3 9h11m-4-4 4 4-4 4" />
              </svg>
            </button>
          )}
          <button className={styles.skip} type="button" onClick={onSkip} disabled={busy}>
            {skipLabel}
          </button>
        </div>
        {error && <div className={styles.error} role="alert">{error}</div>}
      </section>
    </div>
  );
}
