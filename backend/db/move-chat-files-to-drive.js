/**
 * Move chat attachments that are still stored in the database into Google Drive.
 *
 *   npm run chat:files-to-drive            -> shows how many files would move (no writes)
 *   npm run chat:files-to-drive -- --apply -> uploads them and frees the database copy
 *
 * Files sent before Drive storage was switched on, or while Drive was unreachable,
 * were kept in chat_attachments.data. Each one is uploaded to the same place new chat
 * files go (Seyal Chat / YYYY-MM / Conversation-<id>), then its database copy is
 * cleared. A file that fails to upload stays in the database and is listed; running
 * the script again retries it.
 */
import { getPool } from './index.js';
import { checkChatDrive, uploadChatFile } from '../driveContent.js';

const APPLY = process.argv.includes('--apply');

async function main() {
  const p = getPool();
  if (!p) throw new Error('No database connection. Check DB_* in backend/.env.');

  const { rows } = await p.query(
    `SELECT a.attachment_id, a.file_name, a.mime_type, a.size_bytes, m.conversation_id
       FROM chat_attachments a
       JOIN chat_messages m ON m.message_id = a.message_id
      WHERE a.drive_file_id IS NULL AND a.data IS NOT NULL
      ORDER BY a.attachment_id`
  );
  const totalMb = rows.reduce((sum, r) => sum + Number(r.size_bytes || 0), 0) / (1024 * 1024);
  console.log(`Chat files still in the database: ${rows.length} (${totalMb.toFixed(1)} MB).`);
  if (!rows.length) return;

  const link = await checkChatDrive();
  console.log(`Drive folder: ${link}`);
  if (!APPLY) {
    console.log('\nDry run. Run again with -- --apply to move them.');
    return;
  }

  let moved = 0;
  const failed = [];
  for (const r of rows) {
    try {
      // One file at a time keeps memory low on the server.
      const { rows: data } = await p.query('SELECT data FROM chat_attachments WHERE attachment_id = $1', [r.attachment_id]);
      const buffer = data[0]?.data;
      if (!buffer) continue;
      const driveId = await uploadChatFile({
        buffer,
        mime: r.mime_type,
        originalName: r.file_name,
        conversationId: r.conversation_id,
      });
      await p.query('UPDATE chat_attachments SET drive_file_id = $1, data = NULL WHERE attachment_id = $2', [
        driveId,
        r.attachment_id,
      ]);
      moved += 1;
      console.log(`  moved #${r.attachment_id} ${r.file_name}`);
    } catch (err) {
      failed.push(r);
      console.warn(`  could not move #${r.attachment_id} ${r.file_name}: ${err?.message || err}`);
    }
  }
  console.log(`\nDone. Moved ${moved}; ${failed.length} left in the database.`);
}

main()
  .then(() => getPool()?.end())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Move failed:', err.message);
    process.exit(1);
  });
