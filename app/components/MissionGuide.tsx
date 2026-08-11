"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
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

function findVisibleTarget(selector?: string) {
  if (!selector) return null;
  try {
    return Array.from(document.querySelectorAll<HTMLElement>(selector)).find((node) => {
      const box = node.getBoundingClientRect();
      const computed = window.getComputedStyle(node);
      return box.width > 0 && box.height > 0 &&
        computed.display !== "none" && computed.visibility !== "hidden";
    }) ?? null;
  } catch {
    return null;
  }
}

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
  const panelRef = useRef<HTMLElement>(null);
  const [rect, setRect] = useState<TargetRect | null>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [panelHeight, setPanelHeight] = useState(220);

  const locate = useCallback(() => {
    const viewport = window.visualViewport;
    const viewportWidth = viewport?.width ?? window.innerWidth;
    const nextViewportHeight = viewport?.height ?? window.innerHeight;
    setViewportWidth(viewportWidth);
    setViewportHeight(nextViewportHeight);

    const element = findVisibleTarget(target);
    if (!element) {
      setRect(null);
      return;
    }

    const box = element.getBoundingClientRect();
    const gap = 8;
    const viewportInset = 4;
    const left = Math.max(viewportInset, box.left - gap);
    const top = Math.max(viewportInset, box.top - gap);
    const right = Math.min(viewportWidth - viewportInset, box.right + gap);
    const bottom = Math.min(nextViewportHeight - viewportInset, box.bottom + gap);
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
    const element = findVisibleTarget(target);
    if (element) {
      const box = element.getBoundingClientRect();
      const viewportHeightNow = window.visualViewport?.height ?? window.innerHeight;
      const visibleHeight = Math.max(0, Math.min(box.bottom, viewportHeightNow) - Math.max(box.top, 0));
      const visibleRatio = box.height > 0 ? visibleHeight / box.height : 1;
      const systemReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (visibleRatio < 0.75) {
        element.scrollIntoView({
          behavior: reducedMotion || systemReduced ? "auto" : "smooth",
          block: "center",
          inline: "nearest",
        });
      }
    }

    const timers = [0, 180, 520].map((delay) => window.setTimeout(locate, delay));
    return () => timers.forEach(window.clearTimeout);
  }, [locate, reducedMotion, target]);

  useEffect(() => {
    let frame = 0;
    let observedTarget: HTMLElement | null = null;
    const targetObserver = new ResizeObserver(() => schedule());
    const panelObserver = new ResizeObserver((entries) => {
      const height = entries[0]?.contentRect.height;
      if (height) setPanelHeight(height);
      schedule();
    });
    const mutationObserver = new MutationObserver(() => bindTarget());

    const schedule = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(locate);
    };

    const bindTarget = () => {
      const next = findVisibleTarget(target);
      if (next !== observedTarget) {
        targetObserver.disconnect();
        observedTarget = next;
        if (observedTarget) targetObserver.observe(observedTarget);
      }
      if (observedTarget) {
        mutationObserver.disconnect();
      } else if (target && document.body) {
        mutationObserver.observe(document.body, { childList: true, subtree: true });
      }
      schedule();
    };

    if (panelRef.current) panelObserver.observe(panelRef.current);
    bindTarget();
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);

    return () => {
      window.cancelAnimationFrame(frame);
      targetObserver.disconnect();
      panelObserver.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
    };
  }, [locate, target]);

  useEffect(() => {
    const describedTarget = findVisibleTarget(target);
    const previousDescription = describedTarget?.getAttribute("aria-describedby") ?? null;
    describedTarget?.setAttribute("aria-describedby", bodyId);

    const keepTutorialFocus = (event: globalThis.KeyboardEvent) => {
      if (!target && event.key === "Escape") {
        event.preventDefault();
        onSkip();
        return;
      }
      if (event.key !== "Tab") return;
      const activeTarget = findVisibleTarget(target);
      const panelButtons = Array.from(
        panelRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [],
      );
      const focusable = [activeTarget, ...panelButtons].filter(
        (node): node is HTMLElement => Boolean(node && node.tabIndex >= 0),
      );
      if (focusable.length === 0) return;
      const current = focusable.indexOf(document.activeElement as HTMLElement);
      const next = event.shiftKey
        ? current <= 0 ? focusable.length - 1 : current - 1
        : current < 0 || current === focusable.length - 1 ? 0 : current + 1;
      event.preventDefault();
      focusable[next]?.focus();
    };

    document.addEventListener("keydown", keepTutorialFocus, true);
    const focusFrame = !target
      ? window.requestAnimationFrame(() => {
          panelRef.current
            ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
            ?.focus();
        })
      : 0;
    return () => {
      if (focusFrame) window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", keepTutorialFocus, true);
      if (!describedTarget) return;
      if (previousDescription) describedTarget.setAttribute("aria-describedby", previousDescription);
      else describedTarget.removeAttribute("aria-describedby");
    };
  }, [bodyId, onSkip, target]);

  const roomBelow = rect ? viewportHeight - rect.bottom : 0;
  const roomAbove = rect?.top ?? 0;
  const bottomReserve = viewportWidth <= 520 ? 104 : 32;
  const panelAtTop = Boolean(
    rect && roomBelow < panelHeight + bottomReserve && roomAbove > roomBelow,
  );
  const hasTarget = Boolean(target);

  return (
    <div
      className={`${styles.root} ${reducedMotion ? styles.reducedMotion : ""}`}
      role={hasTarget ? "region" : "dialog"}
      aria-modal={hasTarget ? undefined : true}
      aria-live="polite"
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
            style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
            aria-hidden="true"
          >
            <span className={styles.cornerTopLeft} />
            <span className={styles.cornerTopRight} />
            <span className={styles.cornerBottomLeft} />
            <span className={styles.cornerBottomRight} />
            <span className={styles.targetLabel}>TAP</span>
          </div>
        </>
      ) : (
        <div className={`${styles.shade} ${styles.fullShade}`} />
      )}

      <section ref={panelRef} className={`${styles.panel} ${panelAtTop ? styles.panelTop : ""}`}>
        <header className={styles.panelHeader}>
          <span className={styles.orderFlag}>CURRENT ORDER</span>
          <span className={styles.stepCount}>{String(step).padStart(2, "0")} / {String(total).padStart(2, "0")}</span>
        </header>

        <span className={styles.eyebrow}>{eyebrow}</span>
        <h2 id={titleId}>{title}</h2>
        <p id={bodyId}>{body}</p>

        <div className={styles.sequence} aria-label={`${step} / ${total}`}>
          {Array.from({ length: total }, (_, index) => (
            <span
              key={index}
              className={index < step ? styles.sequenceDone : ""}
              aria-hidden="true"
            />
          ))}
        </div>

        <div className={`${styles.actions} ${!primaryLabel ? styles.actionsSingle : ""}`}>
          {primaryLabel && onPrimary && (
            <button className={styles.primary} type="button" onClick={onPrimary} disabled={busy}>
              <span>{primaryLabel}</span>
              <span aria-hidden="true">→</span>
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
