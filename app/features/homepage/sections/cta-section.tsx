import { JoinBetaButton } from '../components/join-beta-button';
import { MarketingCard } from '../components/marketing-card';
import { SectionLabel } from '../components/section-label';

export function CtaSection() {
  return (
    <section className="relative w-full border-[color:var(--mk-border)] border-t px-5 py-20 md:px-8 md:py-28">
      <div className="mx-auto max-w-xl">
        <MarketingCard className="text-center">
          <div className="flex justify-center">
            <SectionLabel href="#join">for_users</SectionLabel>
          </div>
          <h2 className="mt-7 font-medium font-mono text-2xl leading-[1.2] tracking-[-0.02em] md:text-3xl">
            <a href="#join">Be early.</a>
          </h2>
          <p className="mt-4 text-[color:var(--mk-text-dim)] text-base leading-relaxed">
            Agicash is in public beta. Join now to experience the best in
            bitcoin.
          </p>
          <div className="mt-7 flex justify-center">
            <JoinBetaButton size="lg" />
          </div>
        </MarketingCard>
      </div>
    </section>
  );
}
