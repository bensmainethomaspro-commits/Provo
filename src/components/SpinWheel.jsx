import { useRef, useEffect, useState, useCallback } from 'react';

const WHEEL_COLORS = [
  '#35A7DD', '#3b82f6', '#8b5cf6', '#22c55e',
  '#14b8a6', '#06b6d4', '#ec4899', '#ef4444',
];

const SIZE = 280;
const CX = SIZE / 2;
const CY = SIZE / 2;
const R = 120;
const INNER_R = 20;

function drawWheel(ctx, travelers, angle) {
  const N = travelers.length;
  if (N === 0) return;
  ctx.clearRect(0, 0, SIZE, SIZE);

  const sectorAngle = (2 * Math.PI) / N;

  for (let i = 0; i < N; i++) {
    const startA = angle + i * sectorAngle - Math.PI / 2;
    const endA = startA + sectorAngle;
    const color = WHEEL_COLORS[i % WHEEL_COLORS.length];

    // Sector fill
    ctx.beginPath();
    ctx.moveTo(CX, CY);
    ctx.arc(CX, CY, R, startA, endA);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();

    // Sector border
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Text
    ctx.save();
    ctx.translate(CX, CY);
    ctx.rotate(startA + sectorAngle / 2);
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.font = `bold ${N > 5 ? 11 : 13}px -apple-system, sans-serif`;
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = 3;
    const label = travelers[i].emoji ? `${travelers[i].emoji} ${travelers[i].name}` : travelers[i].name;
    ctx.fillText(label.slice(0, 12), R - 12, 5);
    ctx.restore();
  }

  // Outer ring
  ctx.beginPath();
  ctx.arc(CX, CY, R, 0, 2 * Math.PI);
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.lineWidth = 3;
  ctx.stroke();

  // Center circle
  ctx.beginPath();
  ctx.arc(CX, CY, INNER_R, 0, 2 * Math.PI);
  ctx.fillStyle = '#fff';
  ctx.shadowColor = 'rgba(0,0,0,0.2)';
  ctx.shadowBlur = 6;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(0,0,0,0.1)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Center emoji
  ctx.font = '18px serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#333';
  ctx.fillText('🎰', CX, CY + 7);
}

export default function SpinWheel({ travelers, onClose }) {
  const canvasRef = useRef(null);
  const angleRef = useRef(0);
  const rafRef = useRef(null);
  const [spinning, setSpinning] = useState(false);
  const [winner, setWinner] = useState(null);
  const [showResult, setShowResult] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || travelers.length === 0) return;
    const ctx = canvas.getContext('2d');
    drawWheel(ctx, travelers, angleRef.current);
  }, [travelers]);

  const spin = useCallback(() => {
    if (spinning || travelers.length === 0) return;
    setSpinning(true);
    setWinner(null);
    setShowResult(false);

    const N = travelers.length;
    const sectorAngle = (2 * Math.PI) / N;

    // Pick a random winner
    const winnerIdx = Math.floor(Math.random() * N);

    // Calculate the final angle so the winner ends at the top (pointer position)
    const currentAngle = angleRef.current % (2 * Math.PI);
    // Sector i occupies [i*sectorAngle - π/2, (i+1)*sectorAngle - π/2] relative to angle=0
    // We want the center of winner's sector to be at top (pointing up), i.e., angle contribution = 0
    // The pointer is at top (π/2 before y-axis). We need -(winnerIdx + 0.5) * sectorAngle to point up
    const targetSectorCenter = -(winnerIdx + 0.5) * sectorAngle;
    // Add enough full rotations (8-12 spins) for drama
    const extraSpins = (8 + Math.floor(Math.random() * 5)) * 2 * Math.PI;
    const targetAngle = currentAngle + extraSpins + ((targetSectorCenter - currentAngle) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);

    const DURATION = 9500; // ~10 seconds
    const startAngle = angleRef.current;
    const totalDelta = targetAngle - startAngle;
    const startTime = performance.now();

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');

    const animate = (now) => {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / DURATION, 1);
      // Ease-out quintic for dramatic deceleration
      const eased = 1 - Math.pow(1 - t, 5);
      angleRef.current = startAngle + totalDelta * eased;
      if (ctx) drawWheel(ctx, travelers, angleRef.current);

      if (t < 1) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        setSpinning(false);
        setWinner(travelers[winnerIdx]);
        setTimeout(() => setShowResult(true), 100);
      }
    };

    rafRef.current = requestAnimationFrame(animate);
  }, [spinning, travelers]);

  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); }, []);

  return (
    <div className="spinwheel-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="spinwheel-modal">
        <div className="spinwheel-modal__header">
          <h2 className="spinwheel-modal__title">🎰 Roue de la fortune</h2>
          <button className="sheet__close" onClick={onClose}>✕</button>
        </div>

        <div className="spinwheel-body">
          <div className="spinwheel-pointer-wrap">
            <div className="spinwheel-pointer">▼</div>
            <canvas
              ref={canvasRef}
              width={SIZE}
              height={SIZE}
              className={`spinwheel-canvas${spinning ? ' spinwheel-canvas--spinning' : ''}`}
            />
          </div>

          {showResult && winner && (
            <div className="spinwheel-result">
              <div className="spinwheel-result__emoji">{winner.emoji || '🎉'}</div>
              <div className="spinwheel-result__name">{winner.name}</div>
              <div className="spinwheel-result__label">a été sélectionné·e !</div>
            </div>
          )}

          <button
            className={`btn btn--full spinwheel-spin-btn${spinning ? ' btn--secondary' : ' btn--primary'}`}
            onClick={spin}
            disabled={spinning || travelers.length < 2}
          >
            {spinning ? '🌀 La roue tourne…' : winner ? '🔄 Relancer' : '🎰 Lancer la roue !'}
          </button>

          {travelers.length < 2 && (
            <p className="spinwheel-hint">Ajoute au moins 2 voyageurs pour utiliser la roue.</p>
          )}
        </div>
      </div>
    </div>
  );
}
