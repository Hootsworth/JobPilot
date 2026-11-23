import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '../public/icon');

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function renderJobPilotIconPng(size) {
  // DESIGN.md tokens: #201d1d dark ink background, #fdfcfc cream border + pixel JP mark
  const bg = [0x20, 0x1d, 0x1d, 0xff];
  const fg = [0xfd, 0xfc, 0xfc, 0xff];
  const accent = [0x00, 0x7a, 0xff, 0xff];

  const rowStride = 1 + size * 4;
  const raw = Buffer.alloc(rowStride * size);

  const setPx = (x, y, rgba) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const offset = y * rowStride + 1 + x * 4;
    raw[offset] = rgba[0];
    raw[offset + 1] = rgba[1];
    raw[offset + 2] = rgba[2];
    raw[offset + 3] = rgba[3];
  };

  for (let y = 0; y < size; y++) {
    raw[y * rowStride] = 0; // filter None
    for (let x = 0; x < size; x++) {
      const border = x === 0 || y === 0 || x === size - 1 || y === size - 1;
      setPx(x, y, border ? fg : bg);
    }
  }

  // Minimal terminal prompt emblem centered inside the frame
  const pad = Math.max(3, Math.floor(size * 0.24));
  const thickness = Math.max(1, Math.floor(size * 0.14));
  const midY = Math.floor(size * 0.5);

  // Left bracket bar '['
  for (let y = pad; y < size - pad; y++) {
    for (let t = 0; t < thickness; t++) {
      setPx(pad + t, y, fg);
    }
  }
  for (let x = pad; x < pad + thickness * 2; x++) {
    for (let t = 0; t < thickness; t++) {
      setPx(x, pad + t, fg);
      setPx(x, size - pad - 1 - t, fg);
    }
  }

  // Right cursor dot '■' in accent blue (#007aff)
  const blockSize = Math.max(2, Math.floor(size * 0.22));
  const blockX = size - pad - blockSize;
  const blockY = midY - Math.floor(blockSize / 2);
  for (let y = blockY; y < blockY + blockSize; y++) {
    for (let x = blockX; x < blockX + blockSize; x++) {
      setPx(x, y, accent);
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const idat = deflateSync(raw);
  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', idat),
    makeChunk('IEND', Buffer.alloc(0))
  ]);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const outPath = resolve(OUT_DIR, `icon-${size}.png`);
  writeFileSync(outPath, renderJobPilotIconPng(size));
  console.log(`Generated ${outPath} (${size}x${size})`);
}
