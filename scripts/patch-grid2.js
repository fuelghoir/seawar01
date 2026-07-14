const fs = require('fs');
let code = fs.readFileSync('app/components/HeroBattleGrid.tsx', 'utf8');

if (!code.includes('isGameSoundEnabled')) {
  code = code.replace(
    'import { notifyPlayerDataRefresh } from "../lib/playerDataEvents";',
    'import { isGameSoundEnabled } from "../lib/sounds";\nimport { notifyPlayerDataRefresh } from "../lib/playerDataEvents";'
  );
}

const replacementLogic = `  const [rotateX, setRotateX] = useState(12);
  const [rotateY, setRotateY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isFlipped, setIsFlipped] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [claimStatus, setClaimStatus] = useState<{
    loading: boolean;
    error: string | null;
    points: number | null;
    usdEligible: boolean;
  }>({ loading: false, error: null, points: null, usdEligible: false });

  const dragStart = useRef({ x: 0, y: 0 });
  const lastPos = useRef({ x: 0, y: 0 });
  const directionChanges = useRef<number[]>([]);
  const lastDirection = useRef<"left" | "right" | null>(null);
  const hasTriggeredThisDrag = useRef(false);

  const playEasterEggSound = () => {
    try {
      if (!isGameSoundEnabled()) return;
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const now = ctx.currentTime;
      const notes = [261.63, 329.63, 392.00, 523.25, 659.25, 783.99, 1046.50];
      notes.forEach((freq, idx) => {
        const t = now + idx * 0.1;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.linearRampToValueAtTime(0.08, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.35);
      });
    } catch {}
  };

  const handleStart = (clientX: number, clientY: number) => {
    if (isFlipped || staticPreview) return;
    setIsDragging(true);
    dragStart.current = { x: clientX, y: clientY };
    lastPos.current = { x: clientX, y: clientY };
    directionChanges.current = [];
    lastDirection.current = null;
    hasTriggeredThisDrag.current = false;
  };

  const handleMove = (clientX: number, clientY: number) => {
    if (!isDragging || isFlipped || staticPreview || hasTriggeredThisDrag.current) return;

    const dx = clientX - dragStart.current.x;
    const dy = clientY - dragStart.current.y;

    setRotateX(Math.max(-45, Math.min(45, 12 + dy * 0.3)));
    setRotateY(Math.max(-45, Math.min(45, dx * 0.3)));

    const movementX = clientX - lastPos.current.x;
    lastPos.current = { x: clientX, y: clientY };

    if (Math.abs(movementX) > 12) {
      const currentDir = movementX > 0 ? "right" : "left";
      if (lastDirection.current && lastDirection.current !== currentDir) {
        directionChanges.current.push(Date.now());
        const now = Date.now();
        directionChanges.current = directionChanges.current.filter((t) => now - t < 800);

        if (directionChanges.current.length >= 5) {
          triggerEasterEgg();
        }
      }
      lastDirection.current = currentDir;
    }
  };

  const handleEnd = () => {
    setIsDragging(false);
    if (!isFlipped) {
      setRotateX(12);
      setRotateY(0);
    }
  };

  const triggerEasterEgg = async () => {
    hasTriggeredThisDrag.current = true;
    setIsDragging(false);
    setIsFlipped(true);
    playEasterEggSound();

    setRotateX(12);
    setRotateY(0);

    if (address) {
      setClaimStatus({ loading: true, error: null, points: null, usdEligible: false });
      setShowModal(true);
      try {
        const res = await fetch("/api/easter-egg/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wallet: address }),
        });
        const data = await res.json();
        if (!res.ok) {
          setClaimStatus({ loading: false, error: data.error || "Claim failed", points: null, usdEligible: false });
        } else {
          setClaimStatus({ loading: false, error: null, points: data.points, usdEligible: data.usdEligible });
          notifyPlayerDataRefresh();
        }
      } catch {
        setClaimStatus({ loading: false, error: "Connection error", points: null, usdEligible: false });
      }
    } else {
      setShowModal(true);
      setClaimStatus({
        loading: false,
        error: ru ? "Пожалуйста, подключите кошелек, чтобы получить награду!" : "Please connect your wallet first to claim the reward!",
        points: null,
        usdEligible: false,
      });
    }

    setTimeout(() => setIsFlipped(false), 1800);
  };

  const defaultX = isHovered ? 0 : 12;
  const currentRotateX = isDragging ? rotateX : defaultX;
  const currentRotateY = isDragging ? rotateY : 0;

  const aliveRef = useRef(true);`;

code = code.replace(/const \[shipClicks[\s\S]*?const aliveRef = useRef\(true\);/, replacementLogic);

const frameReplacement = `<div 
        className={styles.frame}
        style={{
          transform: isFlipped
            ? "perspective(3500px) rotateY(720deg) rotateX(0deg)"
            : \`perspective(3500px) rotateX(\${currentRotateX}deg) rotateY(\${currentRotateY}deg)\`,
          transition: isDragging ? "none" : isFlipped ? "transform 1.4s cubic-bezier(0.19, 1, 0.22, 1)" : "transform 0.45s ease-out",
          cursor: isDragging ? "grabbing" : "grab",
          userSelect: "none",
          touchAction: "pan-y",
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => {
          setIsHovered(false);
          handleEnd();
        }}
        onMouseDown={(e) => handleStart(e.clientX, e.clientY)}
        onMouseMove={(e) => handleMove(e.clientX, e.clientY)}
        onMouseUp={handleEnd}
        onTouchStart={(e) => {
          if (e.touches[0]) {
            handleStart(e.touches[0].clientX, e.touches[0].clientY);
          }
        }}
        onTouchMove={(e) => {
          if (e.touches[0]) {
            handleMove(e.touches[0].clientX, e.touches[0].clientY);
          }
        }}
        onTouchEnd={handleEnd}
      >`;

code = code.replace('<div className={styles.frame}>', frameReplacement);
code = code.replace(/onClick=\{isShip \? handleShipClick : undefined\}/g, '');

fs.writeFileSync('app/components/HeroBattleGrid.tsx', code);
console.log("Successfully patched HeroBattleGrid.tsx!");
