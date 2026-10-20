import type { DetectedEncoding } from '../../src/index.js';

/** Encodes test text into raw bytes, optionally with a BOM, for each supported encoding. */
export function encodeText(text: string, encoding: DetectedEncoding, withBom = false): Uint8Array {
  switch (encoding) {
    case 'utf-8': {
      const body = Buffer.from(text, 'utf8');
      return withBom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]) : body;
    }
    case 'utf-16le':
      return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
    case 'utf-16be': {
      const le = Buffer.from(text, 'utf16le');
      return Buffer.concat([Buffer.from([0xfe, 0xff]), le.swap16()]);
    }
    case 'windows-1251':
      return encodeWindows1251(text);
  }
}

/** Node has no windows-1251 encoder; ASCII plus the basic Cyrillic block is all the tests need. */
function encodeWindows1251(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0) as number;
    if (code < 0x80) out.push(code);
    else if (code >= 0x410 && code <= 0x44f) out.push(code - 0x410 + 0xc0);
    else if (code === 0x401) out.push(0xa8);
    else if (code === 0x451) out.push(0xb8);
    else throw new Error(`cannot encode U+${code.toString(16)} as windows-1251 in tests`);
  }
  return Uint8Array.from(out);
}
