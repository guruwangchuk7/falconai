import type { Config } from 'tailwindcss';

/** Quiet Voltage — the design system from design.md. Token names mirror the landing page's
 *  :root variables so the app and marketing site read as one system. The original six tokens
 *  (canvas, ink, body, muted, hairline, brass) are preserved; the rest complete the palette. */
export default {
  content: ['./app/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#f5f5f5',
        'canvas-soft': '#fafafa',
        surface: '#ffffff',
        'surface-strong': '#f0efed',
        ink: '#0c0a09',
        primary: '#292524',
        'body-strong': '#292524',
        body: '#4e4e4e',
        muted: '#777169',
        'muted-soft': '#a8a29e',
        hairline: '#e7e5e4',
        'hairline-strong': '#d6d3d1',
        brass: '#8f5e12',
        forest: '#3f6b52',
        success: '#16a34a',
        error: '#dc2626',
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['var(--font-instrument)', 'var(--font-inter)', 'ui-sans-serif', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config;
