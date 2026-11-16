import { Figtree } from 'next/font/google';
import './globals.css';
import CrashGuard from '../components/CrashGuard';
import DeployReload from '../components/DeployReload';
import HostedPreview from '../components/HostedPreview';
import PrivyRoot from '../components/PrivyRoot';
import { readHostedDevPreview } from '../lib/hosted-preview.mjs';
import { publicPrivyIds } from '../lib/public-env.mjs';

const chatFont = Figtree({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-chat',
});

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Maelstrom',
  description: 'Budget-aware Solana agents with verifiable decisions.',
};

export default async function RootLayout({ children }) {
  const privy = publicPrivyIds();
  const hostedPreview = await readHostedDevPreview();
  return (
    <html lang="en">
      <body className={chatFont.variable}>
        <DeployReload />
        <HostedPreview enabled={hostedPreview}>
          <CrashGuard>
            <PrivyRoot appId={privy.appId} clientId={privy.clientId}>{children}</PrivyRoot>
          </CrashGuard>
        </HostedPreview>
      </body>
    </html>
  );
}
