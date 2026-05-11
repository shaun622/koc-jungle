import { Link } from 'react-router-dom';

export function NotFound() {
  return (
    <main className="mx-auto max-w-md p-12 text-center text-slate-400">
      <h1 className="text-3xl font-bold mb-2">Not found</h1>
      <p className="mb-4">That page doesn't exist.</p>
      <Link to="/" className="text-emerald-300 underline">
        Go home
      </Link>
    </main>
  );
}
