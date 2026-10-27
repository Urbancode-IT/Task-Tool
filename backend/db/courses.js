import { getPool } from './index.js';

export class CourseError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.name = 'CourseError';
  }
}

const COURSE_SEED = [
  { course_id: 'CRS-AGE-001', course_type: 'AI', course_name: 'Agentic AI' },
  { course_id: 'CRS-GEN-001', course_type: 'AI', course_name: 'GEN AI' },
  { course_id: 'CRS-RPA-001', course_type: 'Automation', course_name: 'RPA' },
  { course_id: 'CRS-AWS-001', course_type: 'Cloud & Devops', course_name: 'AWS' },
  { course_id: 'CRS-AWS-002', course_type: 'Cloud & Devops', course_name: 'AWS & Devops' },
  { course_id: 'CRS-AZU-001', course_type: 'Cloud & Devops', course_name: 'Azure' },
  { course_id: 'CRS-DEV-001', course_type: 'Cloud & Devops', course_name: 'Devops' },
  { course_id: 'CRS-GCP-001', course_type: 'Cloud & Devops', course_name: 'GCP' },
  { course_id: 'CRS-BOO-001', course_type: 'Communication', course_name: 'Book Reading' },
  { course_id: 'CRS-BUS-001', course_type: 'Communication', course_name: 'Business Communication' },
  { course_id: 'CRS-CRE-001', course_type: 'Communication', course_name: 'Creative Writing & Blogging' },
  { course_id: 'CRS-SAL-001', course_type: 'CRM', course_name: 'Salesforce' },
  { course_id: 'CRS-MON-001', course_type: 'Database', course_name: 'MongoDB' },
  { course_id: 'CRS-MSS-001', course_type: 'Database', course_name: 'MSSQL' },
  { course_id: 'CRS-MYS-001', course_type: 'Database', course_name: 'MySQL' },
  { course_id: 'CRS-POS-001', course_type: 'Database', course_name: 'PostgreSQL' },
  { course_id: 'CRS-SNO-001', course_type: 'Database', course_name: 'Snowflake' },
  { course_id: 'CRS-AIM-001', course_type: 'Data Science', course_name: 'AIML' },
  { course_id: 'CRS-DAT-001', course_type: 'Data Science', course_name: 'Data Analytics' },
  { course_id: 'CRS-DAT-002', course_type: 'Data Science', course_name: 'Data Engineering' },
  { course_id: 'CRS-POW-003', course_type: 'Data Science', course_name: 'Power apps' },
  { course_id: 'CRS-POW-002', course_type: 'Data Science', course_name: 'power Automation' },
  { course_id: 'CRS-EXC-001', course_type: 'Data Visualization', course_name: 'Excel' },
  { course_id: 'CRS-POW-001', course_type: 'Data Visualization', course_name: 'Power BI' },
  { course_id: 'CRS-TAB-001', course_type: 'Data Visualization', course_name: 'Tableau' },
  { course_id: 'CRS-DIG-001', course_type: 'Digital Marketing', course_name: 'Digital marketing' },
  { course_id: 'CRS-IEL-001', course_type: 'English Proficiency Exams', course_name: 'IELTS' },
  { course_id: 'CRS-OET-001', course_type: 'English Proficiency Exams', course_name: 'OET' },
  { course_id: 'CRS-PTE-001', course_type: 'English Proficiency Exams', course_name: 'PTE' },
  { course_id: 'CRS-TOE-001', course_type: 'English Proficiency Exams', course_name: 'TOEFL' },
  { course_id: 'CRS-FRE-001', course_type: 'Foreign Languages', course_name: 'French' },
  { course_id: 'CRS-GER-001', course_type: 'Foreign Languages', course_name: 'German' },
  { course_id: 'CRS-JAP-001', course_type: 'Foreign Languages', course_name: 'Japanese' },
  { course_id: 'CRS-KOR-001', course_type: 'Foreign Languages', course_name: 'Korean' },
  { course_id: 'CRS-SPA-001', course_type: 'Foreign Languages', course_name: 'Spanish' },
  { course_id: 'CRS-ANG-001', course_type: 'Frontend Development', course_name: 'Angular' },
  { course_id: 'CRS-HTM-001', course_type: 'Frontend Development', course_name: 'HTML,CSS,JS' },
  { course_id: 'CRS-REA-002', course_type: 'Frontend Development', course_name: 'ReactJS' },
  { course_id: 'CRS-JAV-002', course_type: 'Fullstack Development', course_name: 'Java Fullstack' },
  { course_id: 'CRS-MEA-001', course_type: 'Fullstack Development', course_name: 'MEAN' },
  { course_id: 'CRS-MER-001', course_type: 'Fullstack Development', course_name: 'MERN' },
  { course_id: 'CRS-.NE-001', course_type: 'Fullstack Development', course_name: '.Net Angular' },
  { course_id: 'CRS-NEX-001', course_type: 'Fullstack Development', course_name: 'NextJS' },
  { course_id: 'CRS-PYT-002', course_type: 'Fullstack Development', course_name: 'Python full stack' },
  { course_id: 'CRS-PYT-001', course_type: 'Fullstack Development', course_name: 'Python stack' },
  { course_id: 'CRS-REA-001', course_type: 'Fullstack Development', course_name: 'React Native' },
  { course_id: 'CRS-SHA-001', course_type: 'Fullstack Development', course_name: 'SharePoint' },
  { course_id: 'CRS-ADO-001', course_type: 'Graphic Designing', course_name: 'Adobe Illustrator' },
  { course_id: 'CRS-ADO-002', course_type: 'Graphic Designing', course_name: 'Adobe Photoshop' },
  { course_id: 'CRS-GRA-001', course_type: 'Graphic Designing', course_name: 'Graphic Designing' },
  { course_id: 'CRS-MED-002', course_type: 'Healthcare', course_name: 'Medical Billing' },
  { course_id: 'CRS-MED-001', course_type: 'Healthcare', course_name: 'Medical Coding' },
  { course_id: 'CRS-CAN-001', course_type: 'KIDS', course_name: 'Canva' },
  { course_id: 'CRS-COR-003', course_type: 'KIDS', course_name: 'Core Python for Kids' },
  { course_id: 'CRS-FRE-002', course_type: 'KIDS', course_name: 'French' },
  { course_id: 'CRS-GER-002', course_type: 'KIDS', course_name: 'German' },
  { course_id: 'CRS-SCR-001', course_type: 'KIDS', course_name: 'Scratch' },
  { course_id: 'CRS-SCR-002', course_type: 'KIDS', course_name: 'Scratch' },
  { course_id: 'CRS-WEB-001', course_type: 'KIDS', course_name: 'Web development' },
  { course_id: 'CRS-CCN-001', course_type: 'Networking', course_name: 'CCNA' },
  { course_id: 'CRS-CYB-001', course_type: 'Networking', course_name: 'Cyber Security' },
  { course_id: 'CRS-OTH-001', course_type: 'Others', course_name: 'other' },
  { course_id: 'CRS-SER-001', course_type: 'Others', course_name: 'Servicenow' },
  { course_id: 'CRS-ADV-002', course_type: 'Programming Languages', course_name: 'Advanced Java' },
  { course_id: 'CRS-ADV-001', course_type: 'Programming Languages', course_name: 'Advanced Python ' },
  { course_id: 'CRS-C-001', course_type: 'Programming Languages', course_name: 'C' },
  { course_id: 'CRS-C++-001', course_type: 'Programming Languages', course_name: 'C++' },
  { course_id: 'CRS-COR-002', course_type: 'Programming Languages', course_name: 'Core Java' },
  { course_id: 'CRS-COR-001', course_type: 'Programming Languages', course_name: 'Core Python' },
  { course_id: 'CRS-DSA-001', course_type: 'Programming Languages', course_name: 'DSA' },
  { course_id: 'CRS-JAV-001', course_type: 'Software Testing', course_name: 'Java' },
  { course_id: 'CRS-JAV-003', course_type: 'Software Testing', course_name: 'Java Selenium' },
  { course_id: 'CRS-PLA-001', course_type: 'Software Testing', course_name: 'Playwright' },
  { course_id: 'CRS-ADO-003', course_type: 'Web Design', course_name: 'Adobe XD' },
  { course_id: 'CRS-FIG-001', course_type: 'Web Design', course_name: 'Figma' },
  { course_id: 'CRS-UI-001', course_type: 'Web Design', course_name: 'UI/UX' },
];

export async function ensureSocialMediaCourses() {
  const p = getPool();
  if (!p) return;
  await p.query(`
    CREATE TABLE IF NOT EXISTS social_media_courses (
      course_id VARCHAR(40) PRIMARY KEY,
      course_type VARCHAR(120) NOT NULL,
      course_name VARCHAR(200) NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await p.query(`
    CREATE INDEX IF NOT EXISTS idx_sm_courses_type
      ON social_media_courses (course_type, course_name);
  `);
  const { rows } = await p.query('SELECT COUNT(*)::int AS n FROM social_media_courses');
  if ((rows[0]?.n || 0) > 0) return;
  for (const item of COURSE_SEED) {
    await p.query(
      `INSERT INTO social_media_courses (course_id, course_type, course_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (course_id) DO NOTHING`,
      [item.course_id, item.course_type, item.course_name]
    );
  }
}

function cleanLabel(value, max) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  if (!text) return '';
  return text.slice(0, max);
}

function prefixFromName(name) {
  const raw = String(name || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  if (!raw) return 'NEW';
  return raw.slice(0, 3).padEnd(3, 'X');
}

async function nextCourseId(courseName) {
  const p = getPool();
  const prefix = prefixFromName(courseName);
  const like = `CRS-${prefix}-%`;
  const { rows } = await p.query(
    `SELECT course_id FROM social_media_courses WHERE course_id ILIKE $1`,
    [like]
  );
  let max = 0;
  for (const row of rows) {
    const match = /-(\d+)$/.exec(String(row.course_id || ''));
    if (match) max = Math.max(max, Number(match[1]) || 0);
  }
  return `CRS-${prefix}-${String(max + 1).padStart(3, '0')}`;
}

export async function listCourses() {
  const p = getPool();
  if (!p) return [];
  const { rows } = await p.query(
    `SELECT course_id, course_type, course_name
     FROM social_media_courses
     WHERE is_active = TRUE
     ORDER BY course_type ASC, course_name ASC, course_id ASC`
  );
  return rows.map((row) => ({
    course_id: row.course_id,
    course_type: row.course_type,
    course_name: row.course_name,
  }));
}

export async function listCourseCategories() {
  const courses = await listCourses();
  const seen = new Set();
  const categories = [];
  for (const item of courses) {
    const key = item.course_type;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    categories.push(key);
  }
  return categories;
}

/** Create a course (and implicitly a new category when course_type is new). */
export async function createCourse(body = {}) {
  const p = getPool();
  if (!p) throw new CourseError(500, 'Database is not available.');
  const courseType = cleanLabel(body.course_type, 120);
  const courseName = cleanLabel(body.course_name, 200);
  if (!courseType) throw new CourseError(400, 'Enter a category.');
  if (!courseName) throw new CourseError(400, 'Enter a course name.');

  const { rows: existing } = await p.query(
    `SELECT course_id, course_type, course_name
     FROM social_media_courses
     WHERE LOWER(course_type) = LOWER($1) AND LOWER(TRIM(course_name)) = LOWER($2)
     LIMIT 1`,
    [courseType, courseName]
  );
  if (existing[0]) {
    return {
      course_id: existing[0].course_id,
      course_type: existing[0].course_type,
      course_name: existing[0].course_name,
    };
  }

  const courseId = cleanLabel(body.course_id, 40) || await nextCourseId(courseName);
  await p.query(
    `INSERT INTO social_media_courses (course_id, course_type, course_name)
     VALUES ($1, $2, $3)`,
    [courseId, courseType, courseName]
  );
  return { course_id: courseId, course_type: courseType, course_name: courseName };
}
