import { useEffect, useRef, useState } from 'react';
import blockAndBean from '~/assets/gift-cards/blockandbean.agi.cash.webp';
import pinkOwl from '~/assets/gift-cards/pinkowl.agi.cash.webp';
import pubkey from '~/assets/gift-cards/pubkey.agi.cash.webp';
import shack from '~/assets/gift-cards/shack.agi.cash.webp';
import epicurean from '~/assets/gift-cards/theepicureantrader.agi.cash.webp';
import { Section } from '../components/section';
import { SectionLabel } from '../components/section-label';

const cards = [
  { src: pubkey, label: 'PubKey NYC' },
  { src: pinkOwl, label: 'Pink Owl Coffee' },
  { src: shack, label: 'The Shack' },
  { src: blockAndBean, label: 'Block & Bean' },
  { src: epicurean, label: 'The Epicurean Trader' },
];

export function GiftCardsSection() {
  const stackRef = useRef<HTMLDivElement>(null);
  const [fanned, setFanned] = useState(false);

  useEffect(() => {
    const node = stackRef.current;
    if (!node) return;
    const root = node.closest('.marketing');

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setFanned(true);
          observer.disconnect();
        }
      },
      {
        root: root as Element | null,
        threshold: 0.4,
      },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <Section id="gift-cards">
      <div className="grid grid-cols-1 items-center gap-16 md:grid-cols-2 md:gap-20">
        <div>
          <SectionLabel>02_gift_cards</SectionLabel>
          <h2 className="mt-5 font-medium font-mono text-3xl leading-[1.15] tracking-[-0.02em] md:text-5xl">
            Closed-loop ecash for merchants.
          </h2>
          <p className="mt-6 text-[color:var(--mk-text-dim)] text-base leading-relaxed md:text-lg">
            Issue gift cards and stack rewards on the same primitive. 1% fees,
            instant Bitcoin settlement, scan-to-pay at any Square terminal.
          </p>
        </div>

        <div
          ref={stackRef}
          className={`gift-card-stack ${fanned ? 'fanned' : ''}`}
        >
          {cards.map((card) => (
            <div key={card.label} className="stack-card">
              <img
                src={card.src}
                alt={`${card.label} gift card`}
                className="rounded-2xl border border-[color:var(--mk-border)] shadow-[0_30px_60px_-30px_rgba(0,0,0,0.7)]"
              />
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}
