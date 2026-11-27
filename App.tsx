import React, { useState } from 'react';
import {
  LayoutDashboard,
  Users,
  BookOpen,
  GraduationCap,
  CalendarCheck,
  Receipt,
  LogOut,
  Menu,
  X,
} from 'lucide-react';
import { LoginView } from './components/LoginView';
import { AcademicOverviewView } from './components/AcademicOverviewView';
import { StudentsDirectoryView } from './components/StudentsDirectoryView';
import { CoursesCatalogView } from './components/CoursesCatalogView';
import { GradesAttendanceView } from './components/GradesAttendanceView';
import { TuitionFeesView } from './components/TuitionFeesView';
import type { AuthUser } from './types';

type NavKey = 'overview' | 'students' | 'courses' | 'grades' | 'attendance' | 'fees';

export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [activeNav, setActiveNav] = useState<NavKey>('overview');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleLoginSuccess = (newToken: string, newUser: AuthUser) => {
    setToken(newToken);
    setUser(newUser);
    setActiveNav('overview');
  };

  const handleSignOut = () => {
    setToken(null);
    setUser(null);
    setMobileMenuOpen(false);
  };

  if (!token || !user) {
    return <LoginView onLoginSuccess={handleLoginSuccess} />;
  }

  const navItems: Array<{ key: NavKey; label: string; icon: React.ComponentType<{ className?: string }> }> =
    user.role === 'ADMIN'
      ? [
          { key: 'overview', label: 'Academic Overview', icon: LayoutDashboard },
          { key: 'students', label: 'Students & Admissions', icon: Users },
          { key: 'courses', label: 'Courses & Faculty', icon: BookOpen },
          { key: 'grades', label: 'Enrollments & Grades', icon: GraduationCap },
          { key: 'attendance', label: 'Class Attendance', icon: CalendarCheck },
          { key: 'fees', label: 'Tuition & Fees', icon: Receipt },
        ]
      : user.role === 'FACULTY'
        ? [
            { key: 'overview', label: 'Faculty Overview', icon: LayoutDashboard },
            { key: 'courses', label: 'Course Catalog', icon: BookOpen },
            { key: 'students', label: 'Student Directory', icon: Users },
            { key: 'grades', label: 'Gradebook', icon: GraduationCap },
            { key: 'attendance', label: 'Mark Attendance', icon: CalendarCheck },
          ]
        : [
            { key: 'overview', label: 'My Academic Overview', icon: LayoutDashboard },
            { key: 'courses', label: 'Course Registration', icon: BookOpen },
            { key: 'grades', label: 'My Courses & Grades', icon: GraduationCap },
            { key: 'attendance', label: 'My Attendance', icon: CalendarCheck },
            { key: 'fees', label: 'My Tuition & Fees', icon: Receipt },
          ];

  const activeTitle = navItems.find((i) => i.key === activeNav)?.label || 'Overview';
  const roleLabel =
    user.role === 'ADMIN' ? 'Registrar / Admin' : user.role === 'FACULTY' ? 'Faculty' : 'Student';

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex md:w-64 md:flex-col bg-white border-r border-slate-200 shrink-0">
        <div className="h-16 px-6 border-b border-slate-200 flex items-center">
          <span className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap">
            CampusCore
          </span>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeNav === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setActiveNav(item.key)}
                className={`w-full px-3 py-2.5 text-xs font-medium rounded-lg flex items-center gap-2.5 transition-colors whitespace-nowrap cursor-pointer ${
                  active ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200 text-xs text-slate-500">
          <div className="font-medium text-slate-900 truncate">{user.fullName}</div>
          <div className="mt-0.5 truncate">
            {user.code} · {roleLabel}
          </div>
        </div>
      </aside>

      {/* Mobile Sidebar */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 md:hidden bg-slate-900/40 flex">
          <div className="w-64 bg-white h-full border-r border-slate-200 flex flex-col">
            <div className="h-16 px-5 border-b border-slate-200 flex items-center justify-between">
              <span className="font-display text-lg font-bold text-slate-900">CampusCore</span>
              <button type="button" onClick={() => setMobileMenuOpen(false)} className="p-1 text-slate-500">
                <X className="w-4 h-4" />
              </button>
            </div>
            <nav className="flex-1 p-4 space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = activeNav === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => {
                      setActiveNav(item.key);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full px-3 py-2.5 text-xs font-medium rounded-lg flex items-center gap-2.5 ${
                      active ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between gap-8">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="md:hidden p-1.5 text-slate-600 hover:text-slate-900"
              aria-label="Open navigation"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="text-xs text-slate-500 truncate">
              <span>{roleLabel}</span>
              <span className="mx-2 text-slate-300">/</span>
              <span className="font-semibold text-slate-900">{activeTitle}</span>
            </div>
          </div>

          <div className="flex items-center gap-4 shrink-0">
            <span className="hidden sm:inline text-xs text-slate-600 whitespace-nowrap">
              {user.fullName} · {user.deptName}
            </span>
            <button
              type="button"
              onClick={handleSignOut}
              className="px-3.5 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        </header>

        <main className="flex-1 p-6 max-w-[1280px] w-full mx-auto">
          {activeNav === 'overview' && <AcademicOverviewView token={token} user={user} />}
          {activeNav === 'students' && (
            <StudentsDirectoryView token={token} isAdmin={user.role === 'ADMIN'} />
          )}
          {activeNav === 'courses' && <CoursesCatalogView token={token} user={user} />}
          {activeNav === 'grades' && (
            <GradesAttendanceView token={token} user={user} defaultTab="grades" />
          )}
          {activeNav === 'attendance' && (
            <GradesAttendanceView token={token} user={user} defaultTab="attendance" />
          )}
          {activeNav === 'fees' && <TuitionFeesView token={token} user={user} />}
        </main>
      </div>
    </div>
  );
}
