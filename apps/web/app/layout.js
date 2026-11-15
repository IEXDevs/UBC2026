import { Figtree } from 'next/font/google';
import './globals.css';
import PrivyRoot from '../components/PrivyRoot';

const chatFont = Figtree({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-chat',
});

export const metadata = {
  title: 'Maelstrom',
  description: 'Budget-aware Solana agents with verifiable decisions.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={chatFont.variable}>
        <PrivyRoot>{children}</PrivyRoot>
      </body>
    </html>
  );
}
