// Reads one file out of a .zip in the browser (stored or deflated entries), so the eBird
// "Download my data" zip can be used without unpacking it first.

const u16 = (d, o) => d.getUint16(o, true);
const u32 = (d, o) => d.getUint32(o, true);

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Lists the entries: [{ name, method, size, offset, compressedSize }]. */
export function listZip(buffer) {
  const view = new DataView(buffer);
  let end = -1;
  for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65557); i -= 1) {
    if (u32(view, i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error('This is not a zip file.');
  const count = u16(view, end + 10);
  let p = u32(view, end + 16);
  const decoder = new TextDecoder();
  const entries = [];
  for (let n = 0; n < count; n += 1) {
    if (u32(view, p) !== 0x02014b50) throw new Error('The zip file is damaged.');
    const method = u16(view, p + 10);
    const compressedSize = u32(view, p + 20);
    const size = u32(view, p + 24);
    const nameLength = u16(view, p + 28);
    const extraLength = u16(view, p + 30);
    const commentLength = u16(view, p + 32);
    const offset = u32(view, p + 42);
    const name = decoder.decode(new Uint8Array(buffer, p + 46, nameLength));
    entries.push({ name, method, size, compressedSize, offset });
    p += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

export async function readZipEntry(buffer, entry) {
  const view = new DataView(buffer);
  const p = entry.offset;
  if (u32(view, p) !== 0x04034b50) throw new Error('The zip file is damaged.');
  const start = p + 30 + u16(view, p + 26) + u16(view, p + 28);
  const data = new Uint8Array(buffer, start, entry.compressedSize);
  if (entry.method === 0) return data.slice();
  if (entry.method === 8) return inflate(data);
  throw new Error('This zip uses a compression method the browser cannot read. Unzip it and choose the .csv file instead.');
}

/** The text of the first entry whose name matches `test`, or null. */
export async function zipText(buffer, test) {
  const entry = listZip(buffer).find((e) => test(e.name));
  if (!entry) return null;
  return new TextDecoder('utf-8').decode(await readZipEntry(buffer, entry));
}
