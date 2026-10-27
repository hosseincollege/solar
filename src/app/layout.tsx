import type { Metadata } from 'next';
import { Vazirmatn } from 'next/font/google';
import './globals.css';
import './solar-workspace.css';

const vazirmatn = Vazirmatn({ subsets: ['arabic'], variable: '--font-vazirmatn', display: 'swap' });

export const metadata: Metadata = {
  title: 'SOLYAR | وضعیت تجهیزات',
  description: 'سامانه سولیار برای بررسی و نگه‌داری فهرست وضعیت تجهیزات',
  icons: { icon: '/favicon.ico' },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="fa" dir="rtl" className={vazirmatn.variable}><body>{children}</body></html>;
}
