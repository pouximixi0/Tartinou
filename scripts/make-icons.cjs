// Génère les icônes PNG sans dépendance : fond marine, maison moutarde.
// Usage : node scripts/make-icons.cjs
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const NAVY = [0x14, 0x21, 0x3d];
const MUSTARD = [0xe7, 0xb1, 0x0a];

/** Forme : toit triangulaire + corps avec une porte évidée (coordonnées 0..1). */
function inShape(x, y) {
  if (y >= 0.2 && y <= 0.55 && Math.abs(x - 0.5) <= ((y - 0.2) / 0.35) * 0.33) return true;
  if (x >= 0.26 && x <= 0.74 && y >= 0.55 && y <= 0.8) return !(x >= 0.44 && x <= 0.56 && y >= 0.62);
  return false;
}

let table;
function crc32(buf) {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size) {
  const SS = 4; // sur-échantillonnage pour lisser les bords
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filtre « none »
    for (let x = 0; x < size; x++) {
      let cover = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        if (inShape((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size)) cover++;
      }
      const t = cover / (SS * SS);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      for (let i = 0; i < 3; i++) raw[o + i] = Math.round(NAVY[i] + (MUSTARD[i] - NAVY[i]) * t);
      raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = path.join(__dirname, '..', 'icons');
fs.mkdirSync(out, { recursive: true });
for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  fs.writeFileSync(path.join(out, name), png(size));
  console.log(`icons/${name} (${size}px)`);
}
