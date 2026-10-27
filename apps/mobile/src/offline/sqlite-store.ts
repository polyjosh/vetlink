import * as SQLite from 'expo-sqlite';
import type { OutboxItem, OutboxStore } from './outbox';

/** The outbox on the device (survives app restarts and phone reboots). */
export function sqliteStore(): OutboxStore {
  const db = SQLite.openDatabaseSync('vetlink.db');
  db.execSync(
    'create table if not exists outbox (id text primary key not null, created_at text not null, item text not null)',
  );
  return {
    list: async () =>
      (
        await db.getAllAsync<{ item: string }>('select item from outbox order by created_at, id')
      ).map((r) => JSON.parse(r.item) as OutboxItem),
    put: async (item) => {
      await db.runAsync(
        'insert or replace into outbox (id, created_at, item) values (?, ?, ?)',
        item.id,
        item.createdAt,
        JSON.stringify(item),
      );
    },
    remove: async (id) => {
      await db.runAsync('delete from outbox where id = ?', id);
    },
  };
}
