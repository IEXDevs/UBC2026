'use client';

import { Hash, MessageSquare, Mic, Scale, Wallet } from 'lucide-react';

const ICONS = {
  voice: Mic,
  messages: MessageSquare,
  tokens: Hash,
  spent: Wallet,
  pnl: Scale,
};

export default function AccountStats({ rows = [] }) {
  return (
    <ul className="profile-stats">
      {rows.map(row => {
        const Icon = ICONS[row.key] || Hash;
        return (
          <li key={row.key}>
            <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
            <span>{row.label}</span>
            <strong>{row.value}</strong>
          </li>
        );
      })}
    </ul>
  );
}
