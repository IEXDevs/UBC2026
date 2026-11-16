import { Figtree } from 'next/font/google';
import './globals.css';
import CrashGuard from '../components/CrashGuard';
import DeployReload from '../components/DeployReload';
import PrivyRoot from '../components/PrivyRoot';
import { publicPrivyIds } from '../lib/public-env.mjs';

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
  const privy = publicPrivyIds();
  return (
    <html lang="en">
      <body className={chatFont.variable}>
        <DeployReload />
        <CrashGuard>
          <PrivyRoot appId={privy.appId} clientId={privy.clientId}>{children}</PrivyRoot>
        </CrashGuard>
      </body>
    </html>
  );
}
