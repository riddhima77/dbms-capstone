import fs from 'fs';
import path from 'path';
import { PGlite } from '@electric-sql/pglite';
import { hashPassword } from './auth.js';

let dbInstance: PGlite | null = null;
let initPromise: Promise<PGlite> | null = null;

export const DEMO_PORTAL_ACCOUNTS = [
  {
    code: 'ADM-001',
    fullName: 'Dr. Elena Vance',
    email: 'dean.vance@college.edu',
    role: 'ADMIN' as const,
    dept: 'Academic Affairs',
    label: 'Registrar / Admin',
    demoPasscode: 'Admin#2026',
  },
  {
    code: 'FAC-101',
    fullName: 'Prof. David Morales',
    email: 'prof.morales@college.edu',
    role: 'FACULTY' as const,
    dept: 'Computer Science',
    label: 'Faculty',
    demoPasscode: 'Faculty#2026',
  },
  {
    code: 'STU-2026-001',
    fullName: 'Marcus Chen',
    email: 'marcus.chen@college.edu',
    role: 'STUDENT' as const,
    dept: 'Computer Science',
    label: 'Student',
    demoPasscode: 'Student#2026',
  },
];

const COLLEGE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS departments (
  dept_id SERIAL PRIMARY KEY,
  dept_code VARCHAR(16) NOT NULL UNIQUE,
  dept_name VARCHAR(100) NOT NULL UNIQUE,
  building VARCHAR(80) NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  user_id SERIAL PRIMARY KEY,
  code VARCHAR(24) NOT NULL UNIQUE,
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(160) NOT NULL UNIQUE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('ADMIN', 'FACULTY', 'STUDENT')),
  dept_id INTEGER NOT NULL REFERENCES departments(dept_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  program_or_title VARCHAR(120) NOT NULL,
  semester INTEGER NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'On Leave', 'Graduated')),
  password_hash TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS courses (
  course_id SERIAL PRIMARY KEY,
  course_code VARCHAR(20) NOT NULL UNIQUE,
  title VARCHAR(140) NOT NULL,
  dept_id INTEGER NOT NULL REFERENCES departments(dept_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  faculty_id INTEGER NOT NULL REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  credits INTEGER NOT NULL CHECK (credits BETWEEN 1 AND 6),
  semester_label VARCHAR(40) NOT NULL,
  schedule VARCHAR(80) NOT NULL,
  room VARCHAR(40) NOT NULL,
  max_capacity INTEGER NOT NULL DEFAULT 40 CHECK (max_capacity > 0)
);

CREATE TABLE IF NOT EXISTS enrollments (
  enrollment_id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE CASCADE,
  course_id INTEGER NOT NULL REFERENCES courses(course_id) ON UPDATE CASCADE ON DELETE CASCADE,
  enrolled_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  score NUMERIC(5, 2) NULL CHECK (score IS NULL OR (score >= 0 AND score <= 100)),
  letter_grade VARCHAR(4) NULL,
  grade_points NUMERIC(3, 2) NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'Enrolled' CHECK (status IN ('Enrolled', 'Completed', 'Dropped')),
  UNIQUE (student_id, course_id)
);

CREATE TABLE IF NOT EXISTS class_attendance (
  attendance_id SERIAL PRIMARY KEY,
  course_id INTEGER NOT NULL REFERENCES courses(course_id) ON UPDATE CASCADE ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE CASCADE,
  session_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('Present', 'Late', 'Absent', 'Excused')),
  notes VARCHAR(200) NULL,
  UNIQUE (course_id, student_id, session_date)
);

CREATE TABLE IF NOT EXISTS fee_invoices (
  invoice_id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE CASCADE,
  term_label VARCHAR(40) NOT NULL,
  description VARCHAR(160) NOT NULL,
  amount NUMERIC(10, 2) NOT NULL CHECK (amount > 0),
  paid_amount NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  due_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Partial', 'Paid')),
  paid_at TIMESTAMP NULL
);
`;

export function computeGradeFromScore(score: number): { letter: string; points: number } {
  if (score >= 93) return { letter: 'A', points: 4.0 };
  if (score >= 90) return { letter: 'A-', points: 3.7 };
  if (score >= 87) return { letter: 'B+', points: 3.3 };
  if (score >= 83) return { letter: 'B', points: 3.0 };
  if (score >= 80) return { letter: 'B-', points: 2.7 };
  if (score >= 77) return { letter: 'C+', points: 2.3 };
  if (score >= 73) return { letter: 'C', points: 2.0 };
  if (score >= 70) return { letter: 'C-', points: 1.7 };
  if (score >= 60) return { letter: 'D', points: 1.0 };
  return { letter: 'F', points: 0.0 };
}

async function seedCollegeData(db: PGlite) {
  const countRes = await db.query<{ cnt: string }>('SELECT COUNT(*)::text AS cnt FROM departments');
  if (Number(countRes.rows[0]?.cnt || '0') > 0) return;

  const adminPass = hashPassword('Admin#2026');
  const facultyPass = hashPassword('Faculty#2026');
  const studentPass = hashPassword('Student#2026');

  await db.query('BEGIN');
  try {
    const depts = [
      ['CS', 'Computer Science', 'Turing Hall'],
      ['EE', 'Electrical Engineering', 'Maxwell Wing'],
      ['BA', 'Business Administration', 'Founders Building'],
      ['MATH', 'Mathematics & Data Science', 'Euler Pavilion'],
      ['ADM', 'Academic Affairs', 'Administration Hall'],
    ];
    for (const [code, name, building] of depts) {
      await db.query(
        'INSERT INTO departments (dept_code, dept_name, building) VALUES ($1, $2, $3)',
        [code, name, building]
      );
    }

    const deptRes = await db.query<{ dept_id: number; dept_code: string }>(
      'SELECT dept_id, dept_code FROM departments'
    );
    const deptByCode = new Map(deptRes.rows.map((r) => [r.dept_code, r.dept_id]));

    // Admin & Faculty
    const staff = [
      { code: 'ADM-001', name: 'Dr. Elena Vance', email: 'dean.vance@college.edu', role: 'ADMIN', dept: 'ADM', title: 'Academic Dean & Registrar', pass: adminPass },
      { code: 'FAC-101', name: 'Prof. David Morales', email: 'prof.morales@college.edu', role: 'FACULTY', dept: 'CS', title: 'Associate Professor of CS', pass: facultyPass },
      { code: 'FAC-102', name: 'Dr. Hannah Abbott', email: 'prof.abbott@college.edu', role: 'FACULTY', dept: 'EE', title: 'Professor of Electrical Eng.', pass: facultyPass },
      { code: 'FAC-103', name: 'Prof. Mei-Ling Zhou', email: 'prof.zhou@college.edu', role: 'FACULTY', dept: 'BA', title: 'Chair of Finance & Strategy', pass: facultyPass },
    ];

    const userByCode = new Map<string, number>();
    for (const s of staff) {
      const r = await db.query<{ user_id: number }>(
        `INSERT INTO users (code, full_name, email, role, dept_id, program_or_title, semester, status, password_hash)
         VALUES ($1, $2, $3, $4, $5, $6, NULL, 'Active', $7) RETURNING user_id`,
        [s.code, s.name, s.email, s.role, deptByCode.get(s.dept)!, s.title, s.pass]
      );
      userByCode.set(s.code, r.rows[0].user_id);
    }

    // 10 Students
    const students = [
      { code: 'STU-2026-001', name: 'Marcus Chen', email: 'marcus.chen@college.edu', dept: 'CS', prog: 'B.S. Computer Science', sem: 5 },
      { code: 'STU-2026-002', name: 'Priya Nair', email: 'priya.nair@college.edu', dept: 'CS', prog: 'B.S. Computer Science', sem: 5 },
      { code: 'STU-2026-003', name: 'Tariq Al-Mansoor', email: 'tariq.mansoor@college.edu', dept: 'CS', prog: 'B.S. Software Engineering', sem: 3 },
      { code: 'STU-2026-004', name: 'Clara Lindqvist', email: 'clara.lindqvist@college.edu', dept: 'BA', prog: 'B.B.A. Corporate Finance', sem: 5 },
      { code: 'STU-2026-005', name: 'Samuel Okafor', email: 'samuel.okafor@college.edu', dept: 'EE', prog: 'B.S. Electrical Engineering', sem: 3 },
      { code: 'STU-2026-006', name: 'Nadia Kowalski', email: 'nadia.kowalski@college.edu', dept: 'MATH', prog: 'B.S. Applied Mathematics', sem: 7 },
      { code: 'STU-2026-007', name: 'Lucas Ferreira', email: 'lucas.ferreira@college.edu', dept: 'BA', prog: 'B.B.A. Operations Management', sem: 3 },
      { code: 'STU-2026-008', name: 'Owen Gallagher', email: 'owen.gallagher@college.edu', dept: 'EE', prog: 'B.S. Embedded Systems', sem: 5 },
      { code: 'STU-2026-009', name: 'Sofia Alvarez', email: 'sofia.alvarez@college.edu', dept: 'CS', prog: 'B.S. Computer Science', sem: 3 },
      { code: 'STU-2026-010', name: 'Ethan Brooks', email: 'ethan.brooks@college.edu', dept: 'MATH', prog: 'B.S. Data Science', sem: 5 },
    ];

    for (const st of students) {
      const r = await db.query<{ user_id: number }>(
        `INSERT INTO users (code, full_name, email, role, dept_id, program_or_title, semester, status, password_hash)
         VALUES ($1, $2, $3, 'STUDENT', $4, $5, $6, 'Active', $7) RETURNING user_id`,
        [st.code, st.name, st.email, deptByCode.get(st.dept)!, st.prog, st.sem, studentPass]
      );
      userByCode.set(st.code, r.rows[0].user_id);
    }

    // Courses
    const courses = [
      { code: 'CS-301', title: 'Data Structures & Algorithms', dept: 'CS', fac: 'FAC-101', credits: 4, sem: 'Fall 2026', sched: 'Mon / Wed 09:30–11:00', room: 'TH-204', cap: 45 },
      { code: 'CS-305', title: 'Operating Systems', dept: 'CS', fac: 'FAC-101', credits: 4, sem: 'Fall 2026', sched: 'Tue / Thu 11:00–12:30', room: 'TH-301', cap: 40 },
      { code: 'CS-410', title: 'Distributed Cloud Systems', dept: 'CS', fac: 'FAC-101', credits: 3, sem: 'Fall 2026', sched: 'Fri 13:00–16:00', room: 'TH-112', cap: 35 },
      { code: 'EE-210', title: 'Digital Logic & Microprocessors', dept: 'EE', fac: 'FAC-102', credits: 4, sem: 'Fall 2026', sched: 'Mon / Wed 13:30–15:00', room: 'MW-105', cap: 36 },
      { code: 'EE-320', title: 'Embedded Control Systems', dept: 'EE', fac: 'FAC-102', credits: 3, sem: 'Fall 2026', sched: 'Tue / Thu 14:00–15:30', room: 'MW-202', cap: 30 },
      { code: 'BA-204', title: 'Corporate Finance', dept: 'BA', fac: 'FAC-103', credits: 3, sem: 'Fall 2026', sched: 'Mon / Wed 10:00–11:30', room: 'FB-118', cap: 50 },
      { code: 'BA-310', title: 'Operations & Supply Chain', dept: 'BA', fac: 'FAC-103', credits: 3, sem: 'Fall 2026', sched: 'Tue / Thu 09:30–11:00', room: 'FB-210', cap: 45 },
      { code: 'MATH-302', title: 'Linear Optimization', dept: 'MATH', fac: 'FAC-101', credits: 3, sem: 'Fall 2026', sched: 'Wed / Fri 11:00–12:30', room: 'EP-104', cap: 40 },
    ];

    const courseByCode = new Map<string, number>();
    for (const c of courses) {
      const r = await db.query<{ course_id: number }>(
        `INSERT INTO courses (course_code, title, dept_id, faculty_id, credits, semester_label, schedule, room, max_capacity)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING course_id`,
        [c.code, c.title, deptByCode.get(c.dept)!, userByCode.get(c.fac)!, c.credits, c.sem, c.sched, c.room, c.cap]
      );
      courseByCode.set(c.code, r.rows[0].course_id);
    }

    // Enrollments with realistic scores & grades
    const enrollmentSeed: Array<{ stu: string; course: string; score: number | null; status: 'Enrolled' | 'Completed' }> = [
      { stu: 'STU-2026-001', course: 'CS-301', score: 94, status: 'Completed' },
      { stu: 'STU-2026-001', course: 'CS-305', score: 89, status: 'Enrolled' },
      { stu: 'STU-2026-001', course: 'MATH-302', score: 91, status: 'Enrolled' },
      { stu: 'STU-2026-002', course: 'CS-301', score: 96, status: 'Completed' },
      { stu: 'STU-2026-002', course: 'CS-305', score: 93, status: 'Enrolled' },
      { stu: 'STU-2026-002', course: 'CS-410', score: 88, status: 'Enrolled' },
      { stu: 'STU-2026-003', course: 'CS-301', score: 84, status: 'Enrolled' },
      { stu: 'STU-2026-003', course: 'EE-210', score: 79, status: 'Enrolled' },
      { stu: 'STU-2026-004', course: 'BA-204', score: 92, status: 'Completed' },
      { stu: 'STU-2026-004', course: 'BA-310', score: 87, status: 'Enrolled' },
      { stu: 'STU-2026-005', course: 'EE-210', score: 85, status: 'Enrolled' },
      { stu: 'STU-2026-005', course: 'EE-320', score: 82, status: 'Enrolled' },
      { stu: 'STU-2026-006', course: 'MATH-302', score: 97, status: 'Completed' },
      { stu: 'STU-2026-006', course: 'CS-410', score: 90, status: 'Enrolled' },
      { stu: 'STU-2026-007', course: 'BA-204', score: 76, status: 'Enrolled' },
      { stu: 'STU-2026-007', course: 'BA-310', score: null, status: 'Enrolled' },
      { stu: 'STU-2026-008', course: 'EE-210', score: 88, status: 'Completed' },
      { stu: 'STU-2026-008', course: 'EE-320', score: 86, status: 'Enrolled' },
      { stu: 'STU-2026-009', course: 'CS-301', score: 91, status: 'Enrolled' },
      { stu: 'STU-2026-009', course: 'CS-305', score: null, status: 'Enrolled' },
      { stu: 'STU-2026-010', course: 'MATH-302', score: 89, status: 'Enrolled' },
      { stu: 'STU-2026-010', course: 'BA-204', score: 85, status: 'Enrolled' },
    ];

    for (const en of enrollmentSeed) {
      const grade = en.score !== null ? computeGradeFromScore(en.score) : null;
      await db.query(
        `INSERT INTO enrollments (student_id, course_id, score, letter_grade, grade_points, status)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          userByCode.get(en.stu)!,
          courseByCode.get(en.course)!,
          en.score,
          grade ? grade.letter : null,
          grade ? grade.points : null,
          en.status,
        ]
      );
    }

    // Class Attendance Sessions (Nov 2026)
    const sessionDates = ['2026-11-04', '2026-11-06', '2026-11-11', '2026-11-13', '2026-11-18', '2026-11-20'];
    const statuses: Array<'Present' | 'Present' | 'Present' | 'Present' | 'Late' | 'Absent'> = [
      'Present',
      'Present',
      'Present',
      'Present',
      'Late',
      'Absent',
    ];
    for (let i = 0; i < enrollmentSeed.length; i++) {
      const en = enrollmentSeed[i];
      const stuId = userByCode.get(en.stu)!;
      const cId = courseByCode.get(en.course)!;
      for (let dIdx = 0; dIdx < sessionDates.length; dIdx++) {
        const status = statuses[(i * 3 + dIdx) % statuses.length];
        await db.query(
          `INSERT INTO class_attendance (course_id, student_id, session_date, status, notes)
           VALUES ($1, $2, $3, $4, $5)`,
          [cId, stuId, sessionDates[dIdx], status, status === 'Late' ? 'Arrived 10 min after bell' : null]
        );
      }
    }

    // Tuition & Lab Fee Invoices
    const invoices = [
      { stu: 'STU-2026-001', term: 'Fall 2026', desc: 'Fall Semester Tuition & CS Lab Fee', amt: 6850, paid: 6850, due: '2026-09-15', status: 'Paid' },
      { stu: 'STU-2026-001', term: 'Fall 2026', desc: 'Cloud Computing Workshop & Exam Fee', amt: 450, paid: 0, due: '2026-12-05', status: 'Pending' },
      { stu: 'STU-2026-002', term: 'Fall 2026', desc: 'Fall Semester Tuition & CS Lab Fee', amt: 6850, paid: 6850, due: '2026-09-15', status: 'Paid' },
      { stu: 'STU-2026-003', term: 'Fall 2026', desc: 'Fall Semester Tuition', amt: 6400, paid: 3200, due: '2026-10-30', status: 'Partial' },
      { stu: 'STU-2026-004', term: 'Fall 2026', desc: 'Fall Semester Tuition (Business)', amt: 6100, paid: 6100, due: '2026-09-15', status: 'Paid' },
      { stu: 'STU-2026-005', term: 'Fall 2026', desc: 'Fall Tuition & Hardware Lab Fee', amt: 6950, paid: 0, due: '2026-11-30', status: 'Pending' },
      { stu: 'STU-2026-006', term: 'Fall 2026', desc: 'Fall Semester Tuition', amt: 6200, paid: 6200, due: '2026-09-15', status: 'Paid' },
      { stu: 'STU-2026-007', term: 'Fall 2026', desc: 'Fall Semester Tuition', amt: 6100, paid: 3000, due: '2026-11-28', status: 'Partial' },
      { stu: 'STU-2026-008', term: 'Fall 2026', desc: 'Fall Tuition & Robotics Lab Fee', amt: 6950, paid: 6950, due: '2026-09-15', status: 'Paid' },
      { stu: 'STU-2026-009', term: 'Fall 2026', desc: 'Fall Semester Tuition', amt: 6400, paid: 6400, due: '2026-09-15', status: 'Paid' },
      { stu: 'STU-2026-010', term: 'Fall 2026', desc: 'Fall Semester Tuition', amt: 6200, paid: 0, due: '2026-12-01', status: 'Pending' },
    ];

    for (const inv of invoices) {
      await db.query(
        `INSERT INTO fee_invoices (student_id, term_label, description, amount, paid_amount, due_date, status, paid_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          userByCode.get(inv.stu)!,
          inv.term,
          inv.desc,
          inv.amt,
          inv.paid,
          inv.due,
          inv.status,
          inv.status === 'Paid' ? new Date().toISOString() : null,
        ]
      );
    }

    await db.query('COMMIT');
    console.log('[CampusCore DB] Seeded departments, faculty, 10 students, 8 courses, enrollments, attendance, and invoices.');
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  }
}

export async function getCollegeDb(): Promise<PGlite> {
  if (dbInstance) return dbInstance;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const dataDir = path.resolve(process.cwd(), 'data', 'college_pg');
    fs.mkdirSync(path.dirname(dataDir), { recursive: true });
    const db = new PGlite(dataDir);
    await db.waitReady;
    await db.exec(COLLEGE_TABLES_SQL);
    await seedCollegeData(db);
    dbInstance = db;
    return db;
  })();

  return initPromise;
}
