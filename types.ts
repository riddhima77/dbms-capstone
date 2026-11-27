export type UserRole = 'ADMIN' | 'FACULTY' | 'STUDENT';

export interface AuthUser {
  userId: number;
  code: string;
  fullName: string;
  email: string;
  role: UserRole;
  deptName: string;
  programOrTitle: string;
}

export interface DemoAccount {
  code: string;
  fullName: string;
  email: string;
  role: UserRole;
  dept: string;
  label: string;
  demoPasscode: string;
}

export interface Department {
  dept_id: number;
  dept_code: string;
  dept_name: string;
  building: string;
}

export interface StudentRow {
  user_id: number;
  code: string;
  full_name: string;
  email: string;
  dept_id: number;
  dept_name: string;
  program_or_title: string;
  semester: number | null;
  status: 'Active' | 'On Leave' | 'Graduated';
  course_count: number;
  gpa: number | null;
}

export interface FacultyRow {
  user_id: number;
  code: string;
  full_name: string;
  email: string;
  dept_name: string;
  program_or_title: string;
  course_count: number;
}

export interface CourseRow {
  course_id: number;
  course_code: string;
  title: string;
  dept_id: number;
  dept_code: string;
  dept_name: string;
  faculty_id: number;
  faculty_name: string;
  credits: number;
  semester_label: string;
  schedule: string;
  room: string;
  max_capacity: number;
  enrolled_count: number;
  is_enrolled: boolean;
}

export interface EnrollmentRow {
  enrollment_id: number;
  student_id: number;
  student_code: string;
  student_name: string;
  course_id: number;
  course_code: string;
  course_title: string;
  credits: number;
  schedule: string;
  room: string;
  faculty_name: string;
  score: number | null;
  letter_grade: string | null;
  grade_points: number | null;
  status: 'Enrolled' | 'Completed' | 'Dropped';
  enrolled_at: string;
}

export interface ClassAttendanceRow {
  attendance_id: number;
  course_id: number;
  course_code: string;
  course_title: string;
  student_id: number;
  student_code: string;
  student_name: string;
  session_date: string;
  status: 'Present' | 'Late' | 'Absent' | 'Excused';
  notes: string;
}

export interface FeeInvoiceRow {
  invoice_id: number;
  student_id: number;
  student_code: string;
  student_name: string;
  term_label: string;
  description: string;
  amount: number;
  paid_amount: number;
  due_date: string;
  status: 'Pending' | 'Partial' | 'Paid';
  paid_at: string;
}
