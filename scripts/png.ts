import { deflateSync, inflateSync } from "node:zlib";

// Just enough PNG for the asset scripts and the asset spec: 8-bit, non-interlaced
// greyscale, RGB, palette or RGBA in; RGBA out. No dependency, because the asset
// pipeline should be as checkable as the app.

export interface Image {
  width: number;
  height: number;
  /** RGBA, row-major, 4 bytes per pixel. */
  data: Uint8Array;
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function decodePng(file: Uint8Array): Image {
  const buf = Buffer.from(file);
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error("not a PNG");
  let width = 0;
  let height = 0;
  let colourType = 0;
  let palette: Buffer | null = null;
  let transparency: Buffer | null = null;
  const idat: Buffer[] = [];
  for (let at = 8; at < buf.length; ) {
    const length = buf.readUInt32BE(at);
    const type = buf.toString("ascii", at + 4, at + 8);
    const body = buf.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const depth = body[8];
      colourType = body[9];
      if (depth !== 8) throw new Error(`unsupported bit depth ${depth}`);
      if (body[12] !== 0) throw new Error("interlaced PNGs aren't supported");
    } else if (type === "PLTE") palette = body;
    else if (type === "tRNS") transparency = body;
    else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
    at += 12 + length;
  }
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[colourType];
  if (!channels) throw new Error(`unsupported colour type ${colourType}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const rows = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? rows[y * stride + x - channels] : 0;
      const up = y > 0 ? rows[(y - 1) * stride + x] : 0;
      const corner = x >= channels && y > 0 ? rows[(y - 1) * stride + x - channels] : 0;
      const v = line[x];
      rows[y * stride + x] =
        (filter === 0 ? v : filter === 1 ? v + left : filter === 2 ? v + up : filter === 3 ? v + ((left + up) >> 1) : v + paeth(left, up, corner)) & 0xff;
    }
  }
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = i * channels;
    const d = i * 4;
    if (colourType === 6) data.set(rows.subarray(s, s + 4), d);
    else if (colourType === 2) data.set([rows[s], rows[s + 1], rows[s + 2], 255], d);
    else if (colourType === 0) data.set([rows[s], rows[s], rows[s], 255], d);
    else if (colourType === 4) data.set([rows[s], rows[s], rows[s], rows[s + 1]], d);
    else {
      const p = rows[s];
      if (!palette) throw new Error("palette PNG without PLTE");
      data.set([palette[p * 3], palette[p * 3 + 1], palette[p * 3 + 2], transparency && p < transparency.length ? transparency[p] : 255], d);
    }
  }
  return { width, height, data };
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}

export function encodePng(image: Image): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(image.width, 0);
  ihdr.writeUInt32BE(image.height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = image.width * 4;
  const raw = Buffer.alloc((stride + 1) * image.height);
  for (let y = 0; y < image.height; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(image.data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  return Buffer.concat([SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

export function blank(width: number, height: number): Image {
  return { width, height, data: new Uint8Array(width * height * 4) };
}

export function crop(image: Image, x: number, y: number, width: number, height: number): Image {
  const out = blank(width, height);
  for (let row = 0; row < height; row++) {
    const from = ((y + row) * image.width + x) * 4;
    out.data.set(image.data.subarray(from, from + width * 4), row * width * 4);
  }
  return out;
}

/** The box around every pixel with alpha above `threshold`, or null if there are none. */
export function contentBox(image: Image, threshold = 0): { x: number; y: number; w: number; h: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (image.data[(y * image.width + x) * 4 + 3] > threshold) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** Rotated a quarter turn clockwise: the top edge becomes the right edge. */
export function rotateClockwise(image: Image): Image {
  const out = blank(image.height, image.width);
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const from = (y * image.width + x) * 4;
      const to = (x * out.width + (out.width - 1 - y)) * 4;
      out.data.set(image.data.subarray(from, from + 4), to);
    }
  }
  return out;
}

/** `src` drawn onto `dst` at (x, y), alpha-over. */
export function paste(dst: Image, src: Image, x: number, y: number): void {
  for (let row = 0; row < src.height; row++) {
    for (let col = 0; col < src.width; col++) {
      const s = (row * src.width + col) * 4;
      if (src.data[s + 3] === 0) continue;
      const d = ((y + row) * dst.width + (x + col)) * 4;
      dst.data.set(src.data.subarray(s, s + 4), d);
    }
  }
}
