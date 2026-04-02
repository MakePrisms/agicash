export interface OutputOptions {
  pretty: boolean;
}

function writeLine(stream: NodeJS.WriteStream, message: string): void {
  stream.write(`${message}\n`);
}

export function formatOutput(data: unknown, options: OutputOptions): string {
  if (options.pretty) {
    return JSON.stringify(data, null, 2);
  }
  return JSON.stringify(data);
}

export function printOutput(data: unknown, options: OutputOptions): void {
  writeLine(process.stdout, formatOutput(data, options));
}

export function printError(
  message: string,
  code: string,
  options: OutputOptions,
): void {
  const output = formatOutput({ error: message, code }, options);
  writeLine(process.stderr, output);
}
