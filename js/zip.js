// Kleiner ZIP-Schreiber (ohne Komprimierung) für den Datenexport
const enc = new TextEncoder();
let crcTable;

function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function dosTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export class ZipWriter {
  constructor() { this.files = []; }

  add(path, data) {
    const bytes = typeof data === 'string' ? enc.encode(data) : new Uint8Array(data);
    this.files.push({ name: enc.encode(path), bytes, crc: crc32(bytes) });
  }

  blob() {
    const { time, date } = dosTime(new Date());
    const parts = [];
    const central = [];
    let offset = 0;
    for (const f of this.files) {
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint16(10, time, true); h.setUint16(12, date, true); h.setUint32(14, f.crc, true);
      h.setUint32(18, f.bytes.length, true); h.setUint32(22, f.bytes.length, true);
      h.setUint16(26, f.name.length, true); h.setUint16(28, 0, true);
      parts.push(h.buffer, f.name, f.bytes);

      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
      c.setUint16(10, 0, true); c.setUint16(12, time, true); c.setUint16(14, date, true); c.setUint32(16, f.crc, true);
      c.setUint32(20, f.bytes.length, true); c.setUint32(24, f.bytes.length, true); c.setUint16(28, f.name.length, true);
      c.setUint32(42, offset, true);
      central.push(c.buffer, f.name);
      offset += 30 + f.name.length + f.bytes.length;
    }
    const size = central.reduce((n, p) => n + (p.byteLength ?? p.length), 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, this.files.length, true); end.setUint16(10, this.files.length, true);
    end.setUint32(12, size, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
  }
}
