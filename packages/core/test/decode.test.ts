import { describe, expect, it } from 'vitest';
import { decodeBytes, type DetectedEncoding } from '../src/index.js';
import { encodeText } from './helpers/encode.js';

const SAMPLE = 'id,name\n1,Привет\n2,Ёлка\n';

describe('decodeBytes', () => {
  it('decodes plain UTF-8', () => {
    const bytes = encodeText('id,name\n1,Привет\n', 'utf-8');
    expect(decodeBytes(bytes)).toEqual({ text: 'id,name\n1,Привет\n', encoding: 'utf-8' });
  });

  it('strips a UTF-8 BOM and reports utf-8', () => {
    const result = decodeBytes(encodeText('id,name\n', 'utf-8', true));
    expect(result.text).toBe('id,name\n');
    expect(result.text.charCodeAt(0)).not.toBe(0xfeff);
    expect(result.encoding).toBe('utf-8');
  });

  it('decodes UTF-16 LE and BE with a BOM, stripping it', () => {
    expect(decodeBytes(encodeText('id,name\n', 'utf-16le'))).toEqual({
      text: 'id,name\n',
      encoding: 'utf-16le',
    });
    expect(decodeBytes(encodeText('id,name\n', 'utf-16be'))).toEqual({
      text: 'id,name\n',
      encoding: 'utf-16be',
    });
  });

  it('falls back to windows-1251 when the bytes are not valid UTF-8', () => {
    const result = decodeBytes(encodeText('id,name\n1,Привет\n', 'windows-1251'));
    expect(result).toEqual({ text: 'id,name\n1,Привет\n', encoding: 'windows-1251' });
  });

  it('falls back to windows-1251 on a lone invalid UTF-8 sequence', () => {
    const result = decodeBytes(Uint8Array.from([0x61, 0x2c, 0xcf, 0x0a]));
    expect(result).toEqual({ text: 'a,П\n', encoding: 'windows-1251' });
  });

  it('keeps valid multi-byte UTF-8 Cyrillic as utf-8, not windows-1251', () => {
    expect(decodeBytes(encodeText('Привет', 'utf-8')).encoding).toBe('utf-8');
  });

  it('trusts an explicit UTF-8 BOM even when later bytes are invalid', () => {
    const bytes = Uint8Array.from([0xef, 0xbb, 0xbf, 0x61, 0xcf, 0x62]);
    const result = decodeBytes(bytes);
    expect(result.encoding).toBe('utf-8');
    expect(result.text).toBe('a�b');
  });

  it('handles empty input and a BOM-only file', () => {
    expect(decodeBytes(new Uint8Array())).toEqual({ text: '', encoding: 'utf-8' });
    expect(decodeBytes(Uint8Array.from([0xff, 0xfe]))).toEqual({ text: '', encoding: 'utf-16le' });
    expect(decodeBytes(Uint8Array.from([0xef, 0xbb, 0xbf]))).toEqual({
      text: '',
      encoding: 'utf-8',
    });
  });

  it('yields identical text for the same logical data in every encoding (AC-5)', () => {
    const cases: [DetectedEncoding, boolean][] = [
      ['utf-8', false],
      ['utf-8', true],
      ['utf-16le', false],
      ['utf-16be', false],
      ['windows-1251', false],
    ];
    const encodings = cases.map(([encoding, bom]) => {
      const result = decodeBytes(encodeText(SAMPLE, encoding, bom));
      expect(result.text).toBe(SAMPLE);
      return result.encoding;
    });
    expect(encodings).toEqual(['utf-8', 'utf-8', 'utf-16le', 'utf-16be', 'windows-1251']);
  });
});
