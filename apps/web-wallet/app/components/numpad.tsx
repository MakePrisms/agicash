import { Delete } from 'lucide-react';
import { useEffect } from 'react';
import { getLocaleDecimalSeparator } from '~/lib/locale';
import { Button } from './ui/button';

const buttons = [
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  getLocaleDecimalSeparator(),
  '0',
  'Backspace',
] as const;

export type NumpadButton = (typeof buttons)[number];

const isValidButton = (button: string): button is NumpadButton => {
  return (buttons as readonly string[]).includes(button);
};

type NumpadButtonProps = React.ComponentProps<'button'>;

const NumpadButton = ({ onClick, children, ...props }: NumpadButtonProps) => {
  return (
    <Button
      onClick={onClick}
      className="flex h-full w-full items-center justify-center px-6 text-xl transition-all active:scale-95"
      {...props}
    >
      {children}
    </Button>
  );
};

type NumpadProps = {
  /** Whether to show the decimal button */
  showDecimal: boolean;
  /** Callback when a button is clicked */
  onButtonClick: (button: NumpadButton) => void;
};

/** A component that displays a numpad and handles keyboard input */
export const Numpad = ({ showDecimal, onButtonClick }: NumpadProps) => {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      // Don't handle keyboard event if user is focused on an input element
      const activeElement = document.activeElement;
      const isInputFocused =
        activeElement &&
        (activeElement.tagName === 'INPUT' ||
          activeElement.tagName === 'TEXTAREA' ||
          activeElement.tagName === 'SELECT' ||
          activeElement.getAttribute('contenteditable') === 'true');

      if (isInputFocused) {
        return;
      }

      const key = event.key;
      if (isValidButton(key)) {
        onButtonClick(key);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onButtonClick]);

  return (
    <div
      aria-label="Number pad"
      className="flex w-full flex-col items-center gap-4 sm:hidden"
    >
      <div className="grid w-full max-w-sm grid-cols-3 gap-4 sm:w-auto">
        {buttons.map((button) => {
          if (button === 'Backspace') {
            return (
              <NumpadButton
                key={button}
                aria-label="Delete"
                value={button}
                onClick={() => onButtonClick(button)}
              >
                <Delete className="h-6 w-6" aria-hidden="true" />
              </NumpadButton>
            );
          }

          if (button === '.' && !showDecimal) {
            return <div key={button} />;
          }

          return (
            <NumpadButton
              key={button}
              value={button}
              onClick={() => onButtonClick(button)}
            >
              {button}
            </NumpadButton>
          );
        })}
      </div>
    </div>
  );
};
