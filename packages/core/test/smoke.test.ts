import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from '../src/index.js';

describe('@csv-validator/core', () => {
  it('loads', () => {
    expect(PACKAGE_NAME).toBe('@csv-validator/core');
  });
});
