import React, {CSSProperties, ReactNode} from "react";
import {
  AbsoluteFill,
  Easing,
  Img,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import "./global.css";

const C = {
  void: "#020812",
  navy: "#061421",
  panel: "rgba(7, 24, 38, 0.82)",
  panelStrong: "#081b2b",
  line: "rgba(88, 191, 226, 0.22)",
  ice: "#ecfbff",
  body: "#9cbad0",
  muted: "#5f8298",
  cyan: "#12d8ff",
  aqua: "#54f2cf",
  blue: "#2b77ff",
  violet: "#8a72ff",
  coral: "#ff557f",
  gold: "#f7bd4d",
};

const mono: CSSProperties = {
  fontFamily: '"IBM Plex Mono", Consolas, monospace',
  letterSpacing: "0.14em",
  textTransform: "uppercase",
};

const clamp = {
  extrapolateLeft: "clamp" as const,
  extrapolateRight: "clamp" as const,
};

const asset = (name: string) => staticFile(name);

const fmt = (value: number, digits = 0) =>
  new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);

const useReveal = (delay = 0, distance = 46) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const progress = spring({
    frame: Math.max(0, frame - delay),
    fps,
    config: {damping: 26, stiffness: 150, mass: 0.85},
    durationInFrames: 30,
  });

  return {
    opacity: interpolate(frame, [delay, delay + 10], [0, 1], clamp),
    transform: `translateY(${(1 - progress) * distance}px)`,
  } satisfies CSSProperties;
};

const useCounter = (
  target: number,
  delay = 0,
  duration = 38,
  digits = 0,
) => {
  const frame = useCurrentFrame();
  const progress = interpolate(
    frame,
    [delay, delay + duration],
    [0, 1],
    {...clamp, easing: Easing.out(Easing.cubic)},
  );
  return fmt(target * progress, digits);
};

const AmbientGrid: React.FC = () => {
  const frame = useCurrentFrame();
  const drift = frame * 0.13;
  const sweep = (frame * 0.32) % 360;
  const dots = Array.from({length: 24}, (_, index) => ({
    x: 80 + ((index * 317) % 1760),
    y: 70 + ((index * 191) % 930),
    size: 2 + (index % 3),
    phase: index * 11,
  }));

  return (
    <AbsoluteFill style={{backgroundColor: C.void, overflow: "hidden"}}>
      <div
        style={{
          position: "absolute",
          inset: -120,
          backgroundImage:
            "linear-gradient(rgba(54,155,190,0.10) 1px, transparent 1px), linear-gradient(90deg, rgba(54,155,190,0.10) 1px, transparent 1px)",
          backgroundSize: "82px 82px",
          transform: `translate(${drift % 82}px, ${(drift * 0.56) % 82}px) perspective(900px) rotateX(58deg) scale(1.4)`,
          transformOrigin: "50% 100%",
          opacity: 0.62,
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 1080,
          height: 1080,
          right: -300,
          top: -420,
          borderRadius: "50%",
          background:
            "repeating-radial-gradient(circle, transparent 0 112px, rgba(18,216,255,0.13) 113px 114px), conic-gradient(from 0deg, transparent 0deg 325deg, rgba(18,216,255,0.14) 346deg, rgba(18,216,255,0.02) 360deg)",
          transform: `rotate(${sweep}deg)`,
          filter: "drop-shadow(0 0 34px rgba(18,216,255,0.08))",
          opacity: 0.8,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: -280,
          bottom: -420,
          width: 1060,
          height: 1060,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(43,119,255,0.14) 0, rgba(43,119,255,0.04) 33%, transparent 67%)",
        }}
      />
      {dots.map((dot, index) => {
        const pulse =
          0.18 +
          0.55 *
            Math.max(
              0,
              Math.sin((frame + dot.phase) * (0.045 + (index % 4) * 0.006)),
            );
        return (
          <span
            key={index}
            style={{
              position: "absolute",
              left: dot.x,
              top: dot.y,
              width: dot.size,
              height: dot.size,
              borderRadius: "50%",
              background: index % 5 === 0 ? C.violet : C.cyan,
              boxShadow: `0 0 ${10 + dot.size * 3}px currentColor`,
              color: index % 5 === 0 ? C.violet : C.cyan,
              opacity: pulse,
            }}
          />
        );
      })}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(circle at 50% 44%, transparent 0 36%, rgba(2,8,18,0.38) 78%, rgba(2,8,18,0.88) 100%)",
        }}
      />
    </AbsoluteFill>
  );
};

const FrameChrome: React.FC = () => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  const progress = frame / durationInFrames;
  const scanY = (frame * 1.35) % 1080;
  const opacity = interpolate(
    frame,
    [0, 18, durationInFrames - 45, durationInFrames - 15],
    [0, 1, 1, 0],
    clamp,
  );

  return (
    <AbsoluteFill style={{pointerEvents: "none", zIndex: 90, opacity}}>
      <div
        style={{
          position: "absolute",
          inset: 38,
          border: `1px solid ${C.line}`,
          clipPath:
            "polygon(0 0, 145px 0, 145px 1px, 100% 1px, 100% 100%, calc(100% - 145px) 100%, calc(100% - 145px) calc(100% - 1px), 0 calc(100% - 1px))",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 64,
          right: 64,
          bottom: 49,
          height: 2,
          background: "rgba(92,145,170,0.18)",
        }}
      >
        <div
          style={{
            width: `${progress * 100}%`,
            height: "100%",
            background: `linear-gradient(90deg, ${C.blue}, ${C.cyan}, ${C.aqua})`,
            boxShadow: `0 0 18px ${C.cyan}`,
          }}
        />
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: scanY,
          height: 1,
          background:
            "linear-gradient(90deg, transparent, rgba(18,216,255,0.16), transparent)",
          opacity: 0.7,
        }}
      />
    </AbsoluteFill>
  );
};

const Scene: React.FC<{
  duration: number;
  children: ReactNode;
  shade?: boolean;
}> = ({duration, children, shade = false}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(
    frame,
    [0, 16, duration - 18, duration],
    [0, 1, 1, 0],
    clamp,
  );
  const edge = interpolate(frame, [0, 28], [7, 0], {
    ...clamp,
    easing: Easing.out(Easing.cubic),
  });

  return (
    <AbsoluteFill
      style={{
        opacity,
        clipPath: `inset(${edge}% 0 ${edge}% 0)`,
        overflow: "hidden",
      }}
    >
      {shade ? (
        <AbsoluteFill
          style={{
            background:
              "linear-gradient(90deg, rgba(2,8,18,0.97) 0%, rgba(2,8,18,0.78) 52%, rgba(2,8,18,0.24) 100%)",
            zIndex: 1,
          }}
        />
      ) : null}
      <div style={{position: "absolute", inset: 0, zIndex: 2}}>{children}</div>
    </AbsoluteFill>
  );
};

const Kicker: React.FC<{children: ReactNode; color?: string}> = ({
  children,
  color = C.cyan,
}) => {
  const reveal = useReveal(2, 18);
  return (
    <div
      style={{
        ...reveal,
        display: "flex",
        alignItems: "center",
        gap: 16,
        color,
        fontSize: 15,
        fontWeight: 700,
        ...mono,
      }}
    >
      <span
        style={{
          display: "block",
          width: 52,
          height: 2,
          background: color,
          boxShadow: `0 0 12px ${color}`,
        }}
      />
      {children}
    </div>
  );
};

const Pill: React.FC<{
  children: ReactNode;
  color?: string;
  filled?: boolean;
}> = ({children, color = C.cyan, filled = false}) => (
  <span
    style={{
      display: "inline-flex",
      alignItems: "center",
      minHeight: 42,
      padding: "0 17px",
      border: `1px solid ${color}`,
      color: filled ? C.void : color,
      background: filled ? color : "rgba(4,18,30,0.72)",
      fontSize: 13,
      fontWeight: 700,
      boxShadow: filled ? `0 0 26px ${color}33` : undefined,
      ...mono,
    }}
  >
    {children}
  </span>
);

const Panel: React.FC<{
  children: ReactNode;
  style?: CSSProperties;
  color?: string;
}> = ({children, style, color = C.cyan}) => (
  <div
    style={{
      position: "relative",
      background:
        "linear-gradient(145deg, rgba(10,34,51,0.94), rgba(4,15,26,0.90))",
      border: `1px solid ${color}44`,
      boxShadow: `inset 0 1px 0 ${color}20, 0 28px 70px rgba(0,0,0,0.28)`,
      overflow: "hidden",
      ...style,
    }}
  >
    <span
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: 62,
        height: 3,
        background: color,
        boxShadow: `0 0 18px ${color}`,
      }}
    />
    <span
      style={{
        position: "absolute",
        right: -24,
        top: -24,
        width: 90,
        height: 90,
        border: `1px solid ${color}22`,
        transform: "rotate(45deg)",
      }}
    />
    {children}
  </div>
);

const HeroScene: React.FC = () => {
  const frame = useCurrentFrame();
  const title = useReveal(14, 74);
  const body = useReveal(30, 36);
  const imageScale = interpolate(frame, [0, 180], [1.08, 1.01], clamp);
  const imageX = interpolate(frame, [0, 180], [30, 0], clamp);
  const glow = 0.5 + Math.sin(frame * 0.05) * 0.14;

  return (
    <Scene duration={150} shade>
      <Img
        src={asset("grant-video/app-desktop.png")}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `translateX(${imageX}px) scale(${imageScale})`,
          filter: "brightness(0.54) saturate(1.16) contrast(1.08)",
        }}
      />
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(90deg, rgba(2,8,18,0.99) 0%, rgba(2,8,18,0.93) 35%, rgba(2,8,18,0.42) 70%, rgba(2,8,18,0.20) 100%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 138,
          top: 206,
          width: 980,
        }}
      >
        <Kicker>LIVE GAME · ONCHAIN LOOP</Kicker>
        <div style={{...title, marginTop: 34}}>
          <div
            style={{
              fontSize: 148,
              lineHeight: 0.82,
              letterSpacing: "-0.07em",
              fontWeight: 700,
              color: C.ice,
            }}
          >
            SEA
          </div>
          <div
            style={{
              fontSize: 148,
              lineHeight: 0.91,
              letterSpacing: "-0.07em",
              fontWeight: 700,
              WebkitTextStroke: `2px ${C.cyan}`,
              color: "rgba(18,216,255,0.04)",
              textShadow: `0 0 45px rgba(18,216,255,${glow * 0.42})`,
            }}
          >
            BATTLE
          </div>
        </div>
        <div
          style={{
            ...body,
            marginTop: 30,
            color: C.ice,
            fontSize: 38,
            lineHeight: 1.1,
            fontWeight: 500,
            letterSpacing: "-0.03em",
          }}
        >
          Naval strategy, rebuilt onchain.
        </div>
        <div
          style={{
            ...useReveal(44, 24),
            marginTop: 36,
            display: "flex",
            gap: 14,
          }}
        >
          <Pill filled>BUILT ON BASE</Pill>
          <Pill color={C.aqua}>PRODUCTION PRODUCT</Pill>
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          right: 118,
          bottom: 118,
          width: 262,
          height: 262,
          border: `1px solid ${C.cyan}55`,
          borderRadius: "50%",
          background:
            "repeating-radial-gradient(circle, transparent 0 54px, rgba(18,216,255,0.20) 55px 56px)",
          boxShadow: "0 0 80px rgba(18,216,255,0.10)",
        }}
      >
        <span
          style={{
            position: "absolute",
            inset: 28,
            borderRadius: "50%",
            background:
              "conic-gradient(from 0deg, transparent 0 308deg, rgba(18,216,255,0.55) 350deg, transparent 360deg)",
            transform: `rotate(${frame * 1.35}deg)`,
          }}
        />
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            style={{
              position: "absolute",
              left: 66 + index * 45,
              top: 112 + (index % 2) * 48,
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: index === 1 ? C.coral : C.cyan,
              boxShadow: `0 0 16px ${index === 1 ? C.coral : C.cyan}`,
            }}
          />
        ))}
      </div>
    </Scene>
  );
};

const ModeCard: React.FC<{
  index: string;
  title: string;
  detail: string;
  color: string;
  delay: number;
}> = ({index, title, detail, color, delay}) => {
  const reveal = useReveal(delay, 58);
  return (
    <Panel
      color={color}
      style={{
        ...reveal,
        height: 156,
        display: "grid",
        gridTemplateColumns: "118px 1fr 72px",
        alignItems: "center",
        padding: "0 26px",
      }}
    >
      <div
        style={{
          width: 74,
          height: 74,
          display: "grid",
          placeItems: "center",
          border: `1px solid ${color}66`,
          color,
          background: `${color}12`,
          fontSize: 21,
          fontWeight: 700,
          ...mono,
        }}
      >
        {index}
      </div>
      <div>
        <div
          style={{
            color: C.ice,
            fontSize: 29,
            lineHeight: 1,
            fontWeight: 700,
            letterSpacing: "-0.02em",
            textTransform: "uppercase",
          }}
        >
          {title}
        </div>
        <div
          style={{
            marginTop: 13,
            color: C.body,
            fontSize: 18,
          }}
        >
          {detail}
        </div>
      </div>
      <div
        style={{
          width: 50,
          height: 50,
          border: `1px solid ${color}55`,
          display: "grid",
          placeItems: "center",
          color,
          fontSize: 29,
        }}
      >
        →
      </div>
    </Panel>
  );
};

const ProductScene: React.FC = () => {
  const frame = useCurrentFrame();
  const phone = useReveal(12, 80);
  const phoneY = interpolate(frame, [0, 210], [-30, 12], clamp);
  return (
    <Scene duration={180}>
      <div style={{position: "absolute", left: 132, top: 152, width: 930}}>
        <Kicker color={C.aqua}>ONE PRODUCT · THREE WAYS TO PLAY</Kicker>
        <h2
          style={{
            ...useReveal(8, 50),
            margin: "24px 0 42px",
            color: C.ice,
            fontSize: 76,
            lineHeight: 0.98,
            letterSpacing: "-0.055em",
          }}
        >
          Play your way.
        </h2>
        <div style={{display: "grid", gap: 16, width: 890}}>
          <ModeCard
            index="01"
            title="Solo practice"
            detail="Fast onboarding against AI opponents."
            color={C.aqua}
            delay={24}
          />
          <ModeCard
            index="02"
            title="Private PvP"
            detail="Invite a captain and compete by link."
            color="#68a9ff"
            delay={35}
          />
          <ModeCard
            index="03"
            title="USDC stakes"
            detail="Onchain stakes with a 90% winner payout."
            color={C.gold}
            delay={46}
          />
        </div>
      </div>
      <div
        style={{
          ...phone,
          position: "absolute",
          right: 126,
          top: 108,
          width: 600,
          height: 854,
          borderRadius: 36,
          overflow: "hidden",
          border: `1px solid ${C.cyan}55`,
          background: C.navy,
          boxShadow:
            "0 45px 110px rgba(0,0,0,0.50), 0 0 70px rgba(18,216,255,0.11)",
          transform: `${phone.transform} translateY(${phoneY}px) rotate(1.5deg)`,
        }}
      >
        <Img
          src={asset("app-screenshots/02-game-modes.png")}
          style={{
            position: "absolute",
            left: 0,
            top: -410,
            width: 600,
            height: "auto",
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            boxShadow: "inset 0 0 70px rgba(2,8,18,0.50)",
          }}
        />
      </div>
    </Scene>
  );
};

const MetricCard: React.FC<{
  value: number;
  suffix?: string;
  digits?: number;
  label: string;
  detail: string;
  color: string;
  delay: number;
}> = ({value, suffix = "", digits = 0, label, detail, color, delay}) => {
  const reveal = useReveal(delay, 64);
  const count = useCounter(value, delay + 5, 42, digits);
  return (
    <Panel
      color={color}
      style={{
        ...reveal,
        height: 304,
        padding: "42px 34px 32px",
      }}
    >
      <div
        style={{
          color,
          fontSize: 66,
          lineHeight: 1,
          fontWeight: 700,
          letterSpacing: "-0.055em",
          fontVariantNumeric: "tabular-nums",
          textShadow: `0 0 26px ${color}33`,
        }}
      >
        {count}
        {suffix}
      </div>
      <div
        style={{
          marginTop: 34,
          color: C.ice,
          fontSize: 22,
          fontWeight: 700,
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
      <div
        style={{
          marginTop: 14,
          color: C.body,
          fontSize: 16,
          lineHeight: 1.45,
        }}
      >
        {detail}
      </div>
    </Panel>
  );
};

const TractionScene: React.FC = () => {
  const frame = useCurrentFrame();
  const bgScale = interpolate(frame, [0, 270], [1.06, 1.015], clamp);
  return (
    <Scene duration={210}>
      <Img
        src={asset("grant-video/stats-hero.png")}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `scale(${bgScale})`,
          filter: "brightness(0.27) saturate(0.78) blur(1px)",
          opacity: 0.72,
        }}
      />
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(2,8,18,0.72), rgba(2,8,18,0.95) 86%)",
        }}
      />
      <div style={{position: "absolute", left: 132, right: 132, top: 144}}>
        <Kicker>PRODUCTION TRACTION</Kicker>
        <div
          style={{
            ...useReveal(9, 52),
            marginTop: 23,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
          }}
        >
          <h2
            style={{
              margin: 0,
              color: C.ice,
              fontSize: 76,
              lineHeight: 1,
              letterSpacing: "-0.055em",
            }}
          >
            Real play. Real traction.
          </h2>
          <Pill color={C.muted}>SNAPSHOT THROUGH JUL 2026</Pill>
        </div>
        <div
          style={{
            marginTop: 58,
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 18,
          }}
        >
          <MetricCard
            value={1609}
            label="Games recorded"
            detail="Production game rows across solo, PvP, and wager play."
            color={C.violet}
            delay={25}
          />
          <MetricCard
            value={266}
            label="Human wallets"
            detail="Unique production wallets; system addresses excluded."
            color={C.cyan}
            delay={36}
          />
          <MetricCard
            value={58749}
            label="Shots fired"
            detail="A deep gameplay signal, not a wallet-connect vanity metric."
            color={C.coral}
            delay={47}
          />
          <MetricCard
            value={92.1}
            suffix="%"
            digits={1}
            label="Completion rate"
            detail="1,482 finished battles from 1,609 game records."
            color={C.aqua}
            delay={58}
          />
        </div>
      </div>
    </Scene>
  );
};

const JulyScene: React.FC = () => {
  const frame = useCurrentFrame();
  const games = useCounter(1023, 12, 48);
  const wallets = useCounter(62, 28, 34);
  const line = interpolate(frame, [18, 62], [0, 1], {
    ...clamp,
    easing: Easing.out(Easing.cubic),
  });
  const pulse = 0.72 + Math.sin(frame * 0.065) * 0.18;

  return (
    <Scene duration={180}>
      <div style={{position: "absolute", left: 132, top: 158}}>
        <Kicker color={C.violet}>JULY 2026 · THE CLEAR NUMBER</Kicker>
      </div>
      <div
        style={{
          position: "absolute",
          left: 136,
          top: 280,
          width: 980,
        }}
      >
        <div
          style={{
            ...useReveal(8, 76),
            color: C.ice,
            fontSize: 236,
            lineHeight: 0.83,
            fontWeight: 700,
            letterSpacing: "-0.08em",
            fontVariantNumeric: "tabular-nums",
            textShadow: `0 0 70px rgba(138,114,255,${pulse * 0.35})`,
          }}
        >
          {games}
        </div>
        <div
          style={{
            ...useReveal(22, 36),
            marginTop: 36,
            color: C.violet,
            fontSize: 39,
            fontWeight: 700,
            ...mono,
          }}
        >
          GAMES IN JULY
        </div>
        <div
          style={{
            ...useReveal(39, 24),
            marginTop: 28,
            color: C.body,
            fontSize: 24,
            maxWidth: 760,
          }}
        >
          Games played — not just wallet connections.
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 1110,
          top: 260,
          width: 2,
          height: 540 * line,
          background: `linear-gradient(${C.violet}, ${C.cyan}, transparent)`,
          boxShadow: `0 0 24px ${C.violet}`,
        }}
      />
      <div
        style={{
          ...useReveal(25, 70),
          position: "absolute",
          left: 1210,
          top: 344,
          width: 570,
        }}
      >
        <div
          style={{
            color: C.cyan,
            fontSize: 146,
            lineHeight: 0.9,
            fontWeight: 700,
            letterSpacing: "-0.065em",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {wallets}
        </div>
        <div
          style={{
            marginTop: 26,
            color: C.ice,
            fontSize: 30,
            lineHeight: 1.15,
            fontWeight: 700,
            textTransform: "uppercase",
          }}
        >
          Unique player
          <br />
          wallets
        </div>
        <div
          style={{
            marginTop: 25,
            padding: "18px 22px",
            borderLeft: `3px solid ${C.cyan}`,
            background: "rgba(18,216,255,0.07)",
            color: C.body,
            fontSize: 19,
            lineHeight: 1.4,
          }}
        >
          One wallet can create many games.
          <br />
          <strong style={{color: C.ice}}>62 counts wallets, not matches.</strong>
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 136,
          right: 136,
          bottom: 132,
          height: 2,
          transformOrigin: "left center",
          transform: `scaleX(${line})`,
          background:
            "linear-gradient(90deg, rgba(138,114,255,0.85), rgba(18,216,255,0.22), transparent)",
        }}
      />
    </Scene>
  );
};

const months = [
  {month: "APR", games: 82, color: "#2a6fff"},
  {month: "MAY", games: 176, color: "#407eff"},
  {month: "JUN", games: 328, color: C.violet},
  {month: "JUL", games: 1023, color: C.cyan},
];

const GrowthScene: React.FC = () => {
  const frame = useCurrentFrame();
  const chartProgress = interpolate(frame, [20, 95], [0, 1], {
    ...clamp,
    easing: Easing.out(Easing.cubic),
  });
  return (
    <Scene duration={180}>
      <div style={{position: "absolute", left: 132, right: 132, top: 142}}>
        <Kicker color={C.aqua}>MONTHLY GAMES · APR → JUL</Kicker>
        <div
          style={{
            ...useReveal(8, 48),
            marginTop: 22,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
          }}
        >
          <h2
            style={{
              margin: 0,
              color: C.ice,
              fontSize: 76,
              lineHeight: 1,
              letterSpacing: "-0.055em",
            }}
          >
            Momentum is accelerating.
          </h2>
          <div style={{textAlign: "right"}}>
            <div
              style={{
                color: C.cyan,
                fontSize: 72,
                lineHeight: 0.85,
                fontWeight: 700,
                letterSpacing: "-0.06em",
              }}
            >
              3.1×
            </div>
            <div
              style={{
                marginTop: 12,
                color: C.muted,
                fontSize: 13,
                fontWeight: 700,
                ...mono,
              }}
            >
              JULY VS JUNE
            </div>
          </div>
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 172,
          right: 172,
          top: 354,
          bottom: 124,
          borderLeft: `1px solid ${C.line}`,
          borderBottom: `1px solid ${C.line}`,
        }}
      >
        {[0.25, 0.5, 0.75].map((ratio) => (
          <span
            key={ratio}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: `${ratio * 100}%`,
              height: 1,
              background: "rgba(78,154,183,0.11)",
            }}
          />
        ))}
        <div
          style={{
            position: "absolute",
            inset: "0 78px 0 78px",
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 94,
            alignItems: "end",
          }}
        >
          {months.map((point, index) => {
            const delay = index * 9;
            const barProgress = interpolate(
              frame,
              [20 + delay, 92 + delay],
              [0, 1],
              {...clamp, easing: Easing.out(Easing.cubic)},
            );
            const height = (point.games / 1023) * 500 * barProgress;
            return (
              <div
                key={point.month}
                style={{
                  position: "relative",
                  height: 540,
                  display: "flex",
                  alignItems: "flex-end",
                  justifyContent: "center",
                }}
              >
                <div
                  style={{
                    position: "relative",
                    width: "100%",
                    height,
                    minHeight: 2,
                    background: `linear-gradient(180deg, ${point.color}, ${point.color}55)`,
                    boxShadow:
                      index === 3
                        ? `0 0 44px ${C.cyan}35`
                        : `0 0 24px ${point.color}22`,
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      left: 0,
                      right: 0,
                      top: -52,
                      color: index === 3 ? C.ice : point.color,
                      fontSize: 30,
                      fontWeight: 700,
                      textAlign: "center",
                      fontVariantNumeric: "tabular-nums",
                      opacity: chartProgress,
                    }}
                  >
                    {fmt(point.games)}
                  </div>
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      background:
                        "linear-gradient(90deg, rgba(255,255,255,0.12), transparent 32%, transparent 68%, rgba(0,0,0,0.16))",
                    }}
                  />
                </div>
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    bottom: -48,
                    color: index === 3 ? C.cyan : C.muted,
                    fontSize: 15,
                    fontWeight: 700,
                    textAlign: "center",
                    ...mono,
                  }}
                >
                  {point.month}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Scene>
  );
};

const EconomyMetric: React.FC<{
  value: string;
  label: string;
  color: string;
  delay: number;
}> = ({value, label, color, delay}) => (
  <Panel
    color={color}
    style={{
      ...useReveal(delay, 48),
      minHeight: 145,
      padding: "27px 29px",
    }}
  >
    <div
      style={{
        color,
        fontSize: 43,
        lineHeight: 1,
        fontWeight: 700,
        letterSpacing: "-0.045em",
      }}
    >
      {value}
    </div>
    <div
      style={{
        marginTop: 14,
        color: C.body,
        fontSize: 15,
        fontWeight: 700,
        ...mono,
      }}
    >
      {label}
    </div>
  </Panel>
);

const EconomyScene: React.FC = () => {
  const frame = useCurrentFrame();
  const shot = useReveal(10, 80);
  const floatY = Math.sin(frame * 0.035) * 9;
  return (
    <Scene duration={180}>
      <div
        style={{
          ...shot,
          position: "absolute",
          left: 128,
          top: 118,
          width: 610,
          height: 840,
          overflow: "hidden",
          border: `1px solid ${C.gold}55`,
          borderRadius: 30,
          background: C.navy,
          boxShadow:
            "0 42px 110px rgba(0,0,0,0.48), 0 0 76px rgba(247,189,77,0.09)",
          transform: `${shot.transform} translateY(${floatY}px) rotate(-1.5deg)`,
        }}
      >
        <Img
          src={asset("grant-video/shop.png")}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: "100%",
            height: "auto",
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(180deg, transparent 65%, rgba(2,8,18,0.88))",
          }}
        />
      </div>
      <div
        style={{
          position: "absolute",
          left: 850,
          top: 154,
          width: 900,
        }}
      >
        <Kicker color={C.gold}>LIVE ON BASE MAINNET</Kicker>
        <h2
          style={{
            ...useReveal(8, 52),
            margin: "23px 0 22px",
            color: C.ice,
            fontSize: 72,
            lineHeight: 1,
            letterSpacing: "-0.055em",
          }}
        >
          An onchain economy
          <br />
          already in motion.
        </h2>
        <div
          style={{
            ...useReveal(19, 30),
            color: C.body,
            fontSize: 22,
            lineHeight: 1.45,
            maxWidth: 780,
          }}
        >
          Stakes, collectibles, rewards, and progression are active product
          loops — not a future roadmap.
        </div>
        <div
          style={{
            marginTop: 38,
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: 14,
          }}
        >
          <EconomyMetric
            value="41"
            label="WAGER GAMES"
            color={C.gold}
            delay={31}
          />
          <EconomyMetric
            value="$58.10"
            label="STAKE VOLUME REPRESENTED"
            color={C.aqua}
            delay={42}
          />
          <EconomyMetric
            value="366"
            label="FLEET NFT CLAIMS"
            color={C.violet}
            delay={53}
          />
          <EconomyMetric
            value="3.17M"
            label="SEASON POINTS"
            color={C.cyan}
            delay={64}
          />
        </div>
        <div
          style={{
            ...useReveal(80, 20),
            marginTop: 22,
            padding: "13px 17px",
            border: `1px solid ${C.line}`,
            color: C.muted,
            fontSize: 11,
            ...mono,
          }}
        >
          CONTRACT · 0X8DE75FBC38B1E47E53FB2E85791C935F5F653AA6
        </div>
      </div>
    </Scene>
  );
};

const CommunityNode: React.FC<{
  value: string;
  label: string;
  x: number;
  color: string;
  delay: number;
}> = ({value, label, x, color, delay}) => {
  const reveal = useReveal(delay, 55);
  return (
    <div
      style={{
        ...reveal,
        position: "absolute",
        left: x,
        top: 395,
        width: 280,
        height: 250,
        textAlign: "center",
      }}
    >
      <div
        style={{
          width: 142,
          height: 142,
          margin: "0 auto",
          borderRadius: "50%",
          display: "grid",
          placeItems: "center",
          border: `1px solid ${color}88`,
          color,
          background: `radial-gradient(circle, ${color}18, rgba(5,20,33,0.95) 68%)`,
          boxShadow: `0 0 45px ${color}1d`,
          fontSize: 48,
          fontWeight: 700,
          letterSpacing: "-0.05em",
        }}
      >
        {value}
      </div>
      <div
        style={{
          marginTop: 24,
          color: C.ice,
          fontSize: 17,
          fontWeight: 700,
          ...mono,
        }}
      >
        {label}
      </div>
    </div>
  );
};

const CommunityScene: React.FC = () => {
  const frame = useCurrentFrame();
  const pathProgress = interpolate(frame, [20, 112], [0, 1], {
    ...clamp,
    easing: Easing.inOut(Easing.cubic),
  });
  const tokenX = 224 + pathProgress * 1410;
  return (
    <Scene duration={150}>
      <div style={{position: "absolute", left: 132, right: 132, top: 155}}>
        <Kicker color={C.coral}>THE COMMUNITY LOOP</Kicker>
        <div
          style={{
            ...useReveal(8, 48),
            marginTop: 22,
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
          }}
        >
          <h2
            style={{
              margin: 0,
              color: C.ice,
              fontSize: 76,
              lineHeight: 1,
              letterSpacing: "-0.055em",
            }}
          >
            Play. Share. Create. Earn.
          </h2>
          <div style={{color: C.body, fontSize: 20, maxWidth: 480}}>
            Engagement extends beyond the board into quests, social actions,
            and creator rewards.
          </div>
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 235,
          right: 235,
          top: 465,
          height: 2,
          background: "rgba(85,153,179,0.18)",
        }}
      >
        <div
          style={{
            width: `${pathProgress * 100}%`,
            height: "100%",
            background: `linear-gradient(90deg, ${C.aqua}, ${C.cyan}, ${C.violet}, ${C.coral})`,
            boxShadow: `0 0 20px ${C.cyan}`,
          }}
        />
      </div>
      <span
        style={{
          position: "absolute",
          left: tokenX,
          top: 455,
          width: 22,
          height: 22,
          transform: "translate(-50%, -50%) rotate(45deg)",
          background: C.ice,
          border: `5px solid ${C.cyan}`,
          boxShadow: `0 0 26px ${C.cyan}`,
        }}
      />
      <CommunityNode
        value="151"
        label="QUEST CLAIMS"
        x={98}
        color={C.aqua}
        delay={26}
      />
      <CommunityNode
        value="107"
        label="SOCIAL SHARES"
        x={490}
        color={C.cyan}
        delay={42}
      />
      <CommunityNode
        value="41"
        label="CREATOR SUBMISSIONS"
        x={882}
        color={C.violet}
        delay={58}
      />
      <CommunityNode
        value="58"
        label="CREATOR REWARDS"
        x={1274}
        color={C.coral}
        delay={74}
      />
      <div
        style={{
          ...useReveal(92, 20),
          position: "absolute",
          left: 132,
          right: 132,
          bottom: 150,
          padding: "20px 28px",
          background: "rgba(7,24,38,0.68)",
          border: `1px solid ${C.line}`,
          color: C.body,
          fontSize: 18,
          textAlign: "center",
        }}
      >
        A repeatable growth loop:{" "}
        <strong style={{color: C.ice}}>
          participation creates content, content attracts players, rewards bring
          them back.
        </strong>
      </div>
    </Scene>
  );
};

const allocations = [
  {
    percent: 35,
    eth: "1.75 ETH",
    title: "Prize & activity pool",
    detail: "More players. More matches. More activity.",
    color: C.cyan,
  },
  {
    percent: 25,
    eth: "1.25 ETH",
    title: "Advertising & growth",
    detail: "Acquire and reactivate more captains.",
    color: C.violet,
  },
  {
    percent: 20,
    eth: "1.00 ETH",
    title: "Gameplay mechanics",
    detail: "Deepen retention and competition.",
    color: C.coral,
  },
  {
    percent: 20,
    eth: "1.00 ETH",
    title: "Dedicated developers",
    detail: "Ship faster and operate reliably.",
    color: C.gold,
  },
];

const AllocationRow: React.FC<{
  item: (typeof allocations)[number];
  delay: number;
}> = ({item, delay}) => {
  const reveal = useReveal(delay, 45);
  return (
    <div
      style={{
        ...reveal,
        display: "grid",
        gridTemplateColumns: "98px 140px 1fr",
        alignItems: "center",
        minHeight: 116,
        borderBottom: `1px solid ${C.line}`,
      }}
    >
      <div
        style={{
          color: item.color,
          fontSize: 31,
          fontWeight: 700,
          letterSpacing: "-0.04em",
        }}
      >
        {item.percent}%
      </div>
      <div
        style={{
          color: C.ice,
          fontSize: 15,
          fontWeight: 700,
          ...mono,
        }}
      >
        {item.eth}
      </div>
      <div>
        <div
          style={{
            color: C.ice,
            fontSize: 24,
            lineHeight: 1,
            fontWeight: 700,
            textTransform: "uppercase",
          }}
        >
          {item.title}
        </div>
        <div style={{marginTop: 10, color: C.body, fontSize: 17}}>
          {item.detail}
        </div>
      </div>
    </div>
  );
};

const GrantScene: React.FC = () => {
  const frame = useCurrentFrame();
  const barProgress = interpolate(frame, [22, 86], [0, 1], {
    ...clamp,
    easing: Easing.out(Easing.cubic),
  });
  return (
    <Scene duration={300}>
      <div
        style={{
          position: "absolute",
          left: 132,
          top: 148,
          width: 600,
        }}
      >
        <Kicker color={C.gold}>THE ASK · BUILDER GRANT</Kicker>
        <div
          style={{
            ...useReveal(7, 70),
            marginTop: 56,
            color: C.ice,
            fontSize: 204,
            lineHeight: 0.79,
            fontWeight: 700,
            letterSpacing: "-0.085em",
          }}
        >
          5
        </div>
        <div
          style={{
            ...useReveal(18, 45),
            color: C.gold,
            fontSize: 98,
            lineHeight: 1,
            fontWeight: 700,
            letterSpacing: "-0.06em",
          }}
        >
          ETH
        </div>
        <div
          style={{
            ...useReveal(32, 30),
            marginTop: 28,
            color: C.ice,
            fontSize: 37,
            lineHeight: 1.1,
            fontWeight: 600,
            maxWidth: 500,
          }}
        >
          Capital with a clear job.
        </div>
        <div
          style={{
            ...useReveal(47, 22),
            marginTop: 24,
            color: C.body,
            fontSize: 21,
            lineHeight: 1.48,
            maxWidth: 500,
          }}
        >
          Every allocation maps directly to player growth, deeper gameplay, or
          shipping capacity.
        </div>
        <div
          style={{
            ...useReveal(64, 18),
            marginTop: 39,
            width: 510,
            height: 28,
            display: "flex",
            overflow: "hidden",
            border: `1px solid ${C.line}`,
            transformOrigin: "left center",
            transform: `scaleX(${barProgress})`,
          }}
        >
          {allocations.map((item) => (
            <span
              key={item.title}
              style={{
                width: `${item.percent}%`,
                height: "100%",
                background: item.color,
                boxShadow: `0 0 18px ${item.color}55`,
              }}
            />
          ))}
        </div>
      </div>
      <Panel
        color={C.gold}
        style={{
          ...useReveal(14, 70),
          position: "absolute",
          right: 128,
          top: 126,
          width: 1000,
          height: 820,
          padding: "42px 48px 28px",
        }}
      >
        <div
          style={{
            color: C.muted,
            fontSize: 13,
            fontWeight: 700,
            ...mono,
          }}
        >
          USE OF FUNDS · 100% ALLOCATED
        </div>
        <div style={{marginTop: 18}}>
          {allocations.map((item, index) => (
            <AllocationRow
              key={item.title}
              item={item}
              delay={32 + index * 16}
            />
          ))}
        </div>
        <div
          style={{
            ...useReveal(105, 18),
            marginTop: 28,
            display: "flex",
            justifyContent: "space-between",
            color: C.body,
            fontSize: 15,
            ...mono,
          }}
        >
          <span>TOTAL</span>
          <strong style={{color: C.ice}}>100% · 5.00 ETH</strong>
        </div>
      </Panel>
    </Scene>
  );
};

const FinalScene: React.FC = () => {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, 180], [1.03, 1.1], clamp);
  const ring = spring({
    frame,
    fps: 30,
    config: {damping: 22, stiffness: 120, mass: 1},
  });
  return (
    <Scene duration={240}>
      <Img
        src={asset("grant-video/app-desktop.png")}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `scale(${scale})`,
          filter: "brightness(0.34) saturate(1.18)",
        }}
      />
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(circle at 50% 48%, rgba(3,16,28,0.52), rgba(2,8,18,0.97) 78%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "49%",
          width: 1080,
          transform: "translate(-50%, -50%)",
          textAlign: "center",
        }}
      >
        <div
          style={{
            ...useReveal(5, 62),
            color: C.cyan,
            fontSize: 15,
            fontWeight: 700,
            ...mono,
          }}
        >
          A SHIPPED GAME · A MEASURED LOOP · A CLEAR PLAN
        </div>
        <h2
          style={{
            ...useReveal(16, 70),
            margin: "30px 0 0",
            color: C.ice,
            fontSize: 92,
            lineHeight: 0.98,
            letterSpacing: "-0.06em",
            textShadow: "0 0 54px rgba(18,216,255,0.12)",
          }}
        >
          Help Sea Battle
          <br />
          scale on Base.
        </h2>
        <div
          style={{
            ...useReveal(35, 36),
            marginTop: 34,
            color: C.body,
            fontSize: 25,
            lineHeight: 1.4,
          }}
        >
          More players. Deeper gameplay. A stronger onchain game.
        </div>
        <div
          style={{
            ...useReveal(53, 28),
            marginTop: 42,
            display: "inline-flex",
            minWidth: 410,
            height: 72,
            padding: "0 34px",
            alignItems: "center",
            justifyContent: "center",
            gap: 22,
            border: `1px solid ${C.cyan}`,
            background: "rgba(18,216,255,0.10)",
            color: C.ice,
            fontSize: 23,
            fontWeight: 700,
            boxShadow: `0 0 ${36 * ring}px rgba(18,216,255,0.20)`,
            ...mono,
          }}
        >
          SEABATTLE.TOP <span style={{color: C.cyan}}>↗</span>
        </div>
      </div>
    </Scene>
  );
};

export const SeaBattleGrantFilm: React.FC = () => {
  return (
    <AbsoluteFill style={{backgroundColor: C.void, color: C.ice}}>
      <AmbientGrid />
      <Sequence from={0} durationInFrames={150}>
        <HeroScene />
      </Sequence>
      <Sequence from={150} durationInFrames={180}>
        <ProductScene />
      </Sequence>
      <Sequence from={330} durationInFrames={210}>
        <TractionScene />
      </Sequence>
      <Sequence from={540} durationInFrames={180}>
        <JulyScene />
      </Sequence>
      <Sequence from={720} durationInFrames={180}>
        <GrowthScene />
      </Sequence>
      <Sequence from={900} durationInFrames={180}>
        <EconomyScene />
      </Sequence>
      <Sequence from={1080} durationInFrames={150}>
        <CommunityScene />
      </Sequence>
      <Sequence from={1230} durationInFrames={300}>
        <GrantScene />
      </Sequence>
      <Sequence from={1530} durationInFrames={240}>
        <FinalScene />
      </Sequence>
      <FrameChrome />
    </AbsoluteFill>
  );
};
