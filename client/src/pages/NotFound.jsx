import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { Logo } from '../components/ui.jsx';

export default function NotFound() {
  const { isAuthenticated } = useAuth();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-5 text-center">
      <Logo className="mb-8" />
      <p className="text-6xl font-extrabold text-brand-600 dark:text-brand-400">404</p>
      <h1 className="mt-3 text-2xl font-extrabold text-ink dark:text-white">Page not found</h1>
      <p className="mt-2 max-w-sm text-sm muted">
        The page you are looking for does not exist or has moved.
      </p>
      <Link to={isAuthenticated ? '/dashboard' : '/'} className="btn-primary mt-8 !px-7 !py-3">
        {isAuthenticated ? 'Back to dashboard' : 'Back to home'}
      </Link>
    </div>
  );
}
