'use client';

import { useState } from 'react';
import { FileText, Film, Image as ImageIcon, Music } from 'lucide-react';
import { formatFileSize } from './Attachments';
import { byRecent, isLibraryImage } from '../lib/file-library.mjs';
import { displayFileName } from '../lib/file-name.mjs';
import FileScroll from './FileScroll';
import FileStage from './FileStage';
import ImageCollage from './ImageCollage';

function FileGlyph({ file }) {
  const type = file?.type || '';
  const Icon = type.startsWith('video/') ? Film
    : type.startsWith('audio/') ? Music
      : type.startsWith('image/') ? ImageIcon
        : FileText;
  return <Icon size={16} strokeWidth={1.75} />;
}

export default function FileLibrary({ files = [], ownerId = null, getAccessToken = null, onMissing = null }) {
  const [pane, setPane] = useState('files');
  const [preview, setPreview] = useState(null);
  const ordered = byRecent(files);
  const images = ordered.filter(isLibraryImage);
  const docs = ordered.filter(file => !isLibraryImage(file));
  const shown = pane === 'images' ? images : docs;

  return (
    <div className="file-library">
      <div className="library-panes" role="tablist" aria-label="Files">
        <button type="button" role="tab" aria-selected={pane === 'files'} onClick={() => setPane('files')}>Files</button>
        <button type="button" role="tab" aria-selected={pane === 'images'} onClick={() => setPane('images')}>Images</button>
      </div>
      {shown.length === 0 ? (
        <p className="library-empty">{pane === 'images' ? 'No images yet.' : 'No files yet.'}</p>
      ) : pane === 'images' ? (
        <ImageCollage items={images} onOpen={setPreview} />
      ) : (
        <FileScroll
          className="file-scroll"
          items={docs.map(file => ({
            id: file.id,
            title: displayFileName(file.name) || file.name || 'File',
            description: formatFileSize(file.size),
            file: { ...file, name: displayFileName(file.name) || file.name },
          }))}
          selectOnScroll
          radius={6}
          gap={2}
          onItemSelect={item => setPreview(item.file)}
          renderItem={item => (
            <>
              <span className="file-rows__lead" aria-hidden="true">
                <FileGlyph file={item.file} />
              </span>
              <span className="file-rows__text">
                <span className="file-rows__title">{item.title}</span>
                {item.description ? <span className="file-rows__description">{item.description}</span> : null}
              </span>
            </>
          )}
        />
      )}
      {preview ? (
        <FileStage
          file={preview}
          ownerId={ownerId}
          getAccessToken={getAccessToken}
          onMissing={onMissing}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </div>
  );
}
