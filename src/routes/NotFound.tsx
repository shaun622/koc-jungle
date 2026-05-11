import { Link } from 'react-router-dom';

export function NotFound() {
  return (
    <div className="landing">
      <div className="landing-card">
        <h1>Not found</h1>
        <p>That page doesn't exist.</p>
        <Link to="/" className="btn primary">
          Go home
        </Link>
      </div>
    </div>
  );
}
