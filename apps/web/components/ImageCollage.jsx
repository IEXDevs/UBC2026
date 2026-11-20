'use client';

/**
 * Image collage. Hover expands a tile the way the React Bits accordion gallery
 * grows the panel under the pointer. Corners stay small.
 */
export default function ImageCollage({ items = [], onOpen }) {
  return (
    <div className="image-collage" role="list">
      {items.map((file, index) => {
        const span = index % 7 === 0 ? 'wide' : index % 4 === 0 ? 'tall' : '';
        return (
          <button
            key={file.id}
            type="button"
            role="listitem"
            className="image-collage__tile"
            data-span={span || undefined}
            aria-label={file.name || 'Image'}
            onClick={() => onOpen?.(file)}
          >
            {file.url ? <img src={file.url} alt="" /> : <span className="image-collage__fill" />}
            <span className="image-collage__name">{file.name || 'Image'}</span>
          </button>
        );
      })}
    </div>
  );
}
