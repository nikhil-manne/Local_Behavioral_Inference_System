import { getDb } from './database.js';
try {
  getDb().prepare('ALTER TABLE checkup_logs ADD COLUMN log_message TEXT').run();
  console.log('log_message added to checkup_logs');
} catch(e) {
  console.log(e.message);
}
