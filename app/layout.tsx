import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'DASS — UK Dynamic Airspace Status System',
  description: 'DASS Alpha demonstration of dynamic UK Danger Area status information.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
