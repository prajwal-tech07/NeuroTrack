import { Suspense, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { initialsOf } from '../utils/format.js';
import { Logo, PageLoader } from './ui.jsx';
import {
  IconAssessment,
  IconClose,
  IconDashboard,
  IconHistory,
  IconLogout,
  IconMenu,
  IconMoon,
  IconProfile,
  IconReports,
  IconSettings,
  IconSun,
} from './Icons.jsx';

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: IconDashboard },
  { to: '/assessment', label: 'Weekly Assessment', icon: IconAssessment },
  { to: '/reports', label: 'Reports', icon: IconReports },
  { to: '/history', label: 'History', icon: IconHistory },
  { to: '/profile', label: 'Profile', icon: IconProfile },
  { to: '/settings', label: 'Settings', icon: IconSettings },
];

function NavItem({ item, onNavigate }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      onClick={onNavigate}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition-all ${
          isActive
            ? 'bg-brand-600 text-white shadow-lift'
            : 'text-slate-500 hover:bg-slate-100 hover:text-ink dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
        }`
      }
    >
      <Icon className="h-[18px] w-[18px]" />
      {item.label}
    </NavLink>
  );
}

export default function AppLayout() {
  const { user, logout } = useAuth();
  const { isDark, toggle } = useTheme();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close the drawer whenever the route changes.
  useEffect(() => setMobileOpen(false), [location.pathname]);

  const handleLogout = async () => {
    await logout();
    toast.success('Signed out');
    navigate('/login', { replace: true });
  };

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-6 pb-6 pt-7">
        <Logo />
        <button
          onClick={() => setMobileOpen(false)}
          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 lg:hidden dark:hover:bg-slate-800"
          aria-label="Close menu"
        >
          <IconClose className="h-5 w-5" />
        </button>
      </div>

      <nav className="flex-1 space-y-1.5 overflow-y-auto px-4">
        {NAV.map((item) => (
          <NavItem key={item.to} item={item} onNavigate={() => setMobileOpen(false)} />
        ))}
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold text-slate-500 transition-all hover:bg-risk-high/10 hover:text-risk-high dark:text-slate-400"
        >
          <IconLogout className="h-[18px] w-[18px]" />
          Logout
        </button>
      </nav>

      <div className="border-t border-slate-100 p-4 dark:border-slate-800">
        <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-900/50">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-extrabold text-brand-700 dark:bg-brand-900/50 dark:text-brand-200">
            {initialsOf(user?.fullName)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink dark:text-slate-100">
              {user?.fullName}
            </p>
            <p className="truncate text-xs muted">{user?.email}</p>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen lg:flex">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-[264px] shrink-0 border-r border-slate-200 bg-white lg:block dark:border-slate-800 dark:bg-surface-cardDark">
        {sidebar}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-ink/40 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute left-0 top-0 h-full w-[280px] animate-fade-up bg-white dark:bg-surface-cardDark">
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur lg:hidden dark:border-slate-800 dark:bg-surface-cardDark/90">
          <button
            onClick={() => setMobileOpen(true)}
            className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            aria-label="Open menu"
          >
            <IconMenu className="h-5 w-5" />
          </button>
          <Logo />
          <button
            onClick={toggle}
            className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            aria-label="Toggle theme"
          >
            {isDark ? <IconSun className="h-5 w-5" /> : <IconMoon className="h-5 w-5" />}
          </button>
        </header>

        {/* Desktop theme toggle floats top-right of the content area */}
        <button
          onClick={toggle}
          className="fixed right-6 top-5 z-40 hidden rounded-xl border border-slate-200 bg-white p-2.5 text-slate-600 shadow-card transition hover:text-brand-600 lg:block dark:border-slate-800 dark:bg-surface-cardDark dark:text-slate-300"
          aria-label="Toggle theme"
        >
          {isDark ? <IconSun className="h-4 w-4" /> : <IconMoon className="h-4 w-4" />}
        </button>

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-9">
          <div className="mx-auto w-full max-w-6xl">
            {/* Page chunks load lazily; the sidebar stays put while they arrive. */}
            <Suspense fallback={<PageLoader />}>
              <Outlet />
            </Suspense>
          </div>
        </main>

        <footer className="border-t border-slate-200 px-6 py-4 dark:border-slate-800">
          <p className="text-center text-xs muted">
            NeuroTrackAI · AI-powered neurological screening · Not a diagnostic device
          </p>
        </footer>
      </div>
    </div>
  );
}
