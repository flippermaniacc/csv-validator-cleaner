export type DetectedEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1251';

export interface DecodedText {
  text: string;
  encoding: DetectedEncoding;
}

const utf8Strict = new TextDecoder('utf-8', { fatal: true });
const utf8Lenient = new TextDecoder('utf-8');
const utf16le = new TextDecoder('utf-16le');
const utf16be = new TextDecoder('utf-16be');
const windows1251 = new TextDecoder('windows-1251');

/**
 * Decodes raw file bytes (FR-9), in order: UTF-16 BOM, UTF-8 BOM or valid
 * UTF-8, then `windows-1251` as the last resort. Every decoder strips its own BOM.
 *
 * `windows-1251` maps every byte, so the fallback never fails: a legacy file in
 * another single-byte encoding decodes to wrong text without an error. That is
 * why the detected encoding is reported on every Run.
 */
export function decodeBytes(bytes: Uint8Array): DecodedText {
  const [b0, b1, b2] = bytes;

  if (b0 === 0xff && b1 === 0xfe) return { text: utf16le.decode(bytes), encoding: 'utf-16le' };
  if (b0 === 0xfe && b1 === 0xff) return { text: utf16be.decode(bytes), encoding: 'utf-16be' };

  // An explicit BOM is a declaration of UTF-8, so invalid bytes become U+FFFD
  // instead of silently switching to windows-1251.
  if (b0 === 0xef && b1 === 0xbb && b2 === 0xbf) {
    return { text: utf8Lenient.decode(bytes), encoding: 'utf-8' };
  }

  try {
    return { text: utf8Strict.decode(bytes), encoding: 'utf-8' };
  } catch {
    return { text: windows1251.decode(bytes), encoding: 'windows-1251' };
  }
}
