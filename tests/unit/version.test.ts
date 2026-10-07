import { describe, expect, it } from 'vitest';
import { VERSION } from '../../src/version.js';

describe('VERSION', () => {
  it('is a semver string from package.json', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
