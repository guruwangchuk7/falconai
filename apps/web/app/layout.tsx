import './globals.css';
import type { ReactNode } from 'react';
import { Inter, Instrument_Sans } from 'next/font/google';

// Quiet Voltage type roles (design.md): Inter for body/UI, Instrument Sans for display/headings.
// Self-hosted via next/font — no layout shift, no external Google Fonts request at runtime.
const inter = Inter({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-inter', display: 'swap' });
const instrument = Instrument_Sans({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-instrument', display: 'swap' });

export const metadata = {
  title: 'Falcon',
  description: 'An AI teammate for every meeting.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${instrument.variable}`}>
      <body>{children}</body>
    </html>
  );
}
