import './globals.css';
import PrivyRoot from '../components/PrivyRoot';

export const metadata = {
  title: 'Maelstrom',
  description: 'Budget-aware Solana agents with verifiable decisions.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <PrivyRoot>{children}</PrivyRoot>
      </body>
    </html>
  );
}
