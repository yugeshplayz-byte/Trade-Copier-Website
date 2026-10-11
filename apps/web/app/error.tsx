'use client';

/** Generic error boundary. Never renders stack traces or raw error details. */
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="standalone">
      <p className="standalone__code">Page error</p>
      <h1>This page failed to load</h1>
      <p>The execution worker is a separate process. This page error does not stop it.</p>
      <p>
        <button type="button" className="btn" onClick={reset}>
          Try again
        </button>
      </p>
    </main>
  );
}
