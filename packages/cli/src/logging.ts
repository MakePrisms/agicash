import { format } from 'node:util';

const consoleMethods = [
  'debug',
  'error',
  'group',
  'groupCollapsed',
  'groupEnd',
  'info',
  'log',
  'trace',
  'warn',
] as const;

type ConsoleMethodName = (typeof consoleMethods)[number];
type ConsoleMethod = (...args: unknown[]) => void;

function writeStderr(message: string): void {
  process.stderr.write(`${message}\n`);
}

export function installSdkConsoleBridge(
  verbose: boolean,
  write: (message: string) => void = writeStderr,
): () => void {
  const originals = new Map<ConsoleMethodName, ConsoleMethod>();

  for (const method of consoleMethods) {
    originals.set(method, console[method].bind(console));
  }

  const emit = (...args: unknown[]) => {
    if (!verbose) {
      return;
    }

    write(format(...args));
  };

  console.debug = (...args: unknown[]) => emit(...args);
  console.error = (...args: unknown[]) => emit(...args);
  console.group = (...args: unknown[]) => emit(...args);
  console.groupCollapsed = (...args: unknown[]) => emit(...args);
  console.groupEnd = () => undefined;
  console.info = (...args: unknown[]) => emit(...args);
  console.log = (...args: unknown[]) => emit(...args);
  console.trace = (...args: unknown[]) => emit(...args);
  console.warn = (...args: unknown[]) => emit(...args);

  return () => {
    for (const method of consoleMethods) {
      const original = originals.get(method);
      if (original) {
        console[method] = original;
      }
    }
  };
}
