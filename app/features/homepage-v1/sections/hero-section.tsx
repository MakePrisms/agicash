import logoUrl from '~/assets/full_logo.png';
import { JoinBetaButton } from '../components/join-beta-button';

export function HeroSection() {
  return (
    <section className="relative w-full px-5 pt-10 pb-20 md:px-8 md:pt-14 md:pb-32">
      <header>
        <img src={logoUrl} alt="Agicash" className="h-7 opacity-80 md:h-8" />
      </header>

      <div className="mx-auto flex min-h-[60vh] max-w-4xl flex-col items-center justify-center pt-16 text-center md:min-h-[70vh] md:pt-24">
        <div className="stagger flex w-full flex-col items-center">
          <h1 className="text-balance">
            <span className="block font-mono font-normal text-2xl text-[color:var(--mk-text)] leading-[1.1] tracking-[-0.02em] md:text-4xl">
              Your <span className="text-[color:var(--mk-brand)]">Bitcoin</span>{' '}
              wallet for
            </span>
            <span className="mt-3 block font-bold font-mono text-4xl text-[color:var(--mk-text)] leading-[1.05] tracking-[-0.025em] md:mt-4 md:text-7xl">
              Gift cards, Rewards and Agents
            </span>
          </h1>

          <p className="mt-8 max-w-xl text-balance text-[color:var(--mk-text-dim)] text-base leading-relaxed md:mt-10 md:text-lg">
            Bitcoin payments, built for humans and machines. Self-custodial
            wallet, closed-loop merchant ecash, and MCP-native machine payments.
          </p>

          <div className="mt-10 md:mt-12">
            <JoinBetaButton size="lg" />
          </div>
        </div>
      </div>
    </section>
  );
}
