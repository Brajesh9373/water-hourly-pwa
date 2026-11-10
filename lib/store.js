import fs from 'node:fs';
import path from 'node:path';

export function makeStore(folder) {
  fs.mkdirSync(folder, { recursive: true });
  const file = path.join(folder, 'subscriptions.json');

  function read() {
    try {
      const records = JSON.parse(fs.readFileSync(file, 'utf8'));
      return Array.isArray(records) ? records : [];
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  }

  function write(records) {
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(records, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  return {
    all: read,
    get(endpoint) {
      return read().find((r) => r.subscription.endpoint === endpoint) || null;
    },
    upsert(subscription, nextAt) {
      const records = read();
      const idx = records.findIndex((r) => r.subscription.endpoint === subscription.endpoint);
      // Reopening the app should not restart the one-hour countdown.
      const record = { subscription, nextAt: idx >= 0 ? records[idx].nextAt : nextAt };
      if (idx >= 0) records[idx] = record;
      else records.push(record);
      write(records);
      return record;
    },
    reschedule(endpoint, nextAt) {
      const records = read();
      const record = records.find((r) => r.subscription.endpoint === endpoint);
      if (!record) return;
      record.nextAt = nextAt;
      write(records);
    },
    remove(endpoint) {
      const records = read();
      const after = records.filter((r) => r.subscription.endpoint !== endpoint);
      if (after.length !== records.length) write(after);
    }
  };
}
