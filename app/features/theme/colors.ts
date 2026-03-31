import type { ColorMode, Theme } from './theme.types';

// These colors are duplicated in app/tailwind.css. When changing make sure to keep them in sync!
export const bgColors = {
  light: {
    usd: 'hsl(178 100% 15%)',
    btc: 'hsl(217, 68%, 35%)',
  },
  dark: 'hsl(0 0% 3.9%)',
};

export const getBgColorForTheme = (theme: Theme, colorMode: ColorMode) => {
  if (colorMode === 'light') {
    return bgColors.light[theme];
  }
  return bgColors.dark;
};
