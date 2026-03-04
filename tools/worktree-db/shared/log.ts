const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';

export function info(msg: string) {
  console.log(`${CYAN}ℹ${RESET} ${msg}`);
}

export function success(msg: string) {
  console.log(`${GREEN}✓${RESET} ${msg}`);
}

export function warn(msg: string) {
  console.log(`${YELLOW}⚠${RESET} ${msg}`);
}

export function error(msg: string) {
  console.error(`${RED}✗${RESET} ${msg}`);
}

export function step(msg: string) {
  console.log(`${DIM}→${RESET} ${msg}`);
}

export function header(msg: string) {
  console.log(`\n${BOLD}${msg}${RESET}`);
}

export function table(rows: string[][]) {
  if (rows.length === 0) return;
  const colWidths = rows[0].map((_, colIdx) =>
    Math.max(...rows.map((row) => (row[colIdx] ?? '').length)),
  );
  for (const row of rows) {
    const line = row
      .map((cell, i) => (cell ?? '').padEnd(colWidths[i]))
      .join('  ');
    console.log(`  ${line}`);
  }
}
