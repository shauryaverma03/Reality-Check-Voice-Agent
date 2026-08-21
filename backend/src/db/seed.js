// Seeds the `checklists` table from the checklist definitions in
// checklists.js. Idempotent (upsert on task_type), so it's safe to call on
// every server startup (db/index.js does this automatically) and also safe
// to re-run by hand after editing a checklist:
//   npm run seed

import { randomUUID } from 'node:crypto';
import { CHECKLISTS_BY_TASK_TYPE } from '../checklists.js';

export function seedChecklists(db) {
  const upsert = db.prepare(`
    INSERT INTO checklists (id, task_type, fields_json)
    VALUES (@id, @task_type, @fields_json)
    ON CONFLICT(task_type) DO UPDATE SET fields_json = excluded.fields_json
  `);
  const seeded = [];
  for (const [taskType, fields] of Object.entries(CHECKLISTS_BY_TASK_TYPE)) {
    upsert.run({ id: randomUUID(), task_type: taskType, fields_json: JSON.stringify(fields) });
    seeded.push(taskType);
  }
  return seeded;
}

// Allow running directly as a CLI script: `node src/db/seed.js`
if (import.meta.url === `file://${process.argv[1]}`) {
  const { db } = await import('./index.js');
  const seeded = seedChecklists(db);
  console.log('Seeded checklists:', seeded.join(', '));
}
