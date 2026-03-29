import { getCookieValue } from '~/lib/cookies.server';
import {
  COLOR_MODE_COOKIE_NAME,
  SYSTEM_COLOR_MODE_COOKIE_NAME,
  THEME_COOKIE_NAME,
} from '@agicash/sdk/features/theme/theme.constants';
import type { ColorMode, Theme, ThemeCookieValues } from '@agicash/sdk/features/theme/theme.types';

export function getThemeCookies(request: Request): ThemeCookieValues | null {
  const theme = getCookieValue<Theme>(request, THEME_COOKIE_NAME);
  const colorMode = getCookieValue<ColorMode>(request, COLOR_MODE_COOKIE_NAME);
  const systemColorMode = getCookieValue<'light' | 'dark'>(
    request,
    SYSTEM_COLOR_MODE_COOKIE_NAME,
  );

  if (!theme || !colorMode || !systemColorMode) return null;

  return { theme, colorMode, systemColorMode };
}
