import { useEffect, useRef, useState } from 'react';
import { Section } from '../components/section';
import { SectionLabel } from '../components/section-label';

const TRANSIT_TARGET_MS = 83; // simulated lightning latency
const TRANSIT_DURATION_MS = 1500; // matches transit-fly keyframes

export function SendSection() {
  const railRef = useRef<HTMLDivElement>(null);
  const [played, setPlayed] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const node = railRef.current;
    if (!node) return;
    const root = node.closest('.marketing');
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setPlayed(true);
          obs.disconnect();
        }
      },
      {
        root: root as Element | null,
        // Trigger only when the section reaches the middle of the viewport —
        // shrinks the viewport's effective bottom so it must scroll up further.
        rootMargin: '0px 0px -45% 0px',
        threshold: 0,
      },
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, []);

  // Counter ticks 0 → 0.083s in lockstep with the card animation
  useEffect(() => {
    if (!played) {
      setElapsedMs(0);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const wall = now - start;
      const t = Math.min(1, wall / TRANSIT_DURATION_MS);
      setElapsedMs(Math.round(t * TRANSIT_TARGET_MS));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [played]);

  const handleReplay = () => {
    setPlayed(false);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setPlayed(true));
    });
  };

  const formattedTime = (elapsedMs / 1000).toFixed(3);

  return (
    <Section>
      <div className="grid grid-cols-1 items-center gap-12 md:grid-cols-2 md:gap-20">
        <div className="text-center md:text-left">
          <SectionLabel href="#send">02_send</SectionLabel>
          <h2 className="mt-8 font-medium font-mono text-3xl leading-[1.15] tracking-[-0.02em] md:mt-10 md:text-5xl">
            <a href="#send">Send over text or email.</a>
          </h2>
          <p className="mt-6 text-[color:var(--mk-text-dim)] text-base leading-relaxed md:text-lg">
            Share gift cards over text, email or on any social media platform.
            Gift cards settle instantly and can immediately be spent at the
            merchant&apos;s point of sale.
          </p>
          <div className="mt-6 font-mono text-[10px] text-[color:var(--mk-text-muted)] uppercase tracking-[0.18em]">
            text · email · qr
          </div>
        </div>

        <div className="flex flex-col items-center">
          <div
            ref={railRef}
            className={`transit-rail relative mx-auto w-full max-w-[560px] px-3 ${played ? 'played' : ''}`}
          >
            <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3">
              <div className="rounded-md border border-[color:var(--mk-border)] bg-[color:var(--mk-bg-card)] px-3 py-2 text-left">
                <div className="font-mono text-[9px] text-[color:var(--mk-text-muted)] uppercase tracking-[0.2em]">
                  origin
                </div>
                <div className="mt-1 font-mono text-[color:var(--mk-text)] text-xs">
                  @you
                </div>
              </div>

              <div className="transit-track relative mx-3 h-20">
                <span
                  aria-hidden="true"
                  className="-translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-0 h-2 w-px bg-[color:var(--mk-text-muted)]"
                />
                <span
                  aria-hidden="true"
                  className="-translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-full h-2 w-px bg-[color:var(--mk-text-muted)]"
                />
                <div
                  aria-hidden="true"
                  className="transit-card -translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-0 h-7 w-11 rounded border border-[color:var(--mk-border)] bg-[color:var(--mk-bg-card)] opacity-0 shadow-[0_4px_14px_rgba(0,0,0,0.6)]"
                />
              </div>

              <div className="rounded-md border border-[color:var(--mk-border)] bg-[color:var(--mk-bg-card)] px-3 py-2 text-left">
                <div className="font-mono text-[9px] text-[color:var(--mk-text-muted)] uppercase tracking-[0.2em]">
                  destination
                </div>
                <div className="mt-1 font-mono text-[color:var(--mk-text)] text-xs">
                  @satoshi
                </div>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-between font-mono text-[10px] text-[color:var(--mk-text-muted)] uppercase tracking-[0.18em]">
              <span>transit · {formattedTime}s</span>
              <button
                type="button"
                onClick={handleReplay}
                className="inline-flex cursor-pointer items-center gap-1.5 border-none bg-transparent p-0 text-[11px] text-[color:var(--mk-text-muted)] transition-colors duration-200 [font-family:var(--mk-font-mono)] hover:text-[color:var(--mk-text-dim)]"
              >
                <span aria-hidden="true">{'> '}</span>replay
              </button>
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}
