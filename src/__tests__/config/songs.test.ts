import { describe, it, expect } from 'vitest';
import { CONTEST_SONGS } from '../../config/songs';

describe('songs config', () => {
  it('should export an array of songs', () => {
    expect(Array.isArray(CONTEST_SONGS)).toBe(true);
    expect(CONTEST_SONGS.length).toBeGreaterThan(0);
  });

  it('each song should have required properties', () => {
    CONTEST_SONGS.forEach(song => {
      expect(song).toHaveProperty('title');
      expect(typeof song.title).toBe('string');
      
      expect(song).toHaveProperty('artist');
      expect(typeof song.artist).toBe('string');
      
      expect(song).toHaveProperty('url');
      expect(typeof song.url).toBe('string');
      expect(song.url.startsWith('http')).toBe(true);
    });
  });

  it('should include specific known contest songs', () => {
    const urls = CONTEST_SONGS.map(s => s.url);
    // 5th song (Rin's song)
    expect(urls).toContain('https://piapro.jp/t/QBdL/20251215094303');
  });
});
