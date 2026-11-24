import { describe, expect, it } from 'vitest';
import { publicPlaylistId } from '../src/lib/player/netease';

describe('public playlist input', () => {
  it.each([
    ['19723756', '19723756'],
    [' 19723756 ', '19723756'],
    ['https://music.163.com/#/playlist?id=19723756', '19723756'],
    ['https://music.163.com/playlist?id=19723756&userid=10', '19723756'],
    ['https://y.music.163.com/m/playlist?id=19723756', '19723756'],
    ['music.163.com/playlist?id=19723756', '19723756'],
    ['https://music.163.com/#/discover/toplist?id=19723756', '19723756'],
  ])('reads %s', (value, expected) => expect(publicPlaylistId(value)).toBe(expected));
  it.each([
    '', '0', '-3', '123abc', '111111111111111111111',
    'https://music.163.com/song?id=10',
    'https://music.163.com/#/user/home?id=10',
    'https://example.com/playlist?id=10',
    'https://music.163.com.example.com/playlist?id=10',
    'https://music.163.com/playlist?id=1/other',
  ])('rejects a value that is not a playlist: %s', (value) => expect(publicPlaylistId(value)).toBeNull());
});
