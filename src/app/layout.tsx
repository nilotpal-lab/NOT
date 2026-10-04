import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SST Chapter Library",
  description: "NCERT Social Science study materials for Classes 6 to 10",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col antialiased">
        <header className="border-b border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-3 sticky top-0 z-10 shadow-xs">
          <div className="max-w-4xl mx-auto flex items-center justify-between">
            <a href="/" className="font-semibold text-lg text-[var(--accent)] hover:opacity-90 transition-opacity">
              SST Chapter Library
            </a>
            <nav className="text-sm">
              <a
                href="/admin"
                className="text-[var(--muted)] hover:text-[var(--foreground)] px-2 py-1 transition-colors"
              >
                Admin
              </a>
            </nav>
          </div>
        </header>

        <main className="flex-1 max-w-4xl w-full mx-auto px-4 py-6">
          {children}
        </main>

        <footer className="border-t border-[var(--border-color)] py-6 text-center text-sm text-[var(--muted)]">
          <div className="max-w-4xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
            <span>SST Chapter Library &bull; Free NCERT Resources</span>
            <a href="/api/health" className="hover:underline">
              System Health
            </a>
          </div>
        </footer>
      </body>
    </html>
  );
}
