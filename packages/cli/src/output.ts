export interface OutputOptions {
  pretty: boolean;
}

export function formatOutput(data: unknown, options: OutputOptions): string {
  if (options.pretty) {
    return JSON.stringify(data, null, 2);
  }
  return JSON.stringify(data);
}

export function printOutput(data: unknown, options: OutputOptions): void {
  console.log(formatOutput(data, options));
}

export function printError(
  message: string,
  code: string,
  options: OutputOptions,
): void {
  const output = formatOutput({ error: message, code }, options);
  console.error(output);
}
