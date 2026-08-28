import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'Falcon',
  description: 'An AI teammate for every meeting.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
