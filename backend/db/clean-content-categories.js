/**
 * Content Pipeline catalogue clean-up (social_media_courses).
 *
 *   npm run db:clean-categories            -> shows what would change (no writes)
 *   npm run db:clean-categories -- --apply -> makes the changes
 *
 * 1. Hides the categories "Ad", "Website" and "GMB". Those are content types, not
 *    course categories; they were added to the category list by mistake.
 * 2. Removes duplicate Brochure entries: entries with the same category and course
 *    name (spelling "Brouchure" counted as "Brochure"). The entry used by the most
 *    content rows is kept (oldest on a tie); rows that point at a removed duplicate are
 *    moved to the kept one. A misspelled "Brouchure" loses to a correct "Brochure".
 *
 * Nothing is deleted: removed entries get is_active = false, so they disappear from
 * the dropdowns and can be restored by setting is_active back to true.
 */
import { getPool } from './index.js';

const APPLY = process.argv.includes('--apply');
const WRONG_CATEGORIES = ['ad', 'website', 'gmb'];
const isBrochure = (text) => /bro?u?chure/i.test(String(text || ''));
const misspelled = (text) => /brouchure/i.test(String(text || ''));
const normal = (text) => String(text || '').trim().toLowerCase().replace(/brouchure/g, 'brochure').replace(/\s+/g, ' ');

async function main() {
  const p = getPool();
  if (!p) throw new Error('No database connection. Check DB_* in backend/.env.');

  const { rows: courses } = await p.query(
    `SELECT c.course_id, c.course_type, c.course_name, c.created_at,
            (SELECT COUNT(*)::int FROM social_media_tasks t
              WHERE t.production_meta->>'course_id' = c.course_id) AS used_by
       FROM social_media_courses c
      WHERE c.is_active = TRUE
      ORDER BY c.course_type, c.course_name, c.created_at`
  );

  // 1. Ad / Website / GMB categories.
  const wrong = courses.filter((c) => WRONG_CATEGORIES.includes(String(c.course_type).trim().toLowerCase()));

  // 2. Brochure duplicates.
  const groups = new Map();
  for (const c of courses.filter((x) => isBrochure(x.course_type) || isBrochure(x.course_name))) {
    const key = `${normal(c.course_type)}|${normal(c.course_name)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  const duplicates = []; // { remove, keep }
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const ranked = [...list].sort(
      (a, b) =>
        Number(misspelled(a.course_type) || misspelled(a.course_name)) -
          Number(misspelled(b.course_type) || misspelled(b.course_name)) ||
        b.used_by - a.used_by ||
        new Date(a.created_at) - new Date(b.created_at)
    );
    const [keep, ...rest] = ranked;
    rest.forEach((remove) => duplicates.push({ remove, keep }));
  }

  // A misspelled "Brouchure" entry with no twin in its own category: merge it into a
  // correctly spelled course of the same name in another category if there is one,
  // otherwise just correct its spelling.
  const removing = new Set(duplicates.map((d) => d.remove.course_id));
  const renames = [];
  for (const c of courses) {
    if (removing.has(c.course_id) || !(misspelled(c.course_type) || misspelled(c.course_name))) continue;
    const keep = courses.find(
      (x) =>
        x.course_id !== c.course_id &&
        !removing.has(x.course_id) &&
        !misspelled(x.course_name) &&
        normal(x.course_name) === normal(c.course_name)
    );
    if (keep) {
      duplicates.push({ remove: c, keep });
      removing.add(c.course_id);
    } else {
      renames.push(c);
    }
  }
  const fix = (text) => String(text || '').replace(/brouchure/gi, (m) => (m[0] === 'B' ? 'Brochure' : 'brochure'));

  const show = (c) => `${c.course_id}  "${c.course_type} : ${c.course_name}"  (used by ${c.used_by} row(s))`;
  console.log(APPLY ? 'Applying changes.\n' : 'Dry run: nothing is changed. Add --apply to make these changes.\n');

  console.log(`Ad / Website / GMB entries to hide: ${wrong.length}`);
  wrong.forEach((c) => console.log(`  - ${show(c)}`));

  // Rows whose category is one of these still show it in the Category filter until
  // someone picks a proper category on the row; list them so they can be fixed.
  const { rows: rowsUsing } = await p.query(
    `SELECT task_id, production_meta->>'course_type' AS category FROM social_media_tasks
      WHERE LOWER(TRIM(production_meta->>'course_type')) = ANY($1) ORDER BY task_id`,
    [WRONG_CATEGORIES]
  );
  if (rowsUsing.length) {
    console.log(`  Content rows still using these categories (set a proper category on them): ${rowsUsing.length}`);
    rowsUsing.forEach((r) => console.log(`    row #${r.task_id}: ${r.category}`));
  }

  console.log(`\nDuplicate Brochure entries to remove: ${duplicates.length}`);
  duplicates.forEach(({ remove, keep }) => console.log(`  - ${show(remove)}\n      keep ${show(keep)}`));

  console.log(`\nMisspelled entries to correct (no correct twin to merge into): ${renames.length}`);
  renames.forEach((c) => console.log(`  - ${show(c)}  ->  "${fix(c.course_type)} : ${fix(c.course_name)}"`));

  // Rows that still carry the misspelling as text (course or category).
  const { rows: textRows } = await p.query(
    `SELECT COUNT(*)::int AS n FROM social_media_tasks
      WHERE production_meta->>'course' ILIKE '%brouchure%' OR production_meta->>'course_type' ILIKE '%brouchure%'`
  );
  console.log(`\nContent rows whose course / category text reads "Brouchure": ${textRows[0].n}`);

  const brochureAll = courses.filter((x) => isBrochure(x.course_type) || isBrochure(x.course_name));
  if (!duplicates.length && !renames.length && brochureAll.length) {
    console.log('\nBrochure entries found (no duplicates among them):');
    brochureAll.forEach((c) => console.log(`  - ${show(c)}`));
  }

  if (!APPLY) return;

  const client = await p.connect();
  try {
    await client.query('BEGIN');
    for (const c of wrong) {
      await client.query('UPDATE social_media_courses SET is_active = FALSE WHERE course_id = $1', [c.course_id]);
    }
    for (const { remove, keep } of duplicates) {
      // Rows that used the duplicate now point at the entry that stays.
      await client.query(
        `UPDATE social_media_tasks
            SET production_meta = jsonb_set(
                  jsonb_set(jsonb_set(COALESCE(production_meta, '{}'::jsonb), '{course_id}', to_jsonb($2::text)),
                            '{course}', to_jsonb($3::text)),
                  '{course_type}', to_jsonb($4::text)),
                updated_at = CURRENT_TIMESTAMP
          WHERE production_meta->>'course_id' = $1`,
        [remove.course_id, keep.course_id, keep.course_name, keep.course_type]
      );
      await client.query('UPDATE social_media_courses SET is_active = FALSE WHERE course_id = $1', [remove.course_id]);
    }
    for (const c of renames) {
      await client.query('UPDATE social_media_courses SET course_type = $2, course_name = $3 WHERE course_id = $1', [
        c.course_id,
        fix(c.course_type),
        fix(c.course_name),
      ]);
    }
    // Any remaining "Brouchure" text on rows (course, category, topics) is corrected.
    await client.query(
      `UPDATE social_media_tasks
          SET production_meta = production_meta
                || jsonb_build_object(
                     'course', regexp_replace(COALESCE(production_meta->>'course', ''), 'brouchure', 'Brochure', 'gi'),
                     'course_type', regexp_replace(COALESCE(production_meta->>'course_type', ''), 'brouchure', 'Brochure', 'gi'),
                     'content_topics', regexp_replace(COALESCE(production_meta->>'content_topics', ''), 'brouchure', 'Brochure', 'gi')),
              task_title = regexp_replace(task_title, 'brouchure', 'Brochure', 'gi'),
              updated_at = CURRENT_TIMESTAMP
        WHERE production_meta->>'course' ILIKE '%brouchure%'
           OR production_meta->>'course_type' ILIKE '%brouchure%'
           OR task_title ILIKE '%brouchure%'`
    );
    await client.query('COMMIT');
    console.log('\nDone. Reload the Content Pipeline to see the updated lists.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

main()
  .then(() => getPool()?.end())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Clean-up failed:', err.message);
    process.exit(1);
  });
