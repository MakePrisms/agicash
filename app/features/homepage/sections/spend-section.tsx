import { useEffect, useMemo, useRef, useState } from 'react';
import { Section } from '../components/section';
import { SectionLabel } from '../components/section-label';

const QR_SIZE = 21;
const FINDER_SIZE = 7;

// Mulberry32 — small deterministic PRNG so the QR pattern is stable
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildQrPattern(size: number, seed: number): boolean[][] {
  const grid: boolean[][] = Array.from({ length: size }, () =>
    Array(size).fill(false),
  );

  const drawFinder = (r0: number, c0: number) => {
    for (let dr = 0; dr < FINDER_SIZE; dr++) {
      for (let dc = 0; dc < FINDER_SIZE; dc++) {
        const isOuter = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const isInner = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        grid[r0 + dr][c0 + dc] = isOuter || isInner;
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(0, size - FINDER_SIZE);
  drawFinder(size - FINDER_SIZE, 0);

  const inFinderZone = (r: number, c: number) =>
    (r < FINDER_SIZE + 1 && c < FINDER_SIZE + 1) ||
    (r < FINDER_SIZE + 1 && c >= size - FINDER_SIZE - 1) ||
    (r >= size - FINDER_SIZE - 1 && c < FINDER_SIZE + 1);

  const rng = mulberry32(seed);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (inFinderZone(r, c)) continue;
      // Timing pattern on row 6 + col 6
      if (r === 6) {
        grid[r][c] = c % 2 === 0;
        continue;
      }
      if (c === 6) {
        grid[r][c] = r % 2 === 0;
        continue;
      }
      grid[r][c] = rng() < 0.46;
    }
  }

  return grid;
}

function QrPattern() {
  const grid = useMemo(() => buildQrPattern(QR_SIZE, 4242), []);
  return (
    <svg
      className="pay-qr block text-[#04080f]"
      width="100%"
      height="100%"
      viewBox={`0 0 ${QR_SIZE} ${QR_SIZE}`}
      preserveAspectRatio="xMidYMid meet"
      overflow="hidden"
      aria-hidden="true"
    >
      {grid.flatMap((row, r) =>
        row.map((cell, c) =>
          cell ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: static QR grid never reorders
            <rect key={`${r}-${c}`} x={c} y={r} width={1} height={1} />
          ) : null,
        ),
      )}
    </svg>
  );
}

export function SpendSection() {
  const stageRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const node = stageRef.current;
    if (!node) return;
    const root = node.closest('.marketing');
    const obs = new IntersectionObserver(
      ([entry]) => {
        setPlaying(Boolean(entry?.isIntersecting));
      },
      {
        root: root as Element | null,
        rootMargin: '0px 0px -45% 0px',
        threshold: 0,
      },
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, []);

  return (
    <Section id="spend">
      <div className="grid grid-cols-1 items-center gap-12 md:grid-cols-2 md:gap-20">
        <div className="text-center md:text-left">
          <SectionLabel>03_spend</SectionLabel>
          <h2 className="mt-8 font-medium font-mono text-3xl leading-[1.15] tracking-[-0.02em] md:mt-10 md:text-5xl">
            Spend. Scan. Done.
          </h2>
          <p className="mt-6 text-[color:var(--mk-text-dim)] text-base leading-relaxed md:text-lg">
            Pay with bitcoin at checkout. Scan the QR code with your Agicash
            wallet. Bitcoin lands instantly at the merchant. No card networks or
            bank intermediaries.
          </p>
          <div className="mt-6 font-mono text-[10px] text-[color:var(--mk-text-muted)] uppercase tracking-[0.18em]">
            settled instantly · 0% fee
          </div>
        </div>

        <div className="flex justify-center">
          <div
            ref={stageRef}
            className={`pay-stage relative mx-auto w-full max-w-[320px] rounded-[18px] border border-[color:var(--mk-border)] bg-[linear-gradient(180deg,#070d18_0%,#050a13_100%)] px-[22px] pt-6 pb-[22px] shadow-[0_30px_80px_-30px_rgba(0,0,0,0.8),inset_0_1px_0_rgba(255,255,255,0.04)] [font-family:var(--mk-font-display)] ${playing ? 'playing' : ''}`}
          >
            <div className="mb-[18px] flex items-center justify-between border-[color:var(--mk-border)] border-b pb-[14px] text-[10px] text-[color:var(--mk-text-muted)] uppercase tracking-[0.18em] [font-family:var(--mk-font-mono)]">
              <span>pay with bitcoin</span>
              <span className="text-[color:var(--mk-text)]">pubkey dc</span>
            </div>

            <div className="pay-qr-wrap relative mx-auto flex aspect-square w-[55%] max-w-[200px] transform-gpu items-center justify-center overflow-hidden rounded-lg bg-[#f4f7ff] p-2.5 transition-opacity duration-[360ms]">
              <QrPattern />
              <span
                aria-hidden="true"
                className="pay-scanline pointer-events-none absolute right-[6%] left-[6%] h-0.5 bg-[color:var(--mk-brand)] opacity-0 shadow-[0_0_12px_rgba(0,212,255,0.6)]"
              />
              <div className="pay-paid pointer-events-none absolute inset-2.5 grid place-items-center rounded-md bg-[#04080f] opacity-0">
                <div
                  aria-hidden="true"
                  className="grid h-16 w-16 place-items-center rounded-full border-2 border-[color:var(--mk-brand)] text-[32px] text-[color:var(--mk-brand)]"
                >
                  ✓
                </div>
              </div>
            </div>

            <div className="mt-[18px] flex flex-col items-center gap-1 text-center">
              <span className="font-semibold text-[36px] text-[color:var(--mk-text)] tabular-nums leading-none tracking-[0.01em] [font-family:var(--mk-font-numeric)]">
                <span className="mr-[0.06em] inline-block align-[0.02em] font-bold text-[0.86em] [font-family:var(--mk-font-mono)]">
                  ₿
                </span>
                5,634
              </span>
              <span className="font-medium text-[16px] text-[color:var(--mk-text-muted)] tabular-nums leading-none tracking-[0.02em] [font-family:var(--mk-font-numeric)]">
                $4.50
              </span>
            </div>

            <div className="relative mt-4 h-7 border-[color:var(--mk-border)] border-t pt-[14px] text-[11px] uppercase tracking-[0.12em] [font-family:var(--mk-font-mono)]">
              <span className="pay-status-scan absolute inset-x-0 top-[14px] bottom-0 grid place-items-center text-[color:var(--mk-text-muted)] opacity-100">
                scan to pay
              </span>
              <span className="pay-status-paid absolute inset-x-0 top-[14px] bottom-0 grid place-items-center text-[color:var(--mk-brand)] opacity-0">
                paid
              </span>
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}
