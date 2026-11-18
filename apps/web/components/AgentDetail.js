'use client';

import FileLibrary from './FileLibrary';

export default function AgentDetail({
  bot,
  files = [],
  ownerId = null,
  getAccessToken = null,
  onResize,
  onMissingFile,
}) {
  return (
    <aside className="agent-detail" aria-label={`${bot.name} files`}>
      <div
        className="pane-resize is-left"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize details"
        onPointerDown={onResize}
      />
      <FileLibrary
        files={files}
        ownerId={ownerId}
        getAccessToken={getAccessToken}
        onMissing={onMissingFile}
      />
    </aside>
  );
}
