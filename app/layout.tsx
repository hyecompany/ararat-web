import type { Metadata } from 'next';
import { Geist, Geist_Mono, Poppins } from 'next/font/google';
import './globals.css';
import ThemeProvider from '@/app/_context/theme';
import { AuthenticationProvider } from '@/app/_context/authentication';
import Router from './router';
import { EventEmitterProvider } from '@/app/_context/events';
import { Toaster } from 'ui-web/components/sonner';
import { IsClientProvider } from './_context/isClient';
import { IncusProvider } from '@/app/_incus/provider';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

const poppins = Poppins({
  variable: '--font-poppins',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
});

export const metadata: Metadata = {
  title: 'Hye Ararat',
  description: 'Take your infrastructure to its peak',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${poppins.variable} h-svh overflow-hidden antialiased`}
      >
        <IsClientProvider>
          <ThemeProvider>
            <EventEmitterProvider>
              <IncusProvider>
                <AuthenticationProvider>
                  <Router>
                    {children}
                    <Toaster />
                  </Router>
                </AuthenticationProvider>
              </IncusProvider>
            </EventEmitterProvider>
          </ThemeProvider>
        </IsClientProvider>
      </body>
    </html>
  );
}
