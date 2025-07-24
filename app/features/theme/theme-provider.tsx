import { createContext, useEffect, useState } from 'react';
import { useRouteLoaderData } from 'react-router';
import { getBgColorForTheme } from './colors';
import type { getThemeCookies } from './theme-cookies.server';
import {
  COLOR_MODE_COOKIE_NAME,
  SYSTEM_COLOR_MODE_COOKIE_NAME,
  THEME_COOKIE_NAME,
  defaultColorMode,
  defaultSystemColorMode,
  defaultTheme,
  themes,
} from './theme.constants';
import type {
  ColorMode,
  Theme,
  ThemeContextType,
  ThemeCookieValues,
} from './theme.types';

export const ThemeContext = createContext<ThemeContextType | undefined>(
  undefined,
);

function saveCookies(
  theme: Theme,
  colorMode: ColorMode,
  systemColorMode: ThemeCookieValues['systemColorMode'],
) {
  if (typeof window === 'object') {
    const oneYear = 60 * 60 * 24 * 365;
    document.cookie = `${THEME_COOKIE_NAME}=${theme}; samesite=lax; max-age=${oneYear}`;
    document.cookie = `${COLOR_MODE_COOKIE_NAME}=${colorMode}; samesite=lax; max-age=${oneYear}`;
    document.cookie = `${SYSTEM_COLOR_MODE_COOKIE_NAME}=${systemColorMode}; samesite=lax; max-age=${oneYear}`;
  }
}

const changeStatusBarColor = (color: string) => {
  console.log('Setting theme color to:', color); // Debug log

  const metaThemeColor = document.querySelector('meta[name="theme-color"]');
  if (metaThemeColor) {
    metaThemeColor.setAttribute('content', color);
  }

  // Also update navigation bar color for Android
  const metaNavButtonColor = document.querySelector(
    'meta[name="msapplication-navbutton-color"]',
  );
  if (metaNavButtonColor) {
    metaNavButtonColor.setAttribute('content', color);
  }

  // Update tile color for Windows/Android
  const metaTileColor = document.querySelector(
    'meta[name="msapplication-TileColor"]',
  );
  if (metaTileColor) {
    metaTileColor.setAttribute('content', color);
  }
};

function updateDocumentClasses(
  theme: Theme,
  effectiveColorMode: 'light' | 'dark',
) {
  if (typeof window === 'undefined') return;

  const root = document.documentElement;

  // Update theme
  for (const t of themes) {
    root.classList.remove(t);
  }
  root.classList.add(theme);

  // Update color mode
  root.classList.remove('light', 'dark');
  root.classList.add(effectiveColorMode);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const rootData = useRouteLoaderData<{
    cookieSettings: ReturnType<typeof getThemeCookies>;
  }>('root');
  const cookieSettings = rootData?.cookieSettings;

  const [theme, setThemeState] = useState<Theme>(
    cookieSettings?.theme || defaultTheme,
  );

  const [colorMode, setColorModeState] = useState<ColorMode>(
    cookieSettings?.colorMode || defaultColorMode,
  );

  const [systemColorMode, setSystemColorMode] = useState<
    ThemeCookieValues['systemColorMode']
  >(() => {
    if (typeof window !== 'object') {
      // Server-side, always use cookie settings if available
      if (cookieSettings?.systemColorMode !== undefined) {
        return cookieSettings.systemColorMode;
      }
      return defaultSystemColorMode;
    }

    // Client-side, check system preference
    return window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  });

  const effectiveColorMode =
    colorMode === 'system' ? systemColorMode : colorMode;

  // Save cookies on first load if they don't exist
  useEffect(() => {
    if (!cookieSettings) {
      saveCookies(theme, colorMode, systemColorMode);
    }
  }, [systemColorMode, colorMode, theme, cookieSettings]);

  // Update color mode when system color mode changes
  useEffect(() => {
    if (colorMode === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = () => {
        const newSystemColorMode = mediaQuery.matches ? 'dark' : 'light';
        setSystemColorMode(newSystemColorMode);
        saveCookies(theme, colorMode, newSystemColorMode);
      };
      mediaQuery.addEventListener('change', handler);
      return () => mediaQuery.removeEventListener('change', handler);
    }
  }, [colorMode, theme]);

  // Update document classes when theme or color mode changes
  useEffect(() => {
    updateDocumentClasses(theme, effectiveColorMode);
    changeStatusBarColor(getBgColorForTheme(theme, effectiveColorMode));
  }, [theme, effectiveColorMode]);

  // Set theme and save cookies
  const setTheme = (newTheme: Theme) => {
    saveCookies(newTheme, colorMode, systemColorMode);
    setThemeState(newTheme);
  };

  // Set color mode and save cookies
  const setColorMode = (newMode: ColorMode) => {
    saveCookies(theme, newMode, systemColorMode);
    setColorModeState(newMode);
  };

  return (
    <ThemeContext.Provider
      value={{
        theme,
        colorMode,
        effectiveColorMode,
        themeClassName: `${theme} ${effectiveColorMode}`,
        setTheme,
        setColorMode,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}
