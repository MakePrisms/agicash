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

export function BuySection() {
  const prevStateRef = useRef<State>('idle');
  const [state, setState] = useState<State>('idle');

  // Determine transition kind based on whether we're crossing brands.
  // Slide between Agicash ↔ Cash App; fade within Cash App's own steps.
  const transitionClass =
    isCashApp(prevStateRef.current) === isCashApp(state)
      ? 'transition-fade'
      : 'transition-slide';

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
          <div className={`buy-stage ${state}`}>
            <div className="buy-head">
              <span>{header.brand}</span>
              <span className="merchant">{header.right}</span>
            </div>
            <div className={`state-content ${transitionClass}`} key={state}>
              <div className="buy-body">
                {state === 'idle' && <PayBody />}
                {state === 'loading' && <LoadingBody />}
                {state === 'review' && <ReviewBody />}
                {state === 'paid' && <PaidBody />}
                {state === 'received' && <ReceivedBody />}
              </div>
              {state !== 'loading' && (
                <div className="buy-cta">{renderCta(state, handleAdvance)}</div>
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
      className={`buy-pay-button${primary ? ' buy-pay-button-primary' : ''}`}
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
      <div className="buy-amount">
        <span className="sats">
          <span className="btc-symbol">₿</span>10,000
        </span>
        <span className="usd">$7.98</span>
      </div>
      <div className="buy-rows">
        <div className="buy-row">
          <span className="label">From</span>
          <span className="value">Cash App</span>
        </div>
        <div className="buy-row">
          <span className="label">To</span>
          <span className="value">Pink Owl Coffee</span>
        </div>
      </div>
    </>
  );
}

function LoadingBody() {
  return (
    <div className="buy-center">
      <span className="cashapp-spinner" aria-hidden="true" />
    </div>
  );
}

function ReviewBody() {
  return (
    <div className="buy-cashapp-content">
      <div className="cashapp-icon" aria-hidden="true">
        $
      </div>
      <div className="cashapp-headline">Pay $7.98</div>
      <div className="cashapp-rows">
        <div className="cashapp-row">
          <span className="label">Funding source</span>
          <span className="value">Debit 9687</span>
        </div>
        <div className="cashapp-row">
          <span className="label">To</span>
          <span className="value">lnbc100u…q97c</span>
        </div>
        <div className="cashapp-row">
          <span className="label">Fees</span>
          <span className="value">Free</span>
        </div>
      </div>
    </div>
  );
}

function PaidBody() {
  return (
    <div className="buy-cashapp-content buy-center">
      <div className="cashapp-check" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="28" height="28">
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
      <div className="cashapp-headline">You paid $7.98</div>
    </div>
  );
}

function ReceivedBody() {
  return (
    <>
      <div className="buy-amount">
        <span className="sats">
          <span className="btc-symbol">₿</span>10,000
        </span>
        <span className="usd">$7.98</span>
      </div>
      <div className="received-details">
        <div className="received-details-head">Details</div>
        <div className="received-details-time">Today at 4:48 PM</div>
        <div className="received-detail-row">
          <span className="received-icon check" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="14" height="14">
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
        <div className="received-detail-row">
          <span className="received-icon gift" aria-hidden="true">
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
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
