import { useEffect, useState } from 'react';
import { useInterval } from 'usehooks-ts';

function getSecondsRemaining(expiresAt: string | undefined): number {
  if (!expiresAt) return 0;
  return Math.max(
    0,
    Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000),
  );
}

export function useCountdown(expiresAt: string | undefined): number {
  const [secondsRemaining, setSecondsRemaining] = useState(() =>
    getSecondsRemaining(expiresAt),
  );

  useEffect(() => {
    setSecondsRemaining(getSecondsRemaining(expiresAt));
  }, [expiresAt]);

  useInterval(
    () => setSecondsRemaining(getSecondsRemaining(expiresAt)),
    secondsRemaining > 0 && expiresAt ? 1000 : null,
  );

  return secondsRemaining;
}

const SECONDS_IN_MINUTE = 60;
const SECONDS_IN_HOUR = 3600;
const SECONDS_IN_DAY = 86400;

export function formatCountdown(seconds: number): string {
  if (seconds >= SECONDS_IN_DAY) {
    const days = Math.round(seconds / SECONDS_IN_DAY);
    return `~${days}d`;
  }
  if (seconds >= SECONDS_IN_HOUR) {
    const hours = Math.round(seconds / SECONDS_IN_HOUR);
    return `~${hours}h`;
  }
  const m = Math.floor(seconds / SECONDS_IN_MINUTE)
    .toString()
    .padStart(2, '0');
  const s = (seconds % SECONDS_IN_MINUTE).toString().padStart(2, '0');
  return `${m}:${s}`;
}
