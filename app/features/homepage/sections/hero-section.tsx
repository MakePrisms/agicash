import { useCallback, useEffect, useId, useRef, useState } from 'react';
import blockAndBean from '~/assets/gift-cards/blockandbean.agi.cash.webp';
import pinkOwl from '~/assets/gift-cards/pinkowl.agi.cash.webp';
import pubkey from '~/assets/gift-cards/pubkey.agi.cash.webp';
import shack from '~/assets/gift-cards/shack.agi.cash.webp';
import epicurean from '~/assets/gift-cards/theepicureantrader.agi.cash.webp';
import { JoinBetaButton } from '../components/join-beta-button';

const cards = [
  { src: pubkey, label: 'PUBKEY DC', location: 'WASHINGTON, D.C.' },
  { src: pinkOwl, label: 'PINK OWL COFFEE', location: 'CALIFORNIA' },
  { src: shack, label: 'THE SHACK', location: 'CALIFORNIA' },
  { src: blockAndBean, label: 'BLOCK & BEAN', location: 'CALIFORNIA' },
  { src: epicurean, label: 'EPICUREAN TRADER', location: 'CALIFORNIA' },
];

function pad3(n: number) {
  return String(n + 1).padStart(3, '0');
}

const PIXEL_COLS = 28;
const PIXEL_ROWS = 18;
const PIXEL_CELLS = PIXEL_COLS * PIXEL_ROWS;
const PIXEL_MAX_DELAY = 240;
const PIXEL_CELL_DURATION = 360;
const TRANSITION_END = PIXEL_MAX_DELAY + PIXEL_CELL_DURATION + 40; // ~640ms

type Cell = { col: number; row: number; delay: number };

function makePixelCells(): Cell[] {
  const cells: Cell[] = [];
  for (let row = 0; row < PIXEL_ROWS; row++) {
    for (let col = 0; col < PIXEL_COLS; col++) {
      cells.push({
        col,
        row,
        delay: Math.floor(Math.random() * PIXEL_MAX_DELAY),
      });
    }
  }
  return cells;
}

function PixelWipe({ cells, src }: { cells: Cell[]; src: string }) {
  const patternId = useId();
  return (
    <svg
      className="pixel-wipe"
      viewBox={`0 0 ${PIXEL_COLS} ${PIXEL_ROWS}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <pattern
          id={patternId}
          patternUnits="userSpaceOnUse"
          x="0"
          y="0"
          width={PIXEL_COLS}
          height={PIXEL_ROWS}
        >
          <image
            href={src}
            x="0"
            y="0"
            width={PIXEL_COLS}
            height={PIXEL_ROWS}
            preserveAspectRatio="none"
          />
        </pattern>
      </defs>
      {cells.map((c, i) => (
        <rect
          // biome-ignore lint/suspicious/noArrayIndexKey: static grid
          key={i}
          x={c.col}
          y={c.row}
          width={1.05}
          height={1.05}
          fill={`url(#${patternId})`}
          style={{ animationDelay: `${c.delay}ms` }}
        />
      ))}
    </svg>
  );
}

export function HeroSection() {
  // imgIdx — drives the underlying <img src> (lags during transition; swaps at end)
  // activeIdx — drives meta labels + active dot (updates immediately at start)
  const [imgIdx, setImgIdx] = useState(0);
  const [activeIdx, setActiveIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(true);
  const [wipe, setWipe] = useState<{
    id: number;
    cells: Cell[];
    src: string;
  } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const activeIdxRef = useRef(activeIdx);
  const transitioningRef = useRef(false);
  const timersRef = useRef<number[]>([]);

  activeIdxRef.current = activeIdx;

  const advanceTo = useCallback((nextIdx: number) => {
    if (transitioningRef.current) return;
    if (nextIdx === activeIdxRef.current) return;
    transitioningRef.current = true;

    // Update meta + active dot IMMEDIATELY at start of transition.
    setActiveIdx(nextIdx);

    // Mount wipe overlay rendering slices of the NEXT card.
    // Cells fade in over ~600ms revealing the next image piece by piece.
    const id = Date.now();
    setWipe({
      id,
      cells: makePixelCells(),
      src: cards[nextIdx]?.src ?? '',
    });

    // Once all cells are fully opaque (showing next image), atomically swap
    // the underlying img src AND unmount the wipe in the same render batch
    // — no flash because cells are already showing the new image.
    const t = window.setTimeout(() => {
      setImgIdx(nextIdx);
      setWipe((w) => (w?.id === id ? null : w));
      transitioningRef.current = false;
    }, TRANSITION_END);

    timersRef.current = [t];
  }, []);

  // Track tab visibility — when tab becomes visible, the auto-advance effect
  // re-runs and the 5s timer resets fresh (no "catch-up" speed bursts).
  useEffect(() => {
    if (typeof document === 'undefined') return;
    setVisible(!document.hidden);
    const onVisibilityChange = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () =>
      document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  // Auto-advance carousel — paused when hovered or tab hidden.
  // First switch fires at 3.5s so the initial card doesn't feel stuck during
  // hydration; subsequent switches every 5s.
  useEffect(() => {
    if (paused || !visible) return;
    let intervalId: number | undefined;
    const firstTimeout = window.setTimeout(() => {
      advanceTo((activeIdxRef.current + 1) % cards.length);
      intervalId = window.setInterval(() => {
        advanceTo((activeIdxRef.current + 1) % cards.length);
      }, 5000);
    }, 3500);
    return () => {
      window.clearTimeout(firstTimeout);
      if (intervalId !== undefined) window.clearInterval(intervalId);
    };
  }, [paused, visible, advanceTo]);

  // Cleanup any pending timers on unmount
  useEffect(
    () => () => {
      for (const t of timersRef.current) {
        window.clearTimeout(t);
      }
    },
    [],
  );

  // Mouse parallax tilt (desktop only)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!window.matchMedia('(hover: hover)').matches) return;
    const card = cardRef.current;
    const wrap = card?.parentElement;
    if (!card || !wrap) return;

    let raf = 0;
    const onMove = (e: MouseEvent) => {
      const r = wrap.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width - 0.5) * 2;
      const y = ((e.clientY - r.top) / r.height - 0.5) * 2;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        card.style.transform = `rotateY(${x * 8}deg) rotateX(${-y * 6}deg)`;
      });
    };
    const onLeave = () => {
      cancelAnimationFrame(raf);
      card.style.transform = '';
    };

    wrap.addEventListener('mousemove', onMove);
    wrap.addEventListener('mouseleave', onLeave);
    return () => {
      wrap.removeEventListener('mousemove', onMove);
      wrap.removeEventListener('mouseleave', onLeave);
      cancelAnimationFrame(raf);
    };
  }, []);

  // Meta uses the active (target) card so the labels update at transition START.
  // The img element below uses imgIdx so it lags until the wipe completes.
  const meta = cards[activeIdx];
  const imgCard = cards[imgIdx];

  return (
    <section className="relative w-full px-5 pt-12 pb-24 md:px-8 md:pt-20 md:pb-32">
      <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-16 md:grid-cols-[1fr_minmax(360px,40%)] md:gap-20">
        <div className="stagger flex flex-col text-center md:items-start md:text-left">
          <div className="translate-y-2 text-left font-mono text-[11px] text-[color:var(--mk-text-muted)] uppercase tracking-[0.18em]">
            <span aria-hidden="true">{'> '}</span>agi.cash · public beta
          </div>

          <h1 className="mt-8 text-balance font-bold font-mono text-4xl text-[color:var(--mk-text)] leading-[1.05] tracking-[-0.025em] md:mt-10 md:text-7xl">
            <span className="text-[color:var(--mk-brand)]">Bitcoin</span>
            <br />
            Gift Cards.
          </h1>

          <p className="mt-7 max-w-md text-balance text-[color:var(--mk-text-dim)] text-base leading-relaxed md:text-lg">
            Buy, send and spend bitcoin gift cards from your favorite merchants.
            All on the most advanced Bitcoin wallet.
          </p>

          <div className="mt-9">
            <JoinBetaButton size="lg" />
          </div>

          <div className="mt-8 font-mono text-[10px] text-[color:var(--mk-text-muted)] uppercase tracking-[0.2em]">
            buy · send · spend
          </div>
        </div>

        <div className="flex justify-center md:justify-end">
          <div
            className="specimen-plate"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
          >
            <span className="specimen-corner tl" />
            <span className="specimen-corner tr" />
            <span className="specimen-corner bl" />
            <span className="specimen-corner br" />

            <span className="specimen-meta tl">
              {pad3(activeIdx)} / {String(cards.length).padStart(3, '0')}
            </span>
            <span className="specimen-meta tr">btc gift card</span>
            <span className="specimen-meta bl">{meta?.label}</span>
            <span className="specimen-meta br">{meta?.location}</span>

            <span className="specimen-ruler" aria-hidden="true" />

            <div className="specimen-card-wrap">
              <div ref={cardRef} className="specimen-card">
                <img
                  src={imgCard?.src}
                  alt={`${imgCard?.label} gift card`}
                  width={400}
                  height={250}
                />
                {wipe && (
                  <PixelWipe key={wipe.id} cells={wipe.cells} src={wipe.src} />
                )}
              </div>
            </div>

            <div className="specimen-index">
              {cards.map((c, i) => (
                <button
                  key={c.label}
                  type="button"
                  aria-label={`Specimen ${pad3(i)}`}
                  className={i === activeIdx ? 'active' : ''}
                  onClick={() => advanceTo(i)}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
