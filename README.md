# CampusCore — College Management System

A full-stack College Management System for managing academic departments, students, faculty, courses, enrollments, grades, class attendance, and tuition fee billing.

## Tech Stack
- **Frontend**: React 19, TypeScript, Tailwind CSS
- **Backend**: Express (`server.ts`, `server/routes.ts`, `server/auth.ts`)
- **Database**: Embedded PostgreSQL (`@electric-sql/pglite`) stored under `./data/college_pg`

## Roles & Capabilities
- **Registrar / Admin**: Admit students, manage academic status, create courses, assign faculty, enroll students, enter grades, mark attendance, and issue/collect tuition invoices.
- **Faculty**: View assigned courses and student rosters, record daily class attendance, and submit student grades.
- **Student**: Browse the Fall 2026 course catalog, register or drop courses, view GPA and grades, review attendance records, and pay tuition invoices.

## Running Locally
```bash
npm install
npm run dev
```

## Demo Accounts
- **Registrar / Admin**: `dean.vance@college.edu` / `Admin#2026`
- **Faculty**: `prof.morales@college.edu` / `Faculty#2026`
- **Student**: `marcus.chen@college.edu` / `Student#2026`
