import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import forkAndCoin from '~/assets/gift-cards/forkandcoin.agi.cash.webp';
import kissOfMatcha from '~/assets/gift-cards/kissofmatcha.agi.cash.webp';
import mariposa from '~/assets/gift-cards/mariposa.agi.cash.webp';
import pinkOwl from '~/assets/gift-cards/pinkowl.agi.cash.webp';
import pubkey from '~/assets/gift-cards/pubkey.agi.cash.webp';
import epicurean from '~/assets/gift-cards/theepicureantrader.agi.cash.webp';
import { JoinBetaButton } from '../components/join-beta-button';

const cards = [
  {
    src: pubkey,
    label: 'PUBKEY DC',
    location: 'WASHINGTON, D.C.',
    url: 'https://www.pubkey.bar/dc/home',
  },
  {
    src: epicurean,
    label: 'EPICUREAN TRADER',
    location: 'CALIFORNIA',
    url: 'https://theepicureantrader.com',
  },
  {
    src: pinkOwl,
    label: 'PINK OWL COFFEE',
    location: 'CALIFORNIA',
    url: 'https://pinkowlcoffee.com/',
  },
  {
    src: mariposa,
    label: 'MARIPOSA BAKING CO.',
    location: 'CALIFORNIA',
    url: 'https://www.mariposabaking.com/',
  },
  {
    src: kissOfMatcha,
    label: 'KISS OF MATCHA',
    location: 'CALIFORNIA',
    url: 'https://www.kissofmatcha.com/',
  },
  {
    src: forkAndCoin,
    label: 'FORK & COIN',
    location: 'ILLINOIS',
    url: 'https://www.forkandcoin.com/',
  },
];

function pad3(n: number) {
  return String(n + 1).padStart(3, '0');
}

const FADE_DURATION = 720;

// Pixel-dissolve via SVG-native masking: both incoming and outgoing cards
// render as <image> inside a single <svg> so they share an identical paint
// pipeline (eliminates the desktop DPR=1 sub-pixel AA shift HTML <img>+SVG
// had). The outgoing <image> carries mask="url(#…)" referencing an inline
// SVG <mask> of 24 white rects whose opacity steps 1 → 0 with a randomized
// delay across PIXEL_STAGGER_WINDOW. Done as a real SVG mask (not CSS
// mask-image) because iOS Safari has long-standing bugs with `mask-image:
// url(#fragment)` referencing inline SVG masks, especially with animated
// content — SVG-native mask= has worked reliably in WebKit for years.
// The cell count stays well under the ~30 DOM-node budget — the original
// PixelWipe used 504 simultaneous CSS animations and choked on iOS Safari.
const PIXEL_COLS = 6;
const PIXEL_ROWS = 4;
const PIXEL_CELLS = PIXEL_COLS * PIXEL_ROWS;
const PIXEL_STAGGER_WINDOW = 720;

function makePixelDelays(): number[] {
  const indices = Array.from({ length: PIXEL_CELLS }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  const delays = new Array<number>(PIXEL_CELLS);
  indices.forEach((cellIdx, order) => {
    delays[cellIdx] = Math.round(
      (order / Math.max(1, PIXEL_CELLS - 1)) * PIXEL_STAGGER_WINDOW,
    );
  });
  return delays;
}

const specimenCornerBase =
  'pointer-events-none absolute h-[14px] w-[14px] border border-[color:var(--mk-text-muted)]';
const specimenMetaBase =
  'absolute [font-family:var(--mk-font-mono)] text-[9px] md:text-[10px] tracking-[0.1em] uppercase text-[color:var(--mk-text-muted)]';

export function HeroSection() {
  // activeIdx — the visible card; rendered as a steady SVG <image> bottom
  //   layer AND drives meta labels + active dot
  // prevIdx — outgoing card as a sibling SVG <image> stacked on top, with
  //   mask="url(#…)" so its 24 cell rects erase opacity 1 → 0 over
  //   FADE_DURATION ms, exposing activeIdx beneath. Both <image>s share
  //   the same SVG paint pipeline.
  const [activeIdx, setActiveIdx] = useState(0);
  const [prevIdx, setPrevIdx] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(true);
  const cardRef = useRef<HTMLDivElement>(null);
  const activeIdxRef = useRef(activeIdx);
  const transitioningRef = useRef(false);
  const timersRef = useRef<number[]>([]);
  // Holds decoded HTMLImageElements so the browser keeps the bitmaps in
  // cache for the lifetime of the component — guarantees the incoming card
  // is painted on frame 1 of the pixel-dissolve, instead of briefly showing
  // transparent or a partial decode on slower devices.
  const decodedImagesRef = useRef<HTMLImageElement[]>([]);

  activeIdxRef.current = activeIdx;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    decodedImagesRef.current = cards.map(({ src }) => {
      const img = new Image();
      img.src = src;
      img.decoding = 'async';
      img.decode().catch(() => {
        // ignore decode failure; transition still runs via normal img load
      });
      return img;
    });
  }, []);

  const advanceTo = useCallback(async (nextIdx: number) => {
    if (transitioningRef.current) return;
    if (nextIdx === activeIdxRef.current) return;
    transitioningRef.current = true;

    try {
      await decodedImagesRef.current[nextIdx]?.decode();
    } catch {
      // ignore; transition still runs
    }

    setPrevIdx(activeIdxRef.current);
    setActiveIdx(nextIdx);

    const cleanupTimer = window.setTimeout(() => {
      setPrevIdx(null);
      transitioningRef.current = false;
    }, FADE_DURATION);

    timersRef.current = [cleanupTimer];
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    setVisible(!document.hidden);
    const onVisibilityChange = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () =>
      document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

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

  const incoming = cards[activeIdx];
  const outgoing = prevIdx !== null ? cards[prevIdx] : null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: activeIdx triggers a fresh shuffle per transition; the value itself is unused inside makePixelDelays
  const pixelDelays = useMemo(() => makePixelDelays(), [activeIdx]);

  return (
    <section className="relative w-full px-5 pt-12 pb-24 md:px-8 md:pt-20 md:pb-32">
      <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-16 md:grid-cols-[1fr_minmax(360px,40%)] md:gap-20">
        <div className="flex flex-col text-center md:items-start md:text-left">
          <div
            className="translate-y-2 animate-[mk-fade-up_0.6s_cubic-bezier(0.16,1,0.3,1)_forwards] text-left text-[11px] text-[color:var(--mk-text-muted)] uppercase tracking-[0.18em] opacity-0 [font-family:var(--mk-font-mono)]"
            style={{ animationDelay: '0ms' }}
          >
            <span aria-hidden="true">{'> '}</span>agi.cash · public beta
          </div>

          <h1
            className="mt-8 translate-y-2 animate-[mk-fade-up_0.6s_cubic-bezier(0.16,1,0.3,1)_forwards] text-balance font-bold text-4xl text-[color:var(--mk-text)] leading-[1.05] tracking-[-0.025em] opacity-0 [font-family:var(--mk-font-mono)] md:mt-10 md:text-7xl"
            style={{ animationDelay: '80ms' }}
          >
            <span className="text-[color:var(--mk-brand)]">Bitcoin</span>
            <br />
            Gift Cards.
          </h1>

          <p
            className="mt-7 max-w-md translate-y-2 animate-[mk-fade-up_0.6s_cubic-bezier(0.16,1,0.3,1)_forwards] text-balance text-[color:var(--mk-text-dim)] text-base leading-relaxed opacity-0 md:text-lg"
            style={{ animationDelay: '160ms' }}
          >
            Buy, send and spend bitcoin gift cards from your favorite merchants.
            All on the most advanced Bitcoin wallet.
          </p>

          <div
            className="mt-9 translate-y-2 animate-[mk-fade-up_0.6s_cubic-bezier(0.16,1,0.3,1)_forwards] opacity-0"
            style={{ animationDelay: '240ms' }}
          >
            <JoinBetaButton size="lg" />
          </div>

          <div
            className="mt-8 translate-y-2 animate-[mk-fade-up_0.6s_cubic-bezier(0.16,1,0.3,1)_forwards] text-[10px] text-[color:var(--mk-text-muted)] uppercase tracking-[0.2em] opacity-0 [font-family:var(--mk-font-mono)]"
            style={{ animationDelay: '320ms' }}
          >
            buy · send · spend
          </div>
        </div>

        <div className="flex justify-center md:justify-end">
          <div
            className="relative mx-auto aspect-square w-full max-w-[320px] md:aspect-[4/3] md:max-w-[460px]"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
          >
            <span
              className={`${specimenCornerBase} top-0 left-0 border-r-0 border-b-0`}
            />
            <span
              className={`${specimenCornerBase} top-0 right-0 border-b-0 border-l-0`}
            />
            <span
              className={`${specimenCornerBase} bottom-0 left-0 border-t-0 border-r-0`}
            />
            <span
              className={`${specimenCornerBase} right-0 bottom-0 border-t-0 border-l-0`}
            />

            <span className={`${specimenMetaBase} top-[-22px] left-0`}>
              {pad3(activeIdx)} / {String(cards.length).padStart(3, '0')}
            </span>
            <span className={`${specimenMetaBase} top-[-22px] right-0`}>
              btc gift card
            </span>
            <a
              href={incoming?.url}
              target="_blank"
              rel="noopener noreferrer"
              className={`${specimenMetaBase} bottom-[-22px] left-0 transition-colors duration-200 hover:text-[color:var(--mk-text)]`}
            >
              {incoming?.label}
            </a>
            <span className={`${specimenMetaBase} right-0 bottom-[-22px]`}>
              {incoming?.location}
            </span>

            <span
              aria-hidden="true"
              className="absolute top-[12%] right-[-20px] bottom-[12%] hidden w-2 border-[color:var(--mk-border)] border-r bg-[length:6px_24px] bg-[repeating-linear-gradient(to_bottom,var(--mk-border)_0,var(--mk-border)_1px,transparent_1px,transparent_24px)] bg-repeat-y [background-position:right] md:block"
            />

            <div className="absolute inset-[14%] grid place-items-center [perspective:1200px] md:inset-[12%]">
              <div
                ref={cardRef}
                className="relative aspect-[1.6/1] w-full rounded-xl shadow-[0_2px_4px_rgba(0,0,0,0.35),0_10px_20px_-6px_rgba(0,0,0,0.55),0_24px_48px_-14px_rgba(0,0,0,0.7),0_50px_90px_-22px_rgba(0,0,0,0.85)] transition-transform duration-[400ms] ease-[cubic-bezier(0.16,1,0.3,1)] [transform-style:preserve-3d] [will-change:transform]"
              >
                <div className="absolute inset-0 overflow-hidden rounded-xl">
                  <svg
                    role="img"
                    aria-label={`${incoming?.label} gift card`}
                    viewBox={`0 0 ${PIXEL_COLS} ${PIXEL_ROWS}`}
                    preserveAspectRatio="none"
                    className="absolute inset-0 block h-full w-full"
                  >
                    <title>{`${incoming?.label} gift card`}</title>
                    {outgoing && (
                      <defs>
                        <mask
                          id={`hero-pixel-mask-${prevIdx}`}
                          maskUnits="userSpaceOnUse"
                          maskContentUnits="userSpaceOnUse"
                          x="0"
                          y="0"
                          width={PIXEL_COLS}
                          height={PIXEL_ROWS}
                        >
                          {pixelDelays.map((delay, idx) => {
                            const col = idx % PIXEL_COLS;
                            const row = Math.floor(idx / PIXEL_COLS);
                            return (
                              <rect
                                // biome-ignore lint/suspicious/noArrayIndexKey: cell positions are stable for the life of the transition
                                key={idx}
                                x={col}
                                y={row}
                                width={1.02}
                                height={1.02}
                                fill="white"
                                className="animate-hero-pixel-cell-out"
                                style={{ animationDelay: `${delay}ms` }}
                              />
                            );
                          })}
                        </mask>
                      </defs>
                    )}
                    <image
                      key={`current-${activeIdx}`}
                      href={incoming?.src}
                      x="0"
                      y="0"
                      width={PIXEL_COLS}
                      height={PIXEL_ROWS}
                      preserveAspectRatio="none"
                    />
                    {outgoing && (
                      <image
                        key={`outgoing-${prevIdx}`}
                        href={outgoing.src}
                        x="0"
                        y="0"
                        width={PIXEL_COLS}
                        height={PIXEL_ROWS}
                        preserveAspectRatio="none"
                        mask={`url(#hero-pixel-mask-${prevIdx})`}
                      />
                    )}
                  </svg>
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 rounded-xl shadow-[inset_0_0_0_1px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.18),inset_0_-1px_0_rgba(0,0,0,0.5),inset_0_0_0_1px_rgba(255,255,255,0.08)]"
                  />
                </div>
              </div>
            </div>

            <div className="absolute inset-x-0 bottom-[-50px] flex items-center justify-center gap-2">
              {cards.map((c, i) => (
                <button
                  key={c.label}
                  type="button"
                  aria-label={`Specimen ${pad3(i)}`}
                  onClick={() => advanceTo(i)}
                  className={`h-0.5 cursor-pointer border-none p-0 transition-[background-color,width] duration-[220ms] ${
                    i === activeIdx
                      ? 'w-9 bg-[color:var(--mk-brand)] hover:bg-[color:var(--mk-brand)]'
                      : 'w-6 bg-[color:var(--mk-border)] hover:bg-[color:var(--mk-border-bright)]'
                  }`}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
