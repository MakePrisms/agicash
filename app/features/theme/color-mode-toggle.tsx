import { Moon, Sun, SunMoon } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu';
import { cn } from '~/lib/utils';
import { colorModes } from './theme.constants';
import type { ColorMode } from './theme.types';
import { useTheme } from './use-theme';

export function ColorModeToggle({ className }: { className?: string }) {
  const { colorMode, setColorMode } = useTheme();

  const getIcon = (mode: ColorMode) => {
    switch (mode) {
      case 'light':
        return <Sun className="h-5 w-5" />;
      case 'dark':
        return <Moon className="h-5 w-5" />;
      case 'system':
        return <SunMoon className="h-5 w-5" />;
      default:
        return <Sun className="h-5 w-5" />;
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Current color mode: ${colorMode}. Click to switch.`}
          className={cn(
            className,
            'cursor-pointer focus-visible:outline-hidden',
          )}
        >
          {getIcon(colorMode)}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="mt-2">
        {colorModes.map((mode) => (
          <DropdownMenuItem
            key={mode}
            onClick={() => setColorMode(mode)}
            className="flex items-center gap-2"
          >
            {getIcon(mode)}
            <span className="font-primary capitalize">{mode}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
