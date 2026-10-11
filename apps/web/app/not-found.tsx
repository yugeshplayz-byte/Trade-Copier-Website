import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="standalone">
      <p className="standalone__code">404</p>
      <h1>Page not found</h1>
      <p>This page does not exist.</p>
      <p>
        <Link href="/overview" className="btn">
          Back to overview
        </Link>
      </p>
    </main>
  );
}
