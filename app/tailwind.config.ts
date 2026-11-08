import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        card: {
          DEFAULT: 'var(--card)',
          foreground: 'var(--card-foreground)',
        },
        primary: {
          DEFAULT: 'var(--primary)',
          foreground: 'var(--primary-foreground)',
        },
        muted: {
          DEFAULT: 'var(--muted)',
          foreground: 'var(--muted-foreground)',
        },
        border: 'var(--border)',
        accent: {
          DEFAULT: 'var(--accent)',
          foreground: 'var(--accent-foreground)',
        },
      },
      keyframes: {
        equalizer: {
          '0%, 100%': { height: '15%' },
          '50%': { height: '100%' },
        },
      },
      animation: {
        equalizer1: 'equalizer 0.8s ease-in-out infinite',
        equalizer2: 'equalizer 0.6s ease-in-out infinite 0.15s',
        equalizer3: 'equalizer 0.9s ease-in-out infinite 0.3s',
        equalizer4: 'equalizer 0.7s ease-in-out infinite 0.1s',
      },
    },
  },
  plugins: [],
};

export default config;
