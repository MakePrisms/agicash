import type { Config } from 'tailwindcss';

export default {
  darkMode: ['class'],
  content: ['./app/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        chart: {
          '1': 'hsl(var(--chart-1))',
          '2': 'hsl(var(--chart-2))',
          '3': 'hsl(var(--chart-3))',
          '4': 'hsl(var(--chart-4))',
          '5': 'hsl(var(--chart-5))',
        },
      },
      fontFamily: {
        numeric: ['Teko', 'sans-serif'],
        primary: ['Kode Mono', 'monospace'],
      },
      fontSize: {
        '2xs': '0.625rem',
      },
      animation: {
        shake: 'shake 0.2s ease-in-out',
        slam: 'slam 0.4s ease-out both',
        'slide-out-up': 'slide-out-up 300ms ease-out forwards',
      },
      keyframes: {
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '25%': { transform: 'translateX(-5px)' },
          '50%': { transform: 'translateX(5px)' },
          '75%': { transform: 'translateX(-5px)' },
        },
        slam: {
          '0%': {
            transform: 'scale(1)',
            letterSpacing: 'normal',
            opacity: '1',
          },
          '25%': {
            transform: 'scale(1.05)',
            letterSpacing: '0.05em',
            opacity: '0.9',
          },
          '50%': {
            transform: 'scale(0.98)',
            letterSpacing: '-0.02em',
            opacity: '0.95',
          },
          '75%': {
            transform: 'scale(1.02)',
            letterSpacing: '0.02em',
            opacity: '0.98',
          },
          '100%': {
            transform: 'scale(1)',
            letterSpacing: 'normal',
            opacity: '1',
          },
        },
        'slide-out-up': {
          '0%': { transform: 'translateY(0%)', opacity: '1' },
          '100%': { transform: 'translateY(-150%)', opacity: '0' },
        },
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
} satisfies Config;
