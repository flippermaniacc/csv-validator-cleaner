import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isLoopbackHost, loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('defaults to loopback, port 3001 and ./data', () => {
    expect(loadConfig({})).toEqual({
      host: '127.0.0.1',
      port: 3001,
      dataDir: resolve(fileURLToPath(new URL('../../../data', import.meta.url))),
      webOrigin: 'http://localhost:5173',
      webDist: expect.stringMatching(/packages[/\\]web[/\\]dist$/),
      allowedHosts: [],
    });
  });

  it('reads overrides from the environment', () => {
    const config = loadConfig({
      HOST: '0.0.0.0',
      PORT: '8080',
      DATA_DIR: '/var/lib/csv',
      WEB_ORIGIN: 'https://app.example',
      WEB_DIST: '/srv/web',
      ALLOWED_HOSTS: ' Csv.Example , ,other.local ',
    });
    expect(config).toEqual({
      host: '0.0.0.0',
      port: 8080,
      dataDir: '/var/lib/csv',
      webOrigin: 'https://app.example',
      webDist: '/srv/web',
      allowedHosts: ['csv.example', 'other.local'],
    });
  });

  it.each(['abc', '1.5', '-1', '70000'])('rejects PORT=%s', (PORT) => {
    expect(() => loadConfig({ PORT })).toThrow(/PORT/);
  });

  it('accepts port 0 for ephemeral ports', () => {
    expect(loadConfig({ PORT: '0' }).port).toBe(0);
  });
});

describe('isLoopbackHost', () => {
  it.each(['127.0.0.1', 'localhost', 'LOCALHOST', '::1', '[::1]'])(
    'treats %s as loopback',
    (host) => {
      expect(isLoopbackHost(host)).toBe(true);
    },
  );

  it.each(['0.0.0.0', '192.168.1.5', 'example.com', '::'])('treats %s as exposed', (host) => {
    expect(isLoopbackHost(host)).toBe(false);
  });
});
