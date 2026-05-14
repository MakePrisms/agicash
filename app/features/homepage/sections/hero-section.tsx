import { useCallback, useEffect, useRef, useState } from 'react';
import forkAndCoin from '~/assets/gift-cards/forkandcoin.agi.cash.webp';
import kissOfMatcha from '~/assets/gift-cards/kissofmatcha.agi.cash.webp';
import mariposa from '~/assets/gift-cards/mariposa.agi.cash.webp';
import pinkOwl from '~/assets/gift-cards/pinkowl.agi.cash.webp';
import pubkey from '~/assets/gift-cards/pubkey.agi.cash.webp';
import epicurean from '~/assets/gift-cards/theepicureantrader.agi.cash.webp';
import { JoinBetaButton } from '../components/join-beta-button';

const cards = [
  { src: pubkey, label: 'PUBKEY DC', location: 'WASHINGTON, D.C.' },
  { src: epicurean, label: 'EPICUREAN TRADER', location: 'CALIFORNIA' },
  { src: pinkOwl, label: 'PINK OWL COFFEE', location: 'CALIFORNIA' },
  { src: mariposa, label: 'MARIPOSA', location: 'CALIFORNIA' },
  { src: kissOfMatcha, label: 'KISS OF MATCHA', location: 'CALIFORNIA' },
  { src: forkAndCoin, label: 'FORK & COIN', location: 'ILLINOIS' },
];

function pad3(n: number) {
  return String(n + 1).padStart(3, '0');
}

const FADE_DURATION = 600;

const specimenCornerBase =
  'pointer-events-none absolute h-[14px] w-[14px] border border-[color:var(--mk-text-muted)]';
const specimenMetaBase =
  'absolute [font-family:var(--mk-font-mono)] text-[9px] md:text-[10px] tracking-[0.1em] uppercase text-[color:var(--mk-text-muted)]';

export function HeroSection() {
  // imgIdx — the current card (top layer); animates in on key change
  // activeIdx — drives meta labels + active dot (updates immediately at start)
  // prevIdx — outgoing card kept visible underneath while imgIdx fades in
  const [imgIdx, setImgIdx] = useState(0);
  const [activeIdx, setActiveIdx] = useState(0);
  const [prevIdx, setPrevIdx] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(true);
  const cardRef = useRef<HTMLDivElement>(null);
  const activeIdxRef = useRef(activeIdx);
  const imgIdxRef = useRef(imgIdx);
  const transitioningRef = useRef(false);
  const timersRef = useRef<number[]>([]);
  // Holds decoded HTMLImageElements so the browser keeps the bitmaps in
  // cache for the lifetime of the component — guarantees the top layer of
  // the crossfade renders its bitmap on the first frame instead of briefly
  // showing transparent or a partial decode on slower devices.
  const decodedImagesRef = useRef<HTMLImageElement[]>([]);

  activeIdxRef.current = activeIdx;
  imgIdxRef.current = imgIdx;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    decodedImagesRef.current = cards.map(({ src }) => {
      const img = new Image();
      img.src = src;
      img.decoding = 'async';
      img.decode().catch(() => {
        // ignore decode failure; the crossfade will still run via normal load
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
      // ignore; crossfade still runs
    }

    setPrevIdx(imgIdxRef.current);
    setActiveIdx(nextIdx);
    setImgIdx(nextIdx);

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

  const meta = cards[activeIdx];
  const incoming = cards[imgIdx];
  const outgoing = prevIdx !== null ? cards[prevIdx] : null;

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
            <span className={`${specimenMetaBase} bottom-[-22px] left-0`}>
              {meta?.label}
            </span>
            <span className={`${specimenMetaBase} right-0 bottom-[-22px]`}>
              {meta?.location}
            </span>

            <span
              aria-hidden="true"
              className="specimen-ruler-line absolute top-[12%] right-[-20px] bottom-[12%] w-2 border-[color:var(--mk-border)] border-r"
            />

            <div className="absolute inset-[14%] grid place-items-center [perspective:1200px] md:inset-[12%]">
              <div
                ref={cardRef}
                className="relative aspect-[1.6/1] w-full rounded-xl shadow-[0_2px_4px_rgba(0,0,0,0.35),0_10px_20px_-6px_rgba(0,0,0,0.55),0_24px_48px_-14px_rgba(0,0,0,0.7),0_50px_90px_-22px_rgba(0,0,0,0.85)] transition-transform duration-[400ms] ease-[cubic-bezier(0.16,1,0.3,1)] [transform-style:preserve-3d] [will-change:transform]"
              >
                {outgoing && (
                  <img
                    key={`prev-${prevIdx}`}
                    src={outgoing.src}
                    alt=""
                    aria-hidden="true"
                    width={400}
                    height={250}
                    decoding="async"
                    className="absolute inset-0 block h-full w-full rounded-xl object-fill shadow-[inset_0_1px_0_rgba(255,255,255,0.18),inset_0_-1px_0_rgba(0,0,0,0.5),inset_0_0_0_1px_rgba(255,255,255,0.08)]"
                  />
                )}
                <img
                  key={`current-${imgIdx}`}
                  src={incoming?.src}
                  alt={`${incoming?.label} gift card`}
                  width={400}
                  height={250}
                  decoding="async"
                  className="relative block h-full w-full animate-hero-fade-in rounded-xl object-fill shadow-[inset_0_1px_0_rgba(255,255,255,0.18),inset_0_-1px_0_rgba(0,0,0,0.5),inset_0_0_0_1px_rgba(255,255,255,0.08)]"
                />
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
