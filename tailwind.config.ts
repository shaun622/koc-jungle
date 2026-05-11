import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
      },
      colors: {
        tier: {
          centre: 'rgb(var(--tier-centre) / <alpha-value>)',
          top: 'rgb(var(--tier-top) / <alpha-value>)',
          upper: 'rgb(var(--tier-upper) / <alpha-value>)',
          mid: 'rgb(var(--tier-mid) / <alpha-value>)',
          lower: 'rgb(var(--tier-lower) / <alpha-value>)',
          bottom: 'rgb(var(--tier-bottom) / <alpha-value>)',
        },
      },
      keyframes: {
        'pulse-fast': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.4' },
        },
        'flash': {
          '0%, 100%': { backgroundColor: 'rgb(239 68 68 / 0.2)' },
          '50%': { backgroundColor: 'rgb(239 68 68 / 0.6)' },
        },
      },
      animation: {
        'pulse-fast': 'pulse-fast 0.8s ease-in-out infinite',
        flash: 'flash 0.6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
