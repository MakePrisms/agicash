export type Theme = 'usd' | 'btc';
export type ColorMode = 'light' | 'dark' | 'system';

/** Theme settings for figuring out how to render the app*/
export type ThemeCookieValues = {
  theme: Theme;
  colorMode: ColorMode;
  systemColorMode: 'light' | 'dark';
};

export type ThemeContextType = {
  /** color variants for different currencies */
  theme: Theme;
  /** system or user defined */
  colorMode: ColorMode;
  /** light/dark based on color mode and system preference */
  effectiveColorMode: 'light' | 'dark';
  /** the class name to apply to the root for the theme to take effect */
  themeClassName: string;
  setTheme: (theme: Theme) => void;
  setColorMode: (mode: ColorMode) => void;
};
