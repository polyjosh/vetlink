import type { ObjectStorage } from '../../src/lib/storage.js';

/** In-memory private storage. Tests "upload" with `put` (what the client's PUT would do). */
export class FakeStorage implements ObjectStorage {
  objects = new Map<string, { size: number; contentType: string }>();
  signedGets: string[] = [];

  put(key: string, size: number, contentType: string) {
    this.objects.set(key, { size, contentType });
  }

  async presignPut(key: string, contentType: string, expiresInS: number) {
    return {
      url: `https://storage.test/upload/${encodeURIComponent(key)}?expires=${expiresInS}`,
      headers: { 'content-type': contentType },
    };
  }

  async presignGet(key: string, expiresInS: number) {
    this.signedGets.push(key);
    return `https://storage.test/view/${encodeURIComponent(key)}?expires=${expiresInS}`;
  }

  async head(key: string) {
    return this.objects.get(key) ?? null;
  }

  async delete(key: string) {
    this.objects.delete(key);
  }

  async copy(fromKey: string, toKey: string) {
    const obj = this.objects.get(fromKey);
    if (!obj) throw new Error(`no such object: ${fromKey}`);
    this.objects.set(toKey, { ...obj });
  }
}
