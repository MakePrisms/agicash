import { useEffect, useRef, useState } from 'react';
import { Section } from '../components/section';
import { SectionLabel } from '../components/section-label';

type State = 'idle' | 'loading' | 'review' | 'paid' | 'received';

const HEADERS: Record<State, { brand: string; right: string }> = {
  idle: { brand: 'agicash', right: 'pink owl' },
  loading: { brand: 'cash app', right: 'pay $7.98' },
  review: { brand: 'cash app', right: 'pay $7.98' },
  paid: { brand: 'cash app', right: 'complete' },
  received: { brand: 'agicash', right: 'received' },
};

const isCashApp = (s: State) =>
  s === 'loading' || s === 'review' || s === 'paid';

const NEXT: Record<State, State> = {
  idle: 'loading',
  loading: 'review', // auto-advances after a brief delay
  review: 'paid',
  paid: 'received',
  received: 'idle',
};

const buyStageBase =
  'buy-stage relative mx-auto flex w-full max-w-[320px] min-h-[380px] flex-col overflow-hidden rounded-[18px] border border-[color:var(--mk-border)] bg-[linear-gradient(180deg,#070d18_0%,#050a13_100%)] px-[22px] pt-[22px] pb-[18px] [font-family:var(--mk-font-display)] shadow-[0_30px_80px_-30px_rgba(0,0,0,0.8),inset_0_1px_0_rgba(255,255,255,0.04)]';

const buyHead =
  'mb-[18px] flex items-center justify-between border-[color:var(--mk-border)] border-b pb-[14px] [font-family:var(--mk-font-mono)] text-[10px] text-[color:var(--mk-text-muted)] uppercase tracking-[0.18em]';

const buyRows =
  'mt-auto flex flex-col gap-2.5 rounded-xl border border-[color:var(--mk-border)] px-4 py-[14px] [font-family:var(--mk-font-mono)]';
const buyRow = 'flex items-center justify-between text-[11px]';
const buyRowLabel =
  'text-[color:var(--mk-text-muted)] uppercase tracking-[0.06em]';
const buyRowValue = 'text-[color:var(--mk-text)]';

const buyPayButtonBase =
  'inline-flex w-full cursor-pointer items-center justify-center rounded-[10px] border border-[color:var(--mk-border)] bg-[rgba(255,255,255,0.04)] px-7 py-3 [font-family:var(--mk-font-mono)] font-medium text-[13px] text-[color:var(--mk-text)] transition-[background-color,border-color] duration-200 hover:border-[color:var(--mk-border-bright)] hover:bg-[rgba(255,255,255,0.08)]';
const buyPayButtonPrimary =
  'inline-flex w-full cursor-pointer items-center justify-center rounded-full border border-white bg-white px-7 py-3 [font-family:var(--mk-font-display)] font-medium text-[13px] text-black transition-[background-color] duration-200 hover:bg-[rgba(255,255,255,0.92)]';

export function BuySection() {
  const prevStateRef = useRef<State>('idle');
  const [state, setState] = useState<State>('idle');

  // Determine transition kind based on whether we're crossing brands.
  // Slide between Agicash ↔ Cash App; fade within Cash App's own steps.
  const isSlide = isCashApp(prevStateRef.current) !== isCashApp(state);
  const transitionClass = isSlide
    ? 'motion-safe:animate-state-slide'
    : 'motion-safe:animate-state-fade';

  useEffect(() => {
    prevStateRef.current = state;
  }, [state]);

  // Loading auto-advances quickly (no button); all other states wait for a
  // click but fall back to advancing automatically after 6s of inactivity.
  useEffect(() => {
    const delay = state === 'loading' ? 1500 : 6000;
    const t = window.setTimeout(() => {
      setState(NEXT[state]);
    }, delay);
    return () => window.clearTimeout(t);
  }, [state]);

  const handleAdvance = () => {
    setState(NEXT[state]);
  };

  const header = HEADERS[state];

  return (
    <Section id="buy">
      <div className="grid grid-cols-1 items-center gap-12 md:grid-cols-2 md:gap-20">
        <div className="text-center md:text-left">
          <SectionLabel>01_buy</SectionLabel>
          <h2 className="mt-8 font-medium font-mono text-3xl leading-[1.15] tracking-[-0.02em] md:mt-10 md:text-5xl">
            Buy a card in seconds.
          </h2>
          <p className="mt-6 text-[color:var(--mk-text-dim)] text-base leading-relaxed md:text-lg">
            Buy a gift card with bitcoin, or use the Cash App to buy directly
            from your bank account.
          </p>
          <div className="mt-6 font-mono text-[10px] text-[color:var(--mk-text-muted)] uppercase tracking-[0.18em]">
            lightning · cash app · settled instantly
          </div>
        </div>

        <div className="flex justify-center">
          <div className={`${buyStageBase} ${state}`}>
            <div className={buyHead}>
              <span>{header.brand}</span>
              <span className="text-[color:var(--mk-text)]">
                {header.right}
              </span>
            </div>
            <div
              className={`flex flex-1 flex-col ${transitionClass}`}
              key={state}
            >
              <div className="flex flex-1 flex-col">
                {state === 'idle' && <PayBody />}
                {state === 'loading' && <LoadingBody />}
                {state === 'review' && <ReviewBody />}
                {state === 'paid' && <PaidBody />}
                {state === 'received' && <ReceivedBody />}
              </div>
              {state !== 'loading' && (
                <div className="mt-4 flex justify-center">
                  {renderCta(state, handleAdvance)}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}

function renderCta(state: State, onClick: () => void) {
  const button = (label: string, primary = false) => (
    <button
      type="button"
      className={primary ? buyPayButtonPrimary : buyPayButtonBase}
      onClick={onClick}
    >
      {label}
    </button>
  );
  switch (state) {
    case 'idle':
      return button('Pay');
    case 'review':
      return button('Confirm and pay', true);
    case 'paid':
      return button('Done', true);
    case 'received':
      return button('OK');
    default:
      return null;
  }
}

function PayBody() {
  return (
    <>
      <div className="mt-1.5 mb-[18px] flex flex-col items-center gap-1 text-center">
        <span className="font-bold text-[38px] text-[color:var(--mk-text)] tabular-nums leading-none tracking-[0.01em] [font-family:var(--mk-font-numeric)]">
          <span className="mr-[0.06em] inline-block align-[0.02em] font-bold text-[0.86em] [font-family:var(--mk-font-mono)]">
            ₿
          </span>
          10,000
        </span>
        <span className="font-semibold text-[18px] text-[color:var(--mk-text-muted)] tabular-nums leading-none [font-family:var(--mk-font-numeric)]">
          $7.98
        </span>
      </div>
      <div className={buyRows}>
        <div className={buyRow}>
          <span className={buyRowLabel}>From</span>
          <span className={buyRowValue}>Cash App</span>
        </div>
        <div className={buyRow}>
          <span className={buyRowLabel}>To</span>
          <span className={buyRowValue}>Pink Owl Coffee</span>
        </div>
      </div>
    </>
  );
}

function LoadingBody() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <span
        aria-hidden="true"
        className="cashapp-spinner h-9 w-9 rounded-full border-[3px] border-[rgba(255,255,255,0.85)] border-r-transparent border-b-transparent border-dashed motion-safe:animate-cashapp-spin"
      />
    </div>
  );
}

function ReviewBody() {
  return (
    <div className="flex flex-col items-start">
      <div
        aria-hidden="true"
        className="mb-2.5 grid h-[38px] w-[38px] place-items-center rounded-full bg-[#00d54f] font-extrabold text-[22px] text-black [font-family:var(--mk-font-display)]"
      >
        $
      </div>
      <div className="cashapp-headline mb-[14px] font-bold text-[22px] text-[color:var(--mk-text)] leading-[1.1] tracking-[-0.02em] [font-family:var(--mk-font-display)]">
        Pay $7.98
      </div>
      <div className="mt-0.5 flex w-full flex-col gap-2 text-[11px] [font-family:var(--mk-font-mono)]">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[color:var(--mk-text-muted)] uppercase tracking-[0.06em]">
            Funding source
          </span>
          <span className="max-w-[58%] truncate text-right text-[color:var(--mk-text)] tabular-nums">
            Debit 9687
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[color:var(--mk-text-muted)] uppercase tracking-[0.06em]">
            To
          </span>
          <span className="max-w-[58%] truncate text-right text-[color:var(--mk-text)] tabular-nums">
            lnbc100u…q97c
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[color:var(--mk-text-muted)] uppercase tracking-[0.06em]">
            Fees
          </span>
          <span className="max-w-[58%] truncate text-right text-[color:var(--mk-text)] tabular-nums">
            Free
          </span>
        </div>
      </div>
    </div>
  );
}

function PaidBody() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center">
      <div
        aria-hidden="true"
        className="cashapp-check mb-4 grid h-12 w-12 place-items-center rounded-full bg-[#00d54f] text-black"
      >
        <svg
          viewBox="0 0 24 24"
          width="28"
          height="28"
          aria-hidden="true"
          className="block h-6 w-6"
        >
          <path
            d="M5 12.5l4.5 4.5L19 8"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <div className="cashapp-headline mb-[14px] font-bold text-[22px] text-[color:var(--mk-text)] leading-[1.1] tracking-[-0.02em] [font-family:var(--mk-font-display)]">
        You paid $7.98
      </div>
    </div>
  );
}

function ReceivedBody() {
  return (
    <>
      <div className="mt-1.5 mb-[18px] flex flex-col items-center gap-1 text-center">
        <span className="font-bold text-[38px] text-[color:var(--mk-text)] tabular-nums leading-none tracking-[0.01em] [font-family:var(--mk-font-numeric)]">
          <span className="mr-[0.06em] inline-block align-[0.02em] font-bold text-[0.86em] [font-family:var(--mk-font-mono)]">
            ₿
          </span>
          10,000
        </span>
        <span className="font-semibold text-[18px] text-[color:var(--mk-text-muted)] tabular-nums leading-none [font-family:var(--mk-font-numeric)]">
          $7.98
        </span>
      </div>
      <div className="mt-auto flex flex-col gap-2.5 rounded-xl border border-[color:var(--mk-border)] px-4 py-[14px] [font-family:var(--mk-font-mono)]">
        <div className="mb-0.5 text-[13px] text-[color:var(--mk-text)]">
          Details
        </div>
        <div className="mb-1 text-[11px] text-[color:var(--mk-text-muted)]">
          Today at 4:48 PM
        </div>
        <div className="flex items-center gap-2.5 text-[12px] text-[color:var(--mk-text)]">
          <span
            aria-hidden="true"
            className="inline-flex h-4 w-4 flex-shrink-0 items-center justify-center text-[#34c759]"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path
                d="M5 12.5l4.5 4.5L19 8"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span>Bought</span>
        </div>
        <div className="flex items-center gap-2.5 text-[12px] text-[color:var(--mk-text)]">
          <span
            aria-hidden="true"
            className="inline-flex h-4 w-4 flex-shrink-0 items-center justify-center text-[color:var(--mk-text-muted)]"
          >
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="3" y="8" width="18" height="4" rx="0.5" />
              <path d="M12 8v13" />
              <path d="M19 12v9H5v-9" />
              <path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8" />
              <path d="M16.5 8a2.5 2.5 0 0 0 0-5C13 3 12 8 12 8" />
            </svg>
          </span>
          <span>Pink Owl Coffee</span>
        </div>
      </div>
    </>
  );
}
