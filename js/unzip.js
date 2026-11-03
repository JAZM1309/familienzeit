// Kleiner ZIP-Leser ohne fremde Bibliothek (nutzt DecompressionStream des Browsers).
// Unterstützt "gespeichert" und "deflate" – das, was übliche ZIP-Programme erzeugen.

function u8ToBase64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}

async function inflate(data) {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function readZip(file) {
  const buf = await file.arrayBuffer();
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);

  // Ende des Inhaltsverzeichnisses suchen
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Die Datei ist keine gültige ZIP.');

  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const utf8 = new TextDecoder('utf-8');
  const latin = new TextDecoder('latin1');
  const files = {};

  for (let k = 0; k < count; k++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error('Die ZIP ist beschädigt.');
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const csize = view.getUint32(p + 20, true);
    const nlen = view.getUint16(p + 28, true);
    const elen = view.getUint16(p + 30, true);
    const clen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = (flags & 0x800 ? utf8 : latin).decode(bytes.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + elen + clen;

    const lnlen = view.getUint16(local + 26, true);
    const lelen = view.getUint16(local + 28, true);
    const start = local + 30 + lnlen + lelen;
    const raw = bytes.subarray(start, start + csize);
    const dir = name.endsWith('/');

    const data = async () => {
      if (method === 0) return raw;
      if (method === 8) return inflate(raw);
      throw new Error(`Packverfahren ${method} wird nicht unterstützt.`);
    };
    files[name] = {
      dir,
      async: async (type) => {
        const d = await data();
        if (type === 'string') return utf8.decode(d);
        if (type === 'base64') return u8ToBase64(d);
        return d;
      },
    };
  }
  return { files, file: (n) => files[n] };
}
