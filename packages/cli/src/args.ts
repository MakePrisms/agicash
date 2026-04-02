export interface ParsedArgs {
  command: string;
  positional: string[];
  flags: Record<string, string | boolean>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  if (argv.length === 0) {
    return {
      command: 'help',
      positional: [],
      flags: { pretty: false, verbose: false },
    };
  }

  const first = argv[0];

  if (first === '--help' || first === '-h') {
    return {
      command: 'help',
      positional: [],
      flags: { pretty: false, verbose: false },
    };
  }

  if (first === '--version' || first === '-v') {
    return {
      command: 'version',
      positional: [],
      flags: { pretty: false, verbose: false },
    };
  }

  const command = first;
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {
    pretty: false,
    verbose: false,
  };

  let i = 1;
  while (i < argv.length) {
    const arg = argv[i];

    if (arg.startsWith('--')) {
      const key = arg.slice(2);

      if (key === 'pretty') {
        flags.pretty = true;
        i++;
        continue;
      }

      if (key === 'verbose') {
        flags.verbose = true;
        i++;
        continue;
      }

      // Check if next arg is a value (not another flag)
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i += 2;
      } else {
        flags[key] = true;
        i++;
      }
    } else {
      positional.push(arg);
      i++;
    }
  }

  return { command, positional, flags };
}
