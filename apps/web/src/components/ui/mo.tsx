'use client';

import React, { useEffect, useRef, useState } from 'react';

export const MO_FRAMES = {
  braille: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  pipe: ['|', '/', '-', '\\'],
  dots: ['.  ', '.. ', '...', '   '],
  block: ['▏', '▎', '▍', '▌', '▋', '▊', '▉', '█', '▉', '▊', '▋', '▌', '▍', '▎'],
  bounce: ['[=   ]', '[ =  ]', '[  = ]', '[   =]', '[  = ]', '[ =  ]'],
  grow: ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█', '▇', '▆', '▅', '▄', '▃', '▂'],
  arrow: ['←', '↖', '↑', '↗', '→', '↘', '↓', '↙'],
  moon: ['◐', '◓', '◑', '◒'],
  snake: ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷'],
  wave: ['▁▂▃', '▂▃▄', '▃▄▅', '▄▅▆', '▅▆▇', '▆▇█', '▇█▇', '█▇▆', '▇▆▅', '▆▅▄', '▅▄▃', '▄▃▂']
} as const;

export type MoSpinnerName = keyof typeof MO_FRAMES;

const CIPHER_GLYPHS = '#$%&*+<>=/\\[]{}01';

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Stepped ASCII/Braille frame spinner from mo-gallery.html (`Mo.spin`)
 */
export function MoSpinner({
  name = 'braille',
  ms = 80,
  className
}: {
  name?: MoSpinnerName;
  ms?: number;
  className?: string;
}) {
  const frames = MO_FRAMES[name] ?? MO_FRAMES.braille;
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (prefersReducedMotion()) return;
    const timer = setInterval(() => {
      setIdx((prev) => (prev + 1) % frames.length);
    }, ms);
    return () => clearInterval(timer);
  }, [frames.length, ms]);

  return (
    <span aria-hidden="true" className={className} style={{ whiteSpace: 'pre' }}>
      {frames[idx]}
    </span>
  );
}

/**
 * Stepped cipher-decode text reveal from mo-gallery.html (`Mo.decode`)
 */
export function MoDecode({
  text,
  frames = 10,
  ms = 28,
  className
}: {
  text: string;
  frames?: number;
  ms?: number;
  className?: string;
}) {
  const [display, setDisplay] = useState(text);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setDisplay(text);
      return;
    }
    let frame = 0;
    const timer = setInterval(() => {
      frame++;
      if (frame >= frames) {
        setDisplay(text);
        clearInterval(timer);
        return;
      }
      const revealCount = (text.length * frame) / frames;
      const scrambled = [...text]
        .map((ch, i) =>
          i < revealCount || ch === ' '
            ? ch
            : CIPHER_GLYPHS[(Math.random() * CIPHER_GLYPHS.length) | 0]
        )
        .join('');
      setDisplay(scrambled);
    }, ms);

    return () => clearInterval(timer);
  }, [text, frames, ms]);

  return <span className={className}>{display}</span>;
}

/**
 * Stepped typewriter word loop with blinking block cursor from mo-gallery.html (`Mo.typeLoop`)
 */
export function MoTypeLoop({
  words,
  speed = 52,
  hold = 1500,
  className
}: {
  words: string[];
  speed?: number;
  hold?: number;
  className?: string;
}) {
  const [text, setText] = useState(words[0] ?? '');

  useEffect(() => {
    if (words.length === 0) return;
    if (prefersReducedMotion()) {
      setText(words[0] ?? '');
      return;
    }

    let active = true;
    const sleep = (d: number) => new Promise((r) => setTimeout(r, d));

    (async () => {
      let i = 0;
      while (active) {
        const word = words[i++ % words.length] ?? '';
        for (let k = 1; k <= word.length && active; k++) {
          setText(word.slice(0, k));
          await sleep(speed);
        }
        await sleep(hold);
        for (let k = word.length; k >= 0 && active; k--) {
          setText(word.slice(0, k));
          await sleep(Math.max(18, speed / 2));
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [words, speed, hold]);

  return <span className={`mo-cursor ${className ?? ''}`}>{text}</span>;
}

/**
 * Stepped cubic ease-out number counter from mo-gallery.html (`Mo.count`)
 */
export function MoCount({
  to,
  ms = 650,
  className
}: {
  to: number;
  ms?: number;
  className?: string;
}) {
  const [val, setVal] = useState(to);
  const prevRef = useRef(0);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setVal(to);
      prevRef.current = to;
      return;
    }
    const from = prevRef.current;
    prevRef.current = to;
    if (from === to) {
      setVal(to);
      return;
    }

    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      const eased = Math.round((1 - (1 - p) ** 3) * 12) / 12;
      setVal(Math.round(from + (to - from) * eased));
      if (p < 1) {
        raf = requestAnimationFrame(step);
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to, ms]);

  return <span className={`tabular-nums ${className ?? ''}`}>{val}</span>;
}

/**
 * Stepped ASCII progress bar from mo-gallery.html (`Mo.bar`)
 */
export function MoBar({
  value,
  width = 16,
  showPercent = true,
  className
}: {
  value: number;
  width?: number;
  showPercent?: boolean;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  const [current, setCurrent] = useState(clamped);
  const prevRef = useRef(clamped);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setCurrent(clamped);
      prevRef.current = clamped;
      return;
    }
    const from = prevRef.current;
    prevRef.current = clamped;
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / 380);
      const stepped = from + (clamped - from) * (Math.round(p * 8) / 8);
      setCurrent(stepped);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [clamped]);

  const filled = Math.round((width * current) / 100);
  const empty = Math.max(0, width - filled);
  const barText = `[${'#'.repeat(filled)}${'-'.repeat(empty)}]${
    showPercent ? ` ${String(Math.round(current)).padStart(3)}%` : ''
  }`;

  return (
    <span
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={`mo-bar ${className ?? ''}`}
    >
      {barText}
    </span>
  );
}

/**
 * Bouncing ASCII scanner from mo-gallery.html (`Mo.scan`)
 */
export function MoScan({
  width = 18,
  className
}: {
  width?: number;
  className?: string;
}) {
  const w = 3;
  const [pos, setPos] = useState(0);
  const dirRef = useRef(1);

  useEffect(() => {
    if (prefersReducedMotion()) return;
    const timer = setInterval(() => {
      setPos((prev) => {
        let next = prev + dirRef.current;
        if (next >= width - w) {
          next = width - w;
          dirRef.current = -1;
        } else if (next <= 0) {
          next = 0;
          dirRef.current = 1;
        }
        return next;
      });
    }, 60);
    return () => clearInterval(timer);
  }, [width]);

  const text = `[${' '.repeat(pos)}${'='.repeat(w)}${' '.repeat(Math.max(0, width - w - pos))}]`;
  return (
    <span aria-hidden="true" className={`mo-bar ${className ?? ''}`}>
      {text}
    </span>
  );
}

/**
 * Stepped horizontal ticker strip from mo-gallery.html (`.mo-ticker`)
 */
export function MoTicker({ items }: { items: string[] }) {
  const chunk = items.map((i) => `${i}   `).join('');
  return (
    <div className="mo-ticker text-xs text-[var(--mute)] select-none" aria-hidden="true">
      <div>{chunk.repeat(4)}</div>
    </div>
  );
}

/**
 * Imperative terminal toast from mo-gallery.html (`Mo.toast`)
 */
export function moToast(msg: string, ms: number = 2800): void {
  if (typeof document === 'undefined') return;
  let host = document.querySelector('.mo-toasts');
  if (!host) {
    host = document.createElement('div');
    host.className = 'mo-toasts';
    host.setAttribute('role', 'status');
    document.body.append(host);
  }

  const toast = document.createElement('div');
  const span = document.createElement('span');
  toast.className = 'mo-toast';
  toast.append('│ ', span);
  host.append(toast);

  if (prefersReducedMotion()) {
    span.textContent = msg;
  } else {
    let idx = 0;
    const timer = setInterval(() => {
      idx++;
      span.textContent = msg.slice(0, idx);
      if (idx >= msg.length) clearInterval(timer);
    }, 14);
  }

  setTimeout(() => {
    toast.classList.add('is-out');
    setTimeout(() => toast.remove(), 260);
  }, ms);
}

/**
 * Stepped ASCII radial particle burst from mo-gallery.html (`Mo.burst`)
 */
export function moBurst(anchor: HTMLElement | null, count: number = 14): void {
  if (!anchor || typeof document === 'undefined' || prefersReducedMotion()) return;
  const glyphs = '*+·×o';
  const rect = anchor.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;

  for (let k = 0; k < count; k++) {
    const s = document.createElement('span');
    const angle = (k / count) * Math.PI * 2;
    const dist = 28 + Math.random() * 28;
    s.textContent = glyphs[k % glyphs.length] ?? '*';
    s.style.cssText = `position:fixed;left:${cx}px;top:${cy}px;pointer-events:none;z-index:80;font-family:var(--font-opencode);font-size:13px;font-weight:700;color:var(--ink)`;
    document.body.append(s);
    const anim = s.animate(
      [
        { transform: 'translate(-50%, -50%)', opacity: 1 },
        {
          transform: `translate(calc(-50% + ${Math.cos(angle) * dist}px), calc(-50% + ${Math.sin(angle) * dist}px))`,
          opacity: 0
        }
      ],
      { duration: 560, easing: 'steps(6)' }
    );
    anim.onfinish = () => s.remove();
  }
}
