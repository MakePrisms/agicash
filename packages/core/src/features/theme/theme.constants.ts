import type { ColorMode, Theme } from './theme.types';

// Themes - defines styles for currency variants
export const themes: Theme[] = ['usd', 'btc'] as const;

// Color modes - how we determine if dark mode is enabled
export const colorModes: ColorMode[] = ['light', 'dark', 'system'] as const;

// Default values for new users
export const defaultTheme: Theme = 'btc';
export const defaultColorMode: ColorMode = 'system';
export const defaultSystemColorMode = 'light';

// Cookies we need to save to persist theme settings
export const THEME_COOKIE_NAME = 'theme';
export const COLOR_MODE_COOKIE_NAME = 'color-mode';
export const SYSTEM_COLOR_MODE_COOKIE_NAME = 'system-color-mode';
