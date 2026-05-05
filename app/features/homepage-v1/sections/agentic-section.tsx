import { Section } from '../components/section';
import { SectionLabel } from '../components/section-label';
import { TerminalMockup } from '../components/terminal-mockup';

export function AgenticSection() {
  return (
    <Section id="agents">
      <div className="grid grid-cols-1 items-center gap-12 md:grid-cols-[1fr_35%] md:gap-16">
        <div className="order-2 md:order-1">
          <TerminalMockup />
        </div>
        <div className="order-1 md:order-2">
          <SectionLabel>03_agents</SectionLabel>
          <h2 className="mt-5 font-medium font-mono text-3xl leading-[1.15] tracking-[-0.02em] md:text-5xl">
            MCP-native machine payments.
          </h2>
          <p className="mt-6 text-[color:var(--mk-text-dim)] text-base leading-relaxed md:text-lg">
            Agents push payments per call. Per-service budgets. No credentials
            shared.
          </p>
          <div className="mt-6 font-mono text-[color:var(--mk-text-muted)] text-xs md:text-sm">
            mcp · push-only · micropayments
          </div>
        </div>
      </div>
    </Section>
  );
}
