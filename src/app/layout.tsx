import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Solar | وضعیت تجهیزات',
  description: 'ابزار مستقل بررسی و نگه‌داری فهرست وضعیت تجهیزات سولار',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="fa" dir="rtl"><body>{children}</body></html>;
}
