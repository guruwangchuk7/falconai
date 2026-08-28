import type { Config } from 'tailwindcss';

export default {
  content: ['./app/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#f5f5f5',
        ink: '#0c0a09',
        body: '#4e4e4e',
        muted: '#777169',
        hairline: '#e7e5e4',
        brass: '#8f5e12',
      },
    },
  },
  plugins: [],
} satisfies Config;
