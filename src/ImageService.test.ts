import test from 'node:test';
import assert from 'node:assert/strict';
import { ImageService } from './ImageService.js';
import type { RoonClient } from './RoonClient.js';

function setup(error: string | false = false, mimeType = 'image/jpeg', body = Buffer.from('cover')) {
  let calls = 0;
  const roon = { waitForCore: async () => ({}), getImage: () => ({ get_image: (key: string, options: unknown, callback: Function) => {
    calls++; assert.equal(key, 'cover-key'); assert.deepEqual(options, { width: 600, height: 600, scale: 'fit', format: 'image/jpeg' });
    callback(error, mimeType, body);
  } }) } as unknown as RoonClient;
  return { service: new ImageService(roon), calls: () => calls };
}
test('fetches a Roon key with bounded sizing and returns an MCP-ready image', async () => {
  const { service, calls } = setup();
  assert.deepEqual(await service.getImage('cover-key'), { mimeType: 'image/jpeg', data: Buffer.from('cover').toString('base64') });
  assert.equal(calls(), 1);
});
test('rejects invalid arguments before contacting Roon', async () => {
  const { service, calls } = setup();
  for (const key of ['', 'x'.repeat(513), 'bad\nkey']) await assert.rejects(service.getImage(key));
  for (const size of [0, 1201, 600.5]) await assert.rejects(service.getImage('cover-key', size));
  assert.equal(calls(), 0);
});
test('propagates unavailable artwork and rejects non-image or oversized payloads', async () => {
  for (const fixture of [setup('NotFound'), setup(false, 'text/html'), setup(false, 'image/jpeg', Buffer.alloc(0)), setup(false, 'image/jpeg', Buffer.alloc(3 * 1024 * 1024 + 1))]) {
    await assert.rejects(fixture.service.getImage('cover-key'));
  }
});
