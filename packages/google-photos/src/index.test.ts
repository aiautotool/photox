import { afterEach, describe, expect, it, vi } from 'vitest';
import { pickedMediaDownloadUrl, transferPickedItems, type PickedMediaItem } from './index';

afterEach(() => vi.restoreAllMocks());

describe('Google Photos migration', () => {
  it('uses the Picker download form for photos and videos', () => {
    expect(pickedMediaDownloadUrl({ id: 'p', mediaFile: { baseUrl: 'https://example/photo', mimeType: 'image/jpeg' } })).toBe('https://example/photo=d');
    expect(pickedMediaDownloadUrl({ id: 'v', mediaFile: { baseUrl: 'https://example/video', mimeType: 'video/mp4' } })).toBe('https://example/video=dv');
  });

  it('continues a batch when one selected item fails', async () => {
    const items: PickedMediaItem[] = [
      { id: '1', mediaFile: { baseUrl: 'https://example/1', filename: '1.jpg', mimeType: 'image/jpeg' } },
      { id: '2', mediaFile: { baseUrl: 'https://example/2', filename: '2.jpg', mimeType: 'image/jpeg' } },
    ];
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('one', { status: 200 }))
      .mockResolvedValueOnce(new Response('two', { status: 200 }));
    const results = await transferPickedItems(items, 'google_drive', async ({ item }) => {
      if (item.id === '1') throw new Error('destination failed');
      return { targetId: 'drive-2' };
    });
    expect(results).toEqual([
      { sourceId: '1', filename: '1.jpg', target: 'google_drive', success: false, error: 'destination failed' },
      { sourceId: '2', filename: '2.jpg', target: 'google_drive', success: true, targetId: 'drive-2' },
    ]);
  });
});
