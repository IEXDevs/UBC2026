'use client';

import { Wallet } from 'lucide-react';
import FileLibrary from './FileLibrary';

export default function AgentDetail({
  bot,
  files = [],
  balanceLabel = '',
  ownerId = null,
  getAccessToken = null,
  onResize,
  onWallet,
  onComputer,
  onEdit,
  onMissingFile,
}) {
  return (
    <aside className="agent-detail" aria-label={`${bot.name} details`}>
      <div
        className="pane-resize is-left"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize details"
        onPointerDown={onResize}
      />
      <div className="detail-tabs">
        <button type="button" className="wallet-chip" onClick={onWallet}>
          <Wallet size={16} strokeWidth={1.75} />
          <span>{balanceLabel || 'Wallet'}</span>
        </button>
      </div>
      <FileLibrary
        bot={bot}
        files={files}
        ownerId={ownerId}
        getAccessToken={getAccessToken}
        onComputer={onComputer}
        onEdit={onEdit}
        onMissing={onMissingFile}
      />
    </aside>
  );
}
