import { Link } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext.jsx';
import { Logo } from './ui.jsx';
import { IconMoon, IconSun } from './Icons.jsx';

export default function AuthShell({ title, subtitle, children, footer }) {
  const { isDark, toggle } = useTheme();

  return (
    <div className="min-h-screen px-5 py-8">
      <div className="mx-auto max-w-5xl">
        <div className="flex items-start justify-between">
          <Link to="/" className="inline-block">
            <Logo />
          </Link>
          <button
            onClick={toggle}
            className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="Toggle theme"
          >
            {isDark ? <IconSun className="h-4 w-4" /> : <IconMoon className="h-4 w-4" />}
          </button>
        </div>

        <div className="mt-6">
          <h1 className="text-3xl font-extrabold tracking-tight text-ink dark:text-white sm:text-4xl">
            {title}
          </h1>
          {subtitle && <p className="mt-1.5 text-sm muted">{subtitle}</p>}
        </div>

        <div className="mt-8 flex justify-center">
          <div className="w-full max-w-lg animate-fade-up">{children}</div>
        </div>

        {footer && <div className="mt-8 text-center">{footer}</div>}
      </div>
    </div>
  );
}
