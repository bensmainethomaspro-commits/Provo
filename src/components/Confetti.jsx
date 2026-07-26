import { useEffect, useRef } from 'react';

const COLORS = ['#35A7DD','#3b82f6','#22c55e','#14b8a6','#ec4899','#8b5cf6','#06b6d4','#ef4444'];

export default function Confetti({ active, onDone }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!active || !ref.current) return;
    const container = ref.current;
    const pieces = [];
    for (let i = 0; i < 48; i++) {
      const el = document.createElement('div');
      el.className = 'confetti-piece';
      el.style.cssText = `
        left:${Math.random() * 100}%;
        background:${COLORS[i % COLORS.length]};
        width:${6 + Math.random() * 6}px;
        height:${8 + Math.random() * 8}px;
        border-radius:${Math.random() > 0.5 ? '50%' : '2px'};
        animation-delay:${Math.random() * 0.4}s;
        animation-duration:${0.9 + Math.random() * 0.8}s;
      `;
      container.appendChild(el);
      pieces.push(el);
    }
    const timer = setTimeout(() => {
      pieces.forEach(p => p.remove());
      onDone?.();
    }, 1800);
    return () => { clearTimeout(timer); pieces.forEach(p => p.remove()); };
  }, [active, onDone]);

  if (!active) return null;
  return <div ref={ref} className="confetti-container" aria-hidden="true" />;
}
