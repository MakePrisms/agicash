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
      className="pay-qr"
      viewBox={`0 0 ${QR_SIZE} ${QR_SIZE}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      {grid.flatMap((row, r) =>
        row.map((cell, c) =>
          cell ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: static QR grid never reorders
            <rect key={`${r}-${c}`} x={c} y={r} width={1.04} height={1.04} />
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
            className={`pay-stage ${playing ? 'playing' : ''}`}
          >
            <div className="pay-head">
              <span>pay with bitcoin</span>
              <span className="merchant">pubkey dc</span>
            </div>

            <div className="pay-qr-wrap">
              <QrPattern />
              <span className="pay-scanline" aria-hidden="true" />
              <div className="pay-paid">
                <div className="check-circle" aria-hidden="true">
                  ✓
                </div>
              </div>
            </div>

            <div className="pay-amount">
              <span className="sats">
                <span className="btc-symbol">₿</span>5,634
              </span>
              <span className="usd">$4.50</span>
            </div>

            <div className="pay-status">
              <span className="text scan">scan to pay</span>
              <span className="text paid">paid</span>
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}
