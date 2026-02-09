import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { LinkWithViewTransition } from '~/lib/transitions';

interface SettingsNavButtonProps {
  children: ReactNode;
  to: string;
}

export function SettingsNavButton({ children, to }: SettingsNavButtonProps) {
  return (
    <LinkWithViewTransition to={to} transition="slideLeft" applyTo="newView">
      <button
        type="button"
        className="flex h-10 w-full cursor-pointer items-center justify-between py-2 [&_svg]:size-4 [&_svg]:shrink-0"
      >
        <div className="flex items-center gap-2">{children}</div>
        <ChevronRight />
      </button>
    </LinkWithViewTransition>
  );
}
