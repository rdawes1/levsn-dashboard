import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Lake Erie Volunteer Science Network | Water Quality Dashboard',
  description:
    'Live water quality monitoring results from the Lake Erie Volunteer Science Network, a program of the Cleveland Water Alliance.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // The dashboard is dense; allow zoom rather than trapping people on a phone.
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;600;700&family=Bitter:wght@400;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
