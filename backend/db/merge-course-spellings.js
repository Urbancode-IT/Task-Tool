/**
 * Content Pipeline catalogue: merge courses and categories that are the same name
 * written differently ("Web Methods", "Webmethods", "WebMethods").
 *
 *   npm run db:merge-course-spellings            -> shows what would change (no writes)
 *   npm run db:merge-course-spellings -- --apply -> makes the changes
 *
 * Two names are the same when they match ignoring capitals, spaces, hyphens and
 * underscores ("C" and "C++" stay different). Courses merge only within one category,
 * so "KIDS : French" and "Foreign Languages : French" stay separate; the dry run lists
 * such cross-category names for a person to review.
 * - Categories: every course and content row moves to one spelling of the category.
 * - Courses: one entry is kept (the preferred spelling below, else the one used by the
 *   most content rows, oldest on a tie); rows that pointed at a removed entry are moved
 *   to it, and the removed entries are hidden (is_active = false, so they can be
 *   restored). Course / category text on content rows is corrected to the kept spelling.
 */
import { getPool } from './index.js';

const APPLY = process.argv.includes('--apply');

// Spellings to use when a group contains them (key = squashed name).
const PREFERRED = { webmethods: 'webMethods' };

const squash = (text) => String(text || '').toLowerCase().replace(/[\s_-]+/g, '');
const groupKey = (category, name) => `${squash(category)}|${squash(name)}`;

function pickSpelling(key, candidates) {
  // candidates: [{ text, weight, created_at }]
  if (PREFERRED[key]) return PREFERRED[key];
  const ranked = [...candidates].sort(
    (a, b) => b.weight - a.weight || new Date(a.created_at || 0) - new Date(b.created_at || 0)
  );
  return ranked[0].text;
}

async function main() {
  const p = getPool();
  if (!p) throw new Error('No database connection. Check DB_* in backend/.env.');

  const { rows: courses } = await p.query(
    `SELECT c.course_id, c.course_type, c.course_name, c.created_at,
            (SELECT COUNT(*)::int FROM social_media_tasks t
              WHERE t.production_meta->>'course_id' = c.course_id) AS used_by
       FROM social_media_courses c
      WHERE c.is_active = TRUE
      ORDER BY c.created_at, c.course_id`
  );

  // 1. Category spellings.
  const catGroups = new Map();
  for (const c of courses) {
    const key = squash(c.course_type);
    if (!key) continue;
    if (!catGroups.has(key)) catGroups.set(key, new Map());
    const spellings = catGroups.get(key);
    const s = spellings.get(c.course_type) || { text: c.course_type, weight: 0, created_at: c.created_at };
    s.weight += 1 + c.used_by;
    spellings.set(c.course_type, s);
  }
  const categoryFix = new Map(); // wrong spelling -> kept spelling
  for (const [key, spellings] of catGroups) {
    if (spellings.size < 2 && !PREFERRED[key]) continue;
    const keep = pickSpelling(key, [...spellings.values()]);
    for (const text of spellings.keys()) if (text !== keep) categoryFix.set(text, keep);
  }
  const categoryOf = (text) => categoryFix.get(text) || text;

  // 2. Course duplicates: same name (ignoring capitals / spaces) in the same category.
  const courseGroups = new Map();
  for (const c of courses) {
    if (!squash(c.course_name)) continue;
    const key = groupKey(c.course_type, c.course_name);
    if (!courseGroups.has(key)) courseGroups.set(key, []);
    courseGroups.get(key).push(c);
  }
  const merges = []; // { remove, keep }
  const courseRenames = []; // { course, name, type }
  const nameFix = new Map(); // squashed name -> kept spelling, for row text
  for (const [key, list] of courseGroups) {
    const spelling = pickSpelling(
      key.split('|')[1],
      list.map((c) => ({ text: c.course_name, weight: c.used_by, created_at: c.created_at }))
    );
    nameFix.set(key, spelling);
    if (list.length < 2 && list[0].course_name === spelling) continue;
    const [keep, ...rest] = [...list].sort(
      (a, b) =>
        Number(b.course_name === spelling) - Number(a.course_name === spelling) ||
        b.used_by - a.used_by ||
        new Date(a.created_at) - new Date(b.created_at)
    );
    rest.forEach((remove) => merges.push({ remove, keep }));
    if (keep.course_name !== spelling) courseRenames.push({ course: keep, name: spelling });
  }
  // Courses whose category spelling changes but which are not otherwise touched.
  const removing = new Set(merges.map((m) => m.remove.course_id));
  const categoryOnly = courses.filter(
    (c) => !removing.has(c.course_id) && categoryFix.has(c.course_type) && !courseRenames.some((r) => r.course === c)
  );

  const show = (c) => `${c.course_id}  "${c.course_type} : ${c.course_name}"  (used by ${c.used_by} row(s))`;
  console.log(APPLY ? 'Applying changes.\n' : 'Dry run: nothing is changed. Add -- --apply to make these changes.\n');

  console.log(`Category spellings to unify: ${categoryFix.size}`);
  categoryFix.forEach((keep, wrong) => console.log(`  - "${wrong}"  ->  "${keep}"`));

  console.log(`\nDuplicate courses to merge: ${merges.length}`);
  merges.forEach(({ remove, keep }) => console.log(`  - remove ${show(remove)}\n      keep ${show(keep)}`));

  // Same name in different categories: not merged, only listed for review.
  const byName = new Map();
  for (const c of courses) {
    const k = squash(c.course_name);
    if (!k || removing.has(c.course_id)) continue;
    byName.set(k, [...(byName.get(k) || []), c]);
  }
  const cross = [...byName.values()].filter((list) => new Set(list.map((c) => squash(c.course_type))).size > 1);
  if (cross.length) {
    console.log(`\nSame course name in different categories (NOT merged, review by hand): ${cross.length}`);
    cross.forEach((list) => console.log(`  - ${list.map((c) => `"${c.course_type} : ${c.course_name}"`).join(', ')}`));
  }

  console.log(`\nCourse names to respell: ${courseRenames.length}`);
  courseRenames.forEach(({ course, name }) => console.log(`  - ${show(course)}  ->  "${name}"`));

  // Content rows whose course / category text is a variant spelling.
  const { rows: textRows } = await p.query(
    `SELECT task_id, production_meta->>'course' AS course, production_meta->>'course_type' AS course_type
       FROM social_media_tasks
      WHERE COALESCE(production_meta->>'course', '') <> '' OR COALESCE(production_meta->>'course_type', '') <> ''`
  );
  const rowFixes = [];
  for (const r of textRows) {
    const course = nameFix.get(groupKey(r.course_type, r.course));
    const type = categoryFix.get(r.course_type);
    const next = {
      course: course && course !== r.course ? course : r.course,
      course_type: type || r.course_type,
    };
    if (next.course !== r.course || next.course_type !== r.course_type) rowFixes.push({ id: r.task_id, ...next });
  }
  console.log(`\nContent rows whose course / category text will be corrected: ${rowFixes.length}`);

  if (!APPLY) return;

  const client = await p.connect();
  try {
    await client.query('BEGIN');
    for (const { remove, keep } of merges) {
      const name = nameFix.get(groupKey(keep.course_type, keep.course_name)) || keep.course_name;
      await client.query(
        `UPDATE social_media_tasks
            SET production_meta = COALESCE(production_meta, '{}'::jsonb)
                  || jsonb_build_object('course_id', $2::text, 'course', $3::text, 'course_type', $4::text),
                updated_at = CURRENT_TIMESTAMP
          WHERE production_meta->>'course_id' = $1`,
        [remove.course_id, keep.course_id, name, categoryOf(keep.course_type)]
      );
      await client.query('UPDATE social_media_courses SET is_active = FALSE WHERE course_id = $1', [remove.course_id]);
    }
    for (const { course, name } of courseRenames) {
      await client.query('UPDATE social_media_courses SET course_name = $2, course_type = $3 WHERE course_id = $1', [
        course.course_id,
        name,
        categoryOf(course.course_type),
      ]);
    }
    for (const c of categoryOnly) {
      await client.query('UPDATE social_media_courses SET course_type = $2 WHERE course_id = $1', [
        c.course_id,
        categoryOf(c.course_type),
      ]);
    }
    for (const r of rowFixes) {
      await client.query(
        `UPDATE social_media_tasks
            SET production_meta = COALESCE(production_meta, '{}'::jsonb)
                  || jsonb_build_object('course', $2::text, 'course_type', $3::text),
                updated_at = CURRENT_TIMESTAMP
          WHERE task_id = $1`,
        [r.id, r.course, r.course_type]
      );
    }
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
    console.error('Merge failed:', err.message);
    process.exit(1);
  });
