export default function HomePage() {
  const classes = [6, 7, 8, 9, 10];

  return (
    <div className="space-y-8">
      {/* Intro section */}
      <section className="text-center py-6">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mb-2">
          Social Science Study Materials
        </h1>
        <p className="text-[var(--muted)] max-w-xl mx-auto text-base">
          Browse chapters, read notes, and download official NCERT textbooks and presentations for Classes 6 to 10.
        </p>
      </section>

      {/* Class Selection Grid */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--muted)] mb-4 text-center">
          Select Your Class
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 max-w-2xl mx-auto">
          {classes.map((cls) => (
            <a
              key={cls}
              href={`/class/${cls}`}
              className="flex flex-col items-center justify-center p-5 rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] hover:border-[var(--accent)] hover:shadow-xs transition-all min-h-[64px]"
            >
              <span className="text-xs text-[var(--muted)]">Class</span>
              <span className="text-2xl font-bold text-[var(--foreground)]">{cls}</span>
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}
