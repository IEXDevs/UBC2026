import { Figtree } from 'next/font/google';
import './globals.css';
import CrashGuard from '../components/CrashGuard';
import DeployReload from '../components/DeployReload';
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
        <DeployReload />
        <CrashGuard>
          <PrivyRoot>{children}</PrivyRoot>
        </CrashGuard>
      </body>
    </html>
  );
}
