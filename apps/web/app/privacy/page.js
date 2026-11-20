import LegalPage from '../../components/LegalPage';
import { PRIVACY } from '../../lib/legal-copy.mjs';

export const metadata = {
  title: 'Privacy · Maelstrom',
  description: 'What Maelstrom handles about your account, wallet, agents, and files.',
};

export default function PrivacyPage() {
  return <LegalPage doc={PRIVACY} />;
}
