import { Figtree } from 'next/font/google';
import Script from 'next/script';
import './globals.css';
import AcceptTermsAuth from '../components/AcceptTermsAuth';
import PrivyRoot from '../components/PrivyRoot';

// ofetch (inside @privy-io/react-auth) copies globalThis.fetch when its module
// evaluates. This classic script runs before that bundle so Privy's
// accept_terms call hits the hook installAcceptTermsAuth fills in.
const PRIVY_FETCH_HOOK = `(function(){if(window.__maelstromNativeFetch)return;var native=window.fetch.bind(window);window.__maelstromNativeFetch=native;window.fetch=function(input,init){var hook=window.__maelstromFetchHook;if(typeof hook==="function")return hook(input,init);return native(input,init);};})();`;

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
        <Script id="maelstrom-privy-fetch" strategy="beforeInteractive">
          {PRIVY_FETCH_HOOK}
        </Script>
        <AcceptTermsAuth />
        <PrivyRoot>{children}</PrivyRoot>
      </body>
    </html>
  );
}
