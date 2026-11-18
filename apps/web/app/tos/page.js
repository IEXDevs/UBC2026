import LegalPage from '../../components/LegalPage';
import { TERMS } from '../../lib/legal-copy.mjs';

export const metadata = {
  title: 'Terms · Maelstrom',
  description: 'Terms for using Maelstrom, including accuracy and liability.',
};

export default function TermsPage() {
  return <LegalPage doc={TERMS} />;
}
