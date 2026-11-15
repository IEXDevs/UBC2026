'use client';

import { useState } from 'react';
import { FileText, Film, Globe, Image as ImageIcon, MoreHorizontal, Music } from 'lucide-react';
import { fileKind, filterLibrary, libraryGroups } from '../lib/file-library.mjs';
import BotMark from './BotMark';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'pages', label: 'Pages' },
  { id: 'media', label: 'Media' },
  { id: 'files', label: 'Files' },
];

const PREVIEW_COUNT = 4;

function FileGlyph({ file }) {
  const kind = fileKind(file);
  const type = file.type || '';
  const Icon = kind === 'pages' ? Globe
    : type.startsWith('video/') ? Film
      : type.startsWith('audio/') ? Music
        : type.startsWith('image/') ? ImageIcon
          : FileText;
  return (
    <span className="library-glyph" aria-hidden="true">
      <Icon size={16} strokeWidth={1.75} />
    </span>
  );
}

function FileGroup({ label, files, onOpen }) {
  const [more, setMore] = useState(false);
  if (files.length === 0) return null;
  const shown = more ? files : files.slice(0, PREVIEW_COUNT);
  return (
    <section className="library-group">
      <h3>{label}</h3>
      <ul>
        {shown.map(file => (
          <li key={file.id}>
            <button type="button" onClick={() => onOpen(file)}>
              <FileGlyph file={file} />
              <span>{file.name}</span>
            </button>
          </li>
        ))}
      </ul>
      {files.length > PREVIEW_COUNT && !more ? (
        <button type="button" className="library-more" onClick={() => setMore(true)}>Show more</button>
      ) : null}
    </section>
  );
}

export default function FileLibrary({ bot, files = [], onComputer }) {
  const [filter, setFilter] = useState('all');
  const [preview, setPreview] = useState(null);
  const [menu, setMenu] = useState(false);
  const rows = filterLibrary(files, filter);
  const { fresh, older } = libraryGroups(rows);

  return (
    <div className="file-library">
      <div className="library-menu">
        <button type="button" aria-label="Library menu" aria-expanded={menu} onClick={() => setMenu(value => !value)}>
          <MoreHorizontal size={16} strokeWidth={1.75} />
        </button>
        {menu ? (
          <div role="menu">
            <button type="button" role="menuitem" onClick={() => { setMenu(false); onComputer?.(); }}>Computer</button>
          </div>
        ) : null}
      </div>
      <header>
        <BotMark shape={bot.shape} color={bot.color} size={72} />
        <strong>{bot.name}</strong>
      </header>
      <div className="library-filters" role="tablist" aria-label="Library">
        {FILTERS.map(item => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={filter === item.id}
            className={filter === item.id ? 'is-on' : ''}
            onClick={() => setFilter(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {rows.length === 0 ? <p className="library-empty">No files yet.</p> : null}
      <FileGroup label="This week" files={fresh} onOpen={setPreview} />
      <FileGroup label="Older" files={older} onOpen={setPreview} />
      {preview ? (
        <div className="library-preview" role="dialog" aria-label={preview.name}>
          <button type="button" onClick={() => setPreview(null)}>Close</button>
          {preview.url ? <img src={preview.url} alt="" /> : <strong>{preview.name}</strong>}
          <small>{preview.type || 'file'} · {Math.max(1, Math.round((preview.size || 0) / 1024))} KB</small>
        </div>
      ) : null}
    </div>
  );
}
