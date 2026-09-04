export function FieldError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p className="error" role="alert">
      {message}
    </p>
  );
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      {children ? <div className="muted">{children}</div> : null}
    </section>
  );
}
