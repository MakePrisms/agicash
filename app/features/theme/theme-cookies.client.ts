import {
  COLOR_MODE_COOKIE_NAME,
  SYSTEM_COLOR_MODE_COOKIE_NAME,
  THEME_COOKIE_NAME,
} from './theme.constants';
import type { ColorMode, Theme, ThemeCookieValues } from './theme.types';

function getCookieValue(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? match[1] : null;
}

/**
 * Reads theme cookies directly from document.cookie on the client.
 * Used as a fallback when useRouteLoaderData returns undefined
 * (e.g., during hydration of statically prerendered routes).
 */
export function getClientThemeCookies(): ThemeCookieValues | null {
  const theme = getCookieValue(THEME_COOKIE_NAME) as Theme | null;
  const colorMode = getCookieValue(COLOR_MODE_COOKIE_NAME) as ColorMode | null;
  const systemColorMode = getCookieValue(SYSTEM_COLOR_MODE_COOKIE_NAME) as
    | 'light'
    | 'dark'
    | null;

  if (!theme || !colorMode || !systemColorMode) return null;

  return { theme, colorMode, systemColorMode };
}
