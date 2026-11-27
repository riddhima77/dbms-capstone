import express, { type Router } from 'express';
import {
  type AuthenticatedRequest,
  hashPassword,
  requireAuth,
  requireRoles,
  signAuthToken,
  verifyPassword,
} from './auth.js';
import {
  computeGradeFromScore,
  DEMO_PORTAL_ACCOUNTS,
  getCollegeDb,
} from './collegeDb.js';

export function createApiRouter(): Router {
  const router = express.Router();

  router.get('/auth/demo-accounts', (_req, res) => {
    res.json({ accounts: DEMO_PORTAL_ACCOUNTS });
  });

  router.post('/auth/login', async (req, res) => {
    try {
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      if (!email || !password) {
        res.status(400).json({ error: 'Email and password are required.' });
        return;
      }

      const db = await getCollegeDb();
      const result = await db.query<{
        user_id: number;
        code: string;
        full_name: string;
        email: string;
        role: 'ADMIN' | 'FACULTY' | 'STUDENT';
        program_or_title: string;
        password_hash: string;
        dept_name: string;
      }>(
        `SELECT u.user_id, u.code, u.full_name, u.email, u.role, u.program_or_title, u.password_hash, d.dept_name
           FROM users u
           JOIN departments d ON d.dept_id = u.dept_id
          WHERE LOWER(u.email) = $1
          LIMIT 1`,
        [email]
      );

      const userRow = result.rows[0];
      if (!userRow || !verifyPassword(password, userRow.password_hash)) {
        res.status(401).json({ error: 'Invalid email or password.' });
        return;
      }

      const authUser = {
        userId: userRow.user_id,
        code: userRow.code,
        fullName: userRow.full_name,
        email: userRow.email,
        role: userRow.role,
        deptName: userRow.dept_name,
        programOrTitle: userRow.program_or_title,
      };
      const token = signAuthToken(authUser);
      res.json({ token, user: authUser });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.get('/auth/me', requireAuth, (req: AuthenticatedRequest, res) => {
    res.json({ user: req.user });
  });

  router.get('/departments', requireAuth, async (_req, res) => {
    try {
      const db = await getCollegeDb();
      const result = await db.query(
        'SELECT dept_id, dept_code, dept_name, building FROM departments ORDER BY dept_name'
      );
      res.json({ departments: result.rows });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.get('/overview', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const db = await getCollegeDb();
      const user = req.user!;

      if (user.role === 'ADMIN') {
        const stats = await db.query<{
          total_students: number;
          total_faculty: number;
          total_courses: number;
          total_enrollments: number;
          tuition_billed: number;
          tuition_collected: number;
          attendance_rate: number | null;
        }>(`
          SELECT
            (SELECT COUNT(*)::int FROM users WHERE role = 'STUDENT' AND status = 'Active') AS total_students,
            (SELECT COUNT(*)::int FROM users WHERE role = 'FACULTY') AS total_faculty,
            (SELECT COUNT(*)::int FROM courses) AS total_courses,
            (SELECT COUNT(*)::int FROM enrollments WHERE status <> 'Dropped') AS total_enrollments,
            (SELECT COALESCE(SUM(amount), 0)::float8 FROM fee_invoices) AS tuition_billed,
            (SELECT COALESCE(SUM(paid_amount), 0)::float8 FROM fee_invoices) AS tuition_collected,
            (SELECT ROUND(
               COUNT(*) FILTER (WHERE status IN ('Present', 'Late', 'Excused')) * 100.0 / NULLIF(COUNT(*), 0), 1
             )::float8 FROM class_attendance) AS attendance_rate
        `);

        const deptSummary = await db.query(`
          SELECT d.dept_code, d.dept_name, d.building,
                 COUNT(DISTINCT u.user_id) FILTER (WHERE u.role = 'STUDENT')::int AS student_count,
                 COUNT(DISTINCT c.course_id)::int AS course_count
            FROM departments d
            LEFT JOIN users u ON u.dept_id = d.dept_id
            LEFT JOIN courses c ON c.dept_id = d.dept_id
           WHERE d.dept_code <> 'ADM'
           GROUP BY d.dept_id, d.dept_code, d.dept_name, d.building
           ORDER BY d.dept_name
        `);

        res.json({ stats: stats.rows[0], departmentSummary: deptSummary.rows });
        return;
      }

      if (user.role === 'FACULTY') {
        const stats = await db.query<{
          assigned_courses: number;
          enrolled_students: number;
          pending_grades: number;
          attendance_rate: number | null;
        }>(
          `SELECT
             (SELECT COUNT(*)::int FROM courses WHERE faculty_id = $1) AS assigned_courses,
             (SELECT COUNT(DISTINCT e.student_id)::int
                FROM enrollments e
                JOIN courses c ON c.course_id = e.course_id
               WHERE c.faculty_id = $1 AND e.status <> 'Dropped') AS enrolled_students,
             (SELECT COUNT(*)::int
                FROM enrollments e
                JOIN courses c ON c.course_id = e.course_id
               WHERE c.faculty_id = $1 AND e.status = 'Enrolled' AND e.score IS NULL) AS pending_grades,
             (SELECT ROUND(
                COUNT(*) FILTER (WHERE ca.status IN ('Present', 'Late', 'Excused')) * 100.0 / NULLIF(COUNT(*), 0), 1
              )::float8
                FROM class_attendance ca
                JOIN courses c ON c.course_id = ca.course_id
               WHERE c.faculty_id = $1) AS attendance_rate`,
          [user.userId]
        );
        res.json({ stats: stats.rows[0] });
        return;
      }

      // STUDENT
      const stats = await db.query<{
        enrolled_courses: number;
        total_credits: number;
        gpa: number | null;
        attendance_rate: number | null;
        balance_due: number;
      }>(
        `SELECT
           (SELECT COUNT(*)::int FROM enrollments WHERE student_id = $1 AND status <> 'Dropped') AS enrolled_courses,
           (SELECT COALESCE(SUM(c.credits), 0)::int
              FROM enrollments e JOIN courses c ON c.course_id = e.course_id
             WHERE e.student_id = $1 AND e.status <> 'Dropped') AS total_credits,
           (SELECT ROUND(SUM(e.grade_points * c.credits) / NULLIF(SUM(c.credits), 0), 2)::float8
              FROM enrollments e JOIN courses c ON c.course_id = e.course_id
             WHERE e.student_id = $1 AND e.grade_points IS NOT NULL AND e.status <> 'Dropped') AS gpa,
           (SELECT ROUND(
              COUNT(*) FILTER (WHERE status IN ('Present', 'Late', 'Excused')) * 100.0 / NULLIF(COUNT(*), 0), 1
            )::float8 FROM class_attendance WHERE student_id = $1) AS attendance_rate,
           (SELECT COALESCE(SUM(amount - paid_amount), 0)::float8
              FROM fee_invoices WHERE student_id = $1) AS balance_due`,
        [user.userId]
      );
      res.json({ stats: stats.rows[0] });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Students Directory (ADMIN & FACULTY)
  router.get('/students', requireAuth, requireRoles('ADMIN', 'FACULTY'), async (_req, res) => {
    try {
      const db = await getCollegeDb();
      const result = await db.query(
        `SELECT u.user_id, u.code, u.full_name, u.email, d.dept_id, d.dept_name,
                u.program_or_title, u.semester, u.status,
                COUNT(e.enrollment_id) FILTER (WHERE e.status <> 'Dropped')::int AS course_count,
                ROUND(SUM(e.grade_points * c.credits) / NULLIF(SUM(c.credits) FILTER (WHERE e.grade_points IS NOT NULL), 0), 2)::float8 AS gpa
           FROM users u
           JOIN departments d ON d.dept_id = u.dept_id
           LEFT JOIN enrollments e ON e.student_id = u.user_id AND e.status <> 'Dropped'
           LEFT JOIN courses c ON c.course_id = e.course_id
          WHERE u.role = 'STUDENT'
          GROUP BY u.user_id, u.code, u.full_name, u.email, d.dept_id, d.dept_name, u.program_or_title, u.semester, u.status
          ORDER BY u.code`
      );
      res.json({ students: result.rows });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Enroll new student (ADMIN only)
  router.post('/students', requireAuth, requireRoles('ADMIN'), async (req, res) => {
    const db = await getCollegeDb();
    try {
      const { code, fullName, email, deptId, programOrTitle, semester, tuitionAmount } = req.body || {};
      if (!code || !fullName || !email || !deptId || !programOrTitle) {
        res.status(400).json({ error: 'Student code, name, email, department, and program are required.' });
        return;
      }

      const passHash = hashPassword('Student#2026');
      await db.query('BEGIN');
      const stuRes = await db.query<{ user_id: number }>(
        `INSERT INTO users (code, full_name, email, role, dept_id, program_or_title, semester, status, password_hash)
         VALUES ($1, $2, $3, 'STUDENT', $4, $5, $6, 'Active', $7)
         RETURNING user_id`,
        [
          String(code).trim(),
          String(fullName).trim(),
          String(email).trim().toLowerCase(),
          Number(deptId),
          String(programOrTitle).trim(),
          Number(semester) || 1,
          passHash,
        ]
      );

      const studentId = stuRes.rows[0].user_id;
      const amt = Number(tuitionAmount) || 6400;
      await db.query(
        `INSERT INTO fee_invoices (student_id, term_label, description, amount, paid_amount, due_date, status)
         VALUES ($1, 'Fall 2026', 'Semester Tuition & Registration Fee', $2, 0, '2026-12-15', 'Pending')`,
        [studentId, amt]
      );

      await db.query('COMMIT');
      res.status(201).json({ userId: studentId, message: 'Student admitted and initial tuition invoice issued.' });
    } catch (err) {
      await db.query('ROLLBACK').catch(() => {});
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.patch('/students/:id/status', requireAuth, requireRoles('ADMIN'), async (req, res) => {
    try {
      const userId = Number(req.params.id);
      const status = req.body?.status;
      if (!['Active', 'On Leave', 'Graduated'].includes(status)) {
        res.status(400).json({ error: 'Invalid status.' });
        return;
      }
      const db = await getCollegeDb();
      await db.query(`UPDATE users SET status = $1 WHERE user_id = $2 AND role = 'STUDENT'`, [status, userId]);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // Faculty list
  router.get('/faculty', requireAuth, async (_req, res) => {
    try {
      const db = await getCollegeDb();
      const result = await db.query(
        `SELECT u.user_id, u.code, u.full_name, u.email, d.dept_name, u.program_or_title,
                COUNT(c.course_id)::int AS course_count
           FROM users u
           JOIN departments d ON d.dept_id = u.dept_id
           LEFT JOIN courses c ON c.faculty_id = u.user_id
          WHERE u.role = 'FACULTY'
          GROUP BY u.user_id, u.code, u.full_name, u.email, d.dept_name, u.program_or_title
          ORDER BY u.code`
      );
      res.json({ faculty: result.rows });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Courses Catalog
  router.get('/courses', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const db = await getCollegeDb();
      const result = await db.query(
        `SELECT c.course_id, c.course_code, c.title, d.dept_id, d.dept_code, d.dept_name,
                c.faculty_id, f.full_name AS faculty_name,
                c.credits, c.semester_label, c.schedule, c.room, c.max_capacity,
                COUNT(e.enrollment_id) FILTER (WHERE e.status <> 'Dropped')::int AS enrolled_count,
                BOOL_OR(e.student_id = $1 AND e.status <> 'Dropped') AS is_enrolled
           FROM courses c
           JOIN departments d ON d.dept_id = c.dept_id
           JOIN users f ON f.user_id = c.faculty_id
           LEFT JOIN enrollments e ON e.course_id = c.course_id
          GROUP BY c.course_id, c.course_code, c.title, d.dept_id, d.dept_code, d.dept_name,
                   c.faculty_id, f.full_name, c.credits, c.semester_label, c.schedule, c.room, c.max_capacity
          ORDER BY c.course_code`,
        [req.user!.userId]
      );
      res.json({ courses: result.rows });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post('/courses', requireAuth, requireRoles('ADMIN'), async (req, res) => {
    try {
      const { courseCode, title, deptId, facultyId, credits, semesterLabel, schedule, room, maxCapacity } = req.body || {};
      if (!courseCode || !title || !deptId || !facultyId || !schedule || !room) {
        res.status(400).json({ error: 'All course fields are required.' });
        return;
      }
      const db = await getCollegeDb();
      const inserted = await db.query<{ course_id: number }>(
        `INSERT INTO courses (course_code, title, dept_id, faculty_id, credits, semester_label, schedule, room, max_capacity)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING course_id`,
        [
          String(courseCode).trim().toUpperCase(),
          String(title).trim(),
          Number(deptId),
          Number(facultyId),
          Number(credits) || 3,
          String(semesterLabel || 'Fall 2026'),
          String(schedule).trim(),
          String(room).trim(),
          Number(maxCapacity) || 40,
        ]
      );
      res.status(201).json({ courseId: inserted.rows[0].course_id });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // Enrollments & Grades
  router.get('/enrollments', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const db = await getCollegeDb();
      const user = req.user!;
      const courseFilter = req.query.courseId ? Number(req.query.courseId) : null;

      const params: number[] = [];
      const conditions: string[] = [];

      if (user.role === 'STUDENT') {
        params.push(user.userId);
        conditions.push(`e.student_id = $${params.length}`);
      } else if (user.role === 'FACULTY') {
        params.push(user.userId);
        conditions.push(`c.faculty_id = $${params.length}`);
      }

      if (courseFilter) {
        params.push(courseFilter);
        conditions.push(`e.course_id = $${params.length}`);
      }

      const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const result = await db.query(
        `SELECT e.enrollment_id, e.student_id, s.code AS student_code, s.full_name AS student_name,
                c.course_id, c.course_code, c.title AS course_title, c.credits, c.schedule, c.room,
                f.full_name AS faculty_name,
                e.score::float8 AS score, e.letter_grade, e.grade_points::float8 AS grade_points,
                e.status, e.enrolled_at::text AS enrolled_at
           FROM enrollments e
           JOIN users s ON s.user_id = e.student_id
           JOIN courses c ON c.course_id = e.course_id
           JOIN users f ON f.user_id = c.faculty_id
           ${whereSql}
          ORDER BY c.course_code, s.code`,
        params
      );
      res.json({ enrollments: result.rows });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Enroll Student (ADMIN for any student; STUDENT for self)
  router.post('/enrollments', requireAuth, requireRoles('ADMIN', 'STUDENT'), async (req: AuthenticatedRequest, res) => {
    const db = await getCollegeDb();
    try {
      const user = req.user!;
      const courseId = Number(req.body?.courseId);
      const studentId = user.role === 'ADMIN' && req.body?.studentId ? Number(req.body.studentId) : user.userId;

      if (user.role === 'STUDENT' && studentId !== user.userId) {
        res.status(403).json({ error: 'Students may only enroll themselves.' });
        return;
      }
      if (!courseId) {
        res.status(400).json({ error: 'courseId is required.' });
        return;
      }

      await db.query('BEGIN');
      const capRes = await db.query<{ max_capacity: number; current_count: number }>(
        `SELECT c.max_capacity,
                COUNT(e.enrollment_id) FILTER (WHERE e.status <> 'Dropped')::int AS current_count
           FROM courses c
           LEFT JOIN enrollments e ON e.course_id = c.course_id
          WHERE c.course_id = $1
          GROUP BY c.course_id, c.max_capacity`,
        [courseId]
      );
      if (capRes.rows.length === 0) {
        await db.query('ROLLBACK');
        res.status(404).json({ error: 'Course not found.' });
        return;
      }
      if (capRes.rows[0].current_count >= capRes.rows[0].max_capacity) {
        await db.query('ROLLBACK');
        res.status(400).json({ error: 'Course has reached maximum enrollment capacity.' });
        return;
      }

      const enrolled = await db.query<{ enrollment_id: number }>(
        `INSERT INTO enrollments (student_id, course_id, status)
         VALUES ($1, $2, 'Enrolled')
         ON CONFLICT (student_id, course_id) DO UPDATE
           SET status = 'Enrolled'
         RETURNING enrollment_id`,
        [studentId, courseId]
      );
      await db.query('COMMIT');
      res.status(201).json({ enrollmentId: enrolled.rows[0].enrollment_id });
    } catch (err) {
      await db.query('ROLLBACK').catch(() => {});
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // Update Grade (ADMIN or assigned FACULTY)
  router.patch('/enrollments/:id/grade', requireAuth, requireRoles('ADMIN', 'FACULTY'), async (req: AuthenticatedRequest, res) => {
    try {
      const enrollmentId = Number(req.params.id);
      const score = Number(req.body?.score);
      const status = req.body?.status === 'Completed' ? 'Completed' : 'Enrolled';

      if (Number.isNaN(score) || score < 0 || score > 100) {
        res.status(400).json({ error: 'Score must be between 0 and 100.' });
        return;
      }

      const db = await getCollegeDb();
      if (req.user!.role === 'FACULTY') {
        const ownerCheck = await db.query<{ faculty_id: number }>(
          `SELECT c.faculty_id
             FROM enrollments e
             JOIN courses c ON c.course_id = e.course_id
            WHERE e.enrollment_id = $1`,
          [enrollmentId]
        );
        if (ownerCheck.rows[0]?.faculty_id !== req.user!.userId) {
          res.status(403).json({ error: 'You can only grade students in your assigned courses.' });
          return;
        }
      }

      const { letter, points } = computeGradeFromScore(score);
      await db.query(
        `UPDATE enrollments
            SET score = $1, letter_grade = $2, grade_points = $3, status = $4
          WHERE enrollment_id = $5`,
        [score, letter, points, status, enrollmentId]
      );
      res.json({ letterGrade: letter, gradePoints: points, score, status });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // Drop course
  router.delete('/enrollments/:id', requireAuth, requireRoles('ADMIN', 'STUDENT'), async (req: AuthenticatedRequest, res) => {
    try {
      const enrollmentId = Number(req.params.id);
      const db = await getCollegeDb();
      if (req.user!.role === 'STUDENT') {
        const check = await db.query<{ student_id: number }>(
          'SELECT student_id FROM enrollments WHERE enrollment_id = $1',
          [enrollmentId]
        );
        if (check.rows[0]?.student_id !== req.user!.userId) {
          res.status(403).json({ error: 'You may only drop your own course enrollments.' });
          return;
        }
      }
      await db.query(`UPDATE enrollments SET status = 'Dropped' WHERE enrollment_id = $1`, [enrollmentId]);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // Class Attendance
  router.get('/attendance', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const db = await getCollegeDb();
      const user = req.user!;
      const courseFilter = req.query.courseId ? Number(req.query.courseId) : null;

      const params: number[] = [];
      const conditions: string[] = [];

      if (user.role === 'STUDENT') {
        params.push(user.userId);
        conditions.push(`ca.student_id = $${params.length}`);
      } else if (user.role === 'FACULTY') {
        params.push(user.userId);
        conditions.push(`c.faculty_id = $${params.length}`);
      }

      if (courseFilter) {
        params.push(courseFilter);
        conditions.push(`ca.course_id = $${params.length}`);
      }

      const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const result = await db.query(
        `SELECT ca.attendance_id, ca.course_id, c.course_code, c.title AS course_title,
                ca.student_id, s.code AS student_code, s.full_name AS student_name,
                ca.session_date::text AS session_date, ca.status, COALESCE(ca.notes, '') AS notes
           FROM class_attendance ca
           JOIN courses c ON c.course_id = ca.course_id
           JOIN users s ON s.user_id = ca.student_id
           ${whereSql}
          ORDER BY ca.session_date DESC, c.course_code, s.code
          LIMIT 300`,
        params
      );
      res.json({ attendance: result.rows });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post('/attendance', requireAuth, requireRoles('ADMIN', 'FACULTY'), async (req: AuthenticatedRequest, res) => {
    try {
      const { courseId, studentId, sessionDate, status, notes } = req.body || {};
      if (!courseId || !studentId || !sessionDate || !['Present', 'Late', 'Absent', 'Excused'].includes(status)) {
        res.status(400).json({ error: 'courseId, studentId, sessionDate, and valid status are required.' });
        return;
      }

      const db = await getCollegeDb();
      if (req.user!.role === 'FACULTY') {
        const courseRes = await db.query<{ faculty_id: number }>(
          'SELECT faculty_id FROM courses WHERE course_id = $1',
          [Number(courseId)]
        );
        if (courseRes.rows[0]?.faculty_id !== req.user!.userId) {
          res.status(403).json({ error: 'You can only record attendance for your own courses.' });
          return;
        }
      }

      await db.query(
        `INSERT INTO class_attendance (course_id, student_id, session_date, status, notes)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (course_id, student_id, session_date) DO UPDATE
           SET status = EXCLUDED.status, notes = EXCLUDED.notes`,
        [Number(courseId), Number(studentId), String(sessionDate), String(status), notes ? String(notes) : null]
      );
      res.status(201).json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // Tuition & Fee Invoices
  router.get('/fees', requireAuth, requireRoles('ADMIN', 'STUDENT'), async (req: AuthenticatedRequest, res) => {
    try {
      const db = await getCollegeDb();
      const params: number[] = [];
      let whereSql = '';
      if (req.user!.role === 'STUDENT') {
        params.push(req.user!.userId);
        whereSql = 'WHERE fi.student_id = $1';
      }

      const result = await db.query(
        `SELECT fi.invoice_id, fi.student_id, s.code AS student_code, s.full_name AS student_name,
                fi.term_label, fi.description,
                fi.amount::float8 AS amount, fi.paid_amount::float8 AS paid_amount,
                fi.due_date::text AS due_date, fi.status,
                COALESCE(fi.paid_at::text, '') AS paid_at
           FROM fee_invoices fi
           JOIN users s ON s.user_id = fi.student_id
           ${whereSql}
          ORDER BY CASE fi.status WHEN 'Pending' THEN 0 WHEN 'Partial' THEN 1 ELSE 2 END, fi.due_date ASC`,
        params
      );
      res.json({ invoices: result.rows });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post('/fees', requireAuth, requireRoles('ADMIN'), async (req, res) => {
    try {
      const { studentId, termLabel, description, amount, dueDate } = req.body || {};
      if (!studentId || !termLabel || !description || !amount || !dueDate) {
        res.status(400).json({ error: 'All invoice fields are required.' });
        return;
      }
      const db = await getCollegeDb();
      const inserted = await db.query<{ invoice_id: number }>(
        `INSERT INTO fee_invoices (student_id, term_label, description, amount, paid_amount, due_date, status)
         VALUES ($1, $2, $3, $4, 0, $5, 'Pending')
         RETURNING invoice_id`,
        [Number(studentId), String(termLabel), String(description), Number(amount), String(dueDate)]
      );
      res.status(201).json({ invoiceId: inserted.rows[0].invoice_id });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.post('/fees/:id/pay', requireAuth, requireRoles('ADMIN', 'STUDENT'), async (req: AuthenticatedRequest, res) => {
    const db = await getCollegeDb();
    try {
      const invoiceId = Number(req.params.id);
      const payAmount = Number(req.body?.payAmount);
      if (!invoiceId || Number.isNaN(payAmount) || payAmount <= 0) {
        res.status(400).json({ error: 'Positive payment amount is required.' });
        return;
      }

      await db.query('BEGIN');
      const invRes = await db.query<{ student_id: number; amount: string; paid_amount: string }>(
        'SELECT student_id, amount::text, paid_amount::text FROM fee_invoices WHERE invoice_id = $1',
        [invoiceId]
      );
      const inv = invRes.rows[0];
      if (!inv) {
        await db.query('ROLLBACK');
        res.status(404).json({ error: 'Invoice not found.' });
        return;
      }
      if (req.user!.role === 'STUDENT' && inv.student_id !== req.user!.userId) {
        await db.query('ROLLBACK');
        res.status(403).json({ error: 'You may only pay your own tuition invoices.' });
        return;
      }

      const totalAmt = Number(inv.amount);
      const newPaid = Math.min(totalAmt, Number(inv.paid_amount) + payAmount);
      const newStatus = newPaid >= totalAmt ? 'Paid' : 'Partial';

      await db.query(
        `UPDATE fee_invoices
            SET paid_amount = $1,
                status = $2,
                paid_at = CASE WHEN $2 = 'Paid' THEN CURRENT_TIMESTAMP ELSE paid_at END
          WHERE invoice_id = $3`,
        [newPaid, newStatus, invoiceId]
      );
      await db.query('COMMIT');
      res.json({ paidAmount: newPaid, status: newStatus });
    } catch (err) {
      await db.query('ROLLBACK').catch(() => {});
      res.status(400).json({ error: (err as Error).message });
    }
  });

  return router;
}
