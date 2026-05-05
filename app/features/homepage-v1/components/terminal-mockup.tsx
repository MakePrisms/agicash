type Line =
  | { kind: 'prompt'; user: string; cmd: string }
  | { kind: 'output'; text: string; tone?: 'default' | 'muted' | 'accent' }
  | { kind: 'blank' };

const lines: Line[] = [
  { kind: 'prompt', user: 'agent', cmd: 'mcp connect agicash' },
  {
    kind: 'output',
    text: 'connected · mint.agi.cash · budget: 5,000 sats',
    tone: 'muted',
  },
  { kind: 'blank' },
  { kind: 'prompt', user: 'agent', cmd: 'pay api.weather.dev --amount 21' },
  {
    kind: 'output',
    text: 'paid 21 sats · 89ms · ref: a1f3…7c2e',
    tone: 'accent',
  },
  { kind: 'blank' },
  { kind: 'prompt', user: 'agent', cmd: 'pay api.search.dev --amount 100' },
  {
    kind: 'output',
    text: 'paid 100 sats · 142ms · ref: 9b4d…0f81',
    tone: 'accent',
  },
  { kind: 'blank' },
  { kind: 'prompt', user: 'agent', cmd: 'budget' },
  {
    kind: 'output',
    text: 'remaining: 4,879 sats · resets in 23h',
    tone: 'muted',
  },
];

export function TerminalMockup() {
  return (
    <div className="overflow-hidden rounded-xl border border-[color:var(--mk-border)] bg-[#0a0e16] shadow-[0_30px_60px_-30px_rgba(0,0,0,0.6)]">
      <div className="flex items-center gap-2 border-[color:var(--mk-border)] border-b bg-[#0d121d] px-4 py-3">
        <span
          aria-hidden="true"
          className="size-2.5 rounded-full bg-[#ff5f56]"
        />
        <span
          aria-hidden="true"
          className="size-2.5 rounded-full bg-[#ffbd2e]"
        />
        <span
          aria-hidden="true"
          className="size-2.5 rounded-full bg-[#27c93f]"
        />
        <div className="ml-3 font-mono text-[11px] text-[color:var(--mk-text-muted)]">
          agent ~ agicash mcp
        </div>
      </div>

      <pre className="overflow-x-auto px-5 py-5 font-mono text-[12px] leading-[1.7] md:text-[13px]">
        <code>
          {lines.map((line, i) => {
            if (line.kind === 'blank') {
              // biome-ignore lint/suspicious/noArrayIndexKey: static list
              return <div key={i}>&nbsp;</div>;
            }
            if (line.kind === 'prompt') {
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: static list
                <div key={i} className="text-[color:var(--mk-text)]">
                  <span className="text-[color:var(--mk-brand)]">
                    {line.user}
                  </span>
                  <span className="text-[color:var(--mk-text-muted)]">
                    {' › '}
                  </span>
                  {line.cmd}
                </div>
              );
            }
            const toneClass =
              line.tone === 'accent'
                ? 'text-[#7be3b8]'
                : line.tone === 'muted'
                  ? 'text-[color:var(--mk-text-muted)]'
                  : 'text-[color:var(--mk-text-dim)]';
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: static list
              <div key={i} className={toneClass}>
                {line.text}
              </div>
            );
          })}
        </code>
      </pre>
    </div>
  );
}
