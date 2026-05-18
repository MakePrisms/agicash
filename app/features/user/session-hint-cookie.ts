/**
 * Non-authoritative hint cookie that mirrors the client-side auth state so the
 * server can short-circuit SSR for unauthenticated users. The real auth check
 * still runs on the client against the Open Secret JWT stored in localStorage;
 * the cookie only saves the loading flicker on the unauthenticated path.
 *
 * Forging this cookie does not bypass auth — protected routes still validate
 * the JWT on the client. The worst case is a forged cookie causing the loading
 * screen to render briefly before the client redirects.
 */

const cookieName = 'agi_session_hint';

const hasSessionHint = (cookieHeader: string | null): boolean => {
  if (!cookieHeader) {
    return false;
  }
  return cookieHeader.split(';').some((entry) => {
    const [name, value] = entry.trim().split('=');
    return name === cookieName && value === '1';
  });
};

const setSessionHint = (maxAgeSeconds: number): void => {
  const safeMaxAge = Math.max(0, Math.floor(maxAgeSeconds));
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${cookieName}=1; Path=/; SameSite=Lax; Max-Age=${safeMaxAge}${secure}`;
};

const clearSessionHint = (): void => {
  document.cookie = `${cookieName}=; Path=/; SameSite=Lax; Max-Age=0`;
};

export const sessionHintCookie = {
  /** Server: parse the Cookie header to check whether the hint is set. */
  isPresent: hasSessionHint,
  /** Client: set the hint with the given lifetime in seconds. */
  set: setSessionHint,
  /** Client: remove the hint. */
  clear: clearSessionHint,
};
