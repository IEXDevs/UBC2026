import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import test from 'node:test';
import { docxParagraphsFromXml, readPreview, stageKind, unzipEntry } from './file-view.mjs';

function zip(files) {
  const parts = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name);
    const raw = Buffer.from(file.data);
    const compressed = deflateRawSync(raw);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    parts.push(local, compressed);
    offset += local.length + compressed.length;
  }
  return new Uint8Array(Buffer.concat(parts));
}

test('stage kind picks pdf, docx, and code from the name', () => {
  assert.equal(stageKind({ name: 'brief.pdf', type: '' }), 'pdf');
  assert.equal(stageKind({ name: 'notes.docx', type: 'application/octet-stream' }), 'doc');
  assert.equal(stageKind({ name: 'old.doc', type: '' }), 'doc-old');
  assert.equal(stageKind({ name: 'app.tsx', type: '' }), 'code');
  assert.equal(stageKind({ name: 'shot.png', type: 'image/png' }), 'image');
  assert.equal(stageKind({ name: 'clip.webm', type: '' }), 'video');
});

test('a docx opens as paragraphs and skips markup', async () => {
  const xml = [
    '<w:document>',
    '<w:p><w:r><w:t>Hello &amp; welcome</w:t></w:r></w:p>',
    '<w:p><w:r><w:t xml:space="preserve">Second line</w:t></w:r></w:p>',
    '</w:document>',
  ].join('');
  assert.deepEqual(docxParagraphsFromXml(xml), ['Hello & welcome', 'Second line']);
  const packed = zip([{ name: 'word/document.xml', data: xml }]);
  const opened = await unzipEntry(packed, 'word/document.xml');
  const preview = await readPreview('blob:doc', 'doc', async () => new Response(opened ? packed : '', { status: 200 }));
  assert.deepEqual(preview.paragraphs, ['Hello & welcome', 'Second line']);
});

test('code preview returns text and refuses a binary blob', async () => {
  const text = await readPreview('blob:code', 'code', async () => new Response('const n = 1;\n'));
  assert.equal(text.text, 'const n = 1;\n');
  const binary = await readPreview('blob:bin', 'code', async () => new Response(new Uint8Array([65, 0, 66])));
  assert.equal(binary.error, 'binary');
});
