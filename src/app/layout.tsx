import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";
import "./globals.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-dm-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "SST Library — NCERT Social Science Classes 6–10",
  description:
    "Browse NCERT Social Science chapter notes, textbook PDFs, and presentations for Classes 6 to 10.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={dmSans.variable}>
      <body className="min-h-screen flex flex-col font-sans bg-[var(--page-bg)] text-[var(--foreground)] antialiased selection:bg-[var(--primary)] selection:text-white">
        {/* ── Top Navbar ─────────────────────────────────────────────── */}
        <header className="bg-white border-b border-[var(--border)] px-4 sm:px-6 py-3 sticky top-0 z-40 shadow-sm">
          <div className="max-w-6xl mx-auto flex items-center justify-between">
            {/* Brand */}
            <a href="/" className="flex items-center gap-2.5 group">
              <span className="w-9 h-9 rounded-xl bg-gradient-to-tr from-[var(--primary)] to-[#4f46e5] flex items-center justify-center text-white font-bold text-base shadow-sm group-hover:scale-105 transition-transform">
                📚
              </span>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-base sm:text-lg tracking-tight text-[var(--foreground)]">
                  SST Library
                </span>
                <span className="hidden sm:inline-flex items-center text-[11px] font-semibold text-[var(--primary)] bg-[var(--primary)]/10 px-2 py-0.5 rounded-full border border-[var(--primary)]/20">
                  Classes 6–10
                </span>
              </div>
            </a>

            {/* Nav */}
            <nav className="flex items-center gap-2">
              <a
                href="/admin"
                className="flex items-center gap-1.5 text-xs font-semibold px-3.5 py-1.5 rounded-full border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--primary)]/40 hover:bg-[var(--primary)]/5 transition-all"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
                Teacher Admin
              </a>
            </nav>
          </div>
        </header>

        {/* ── Page Content ────────────────────────────────────────────── */}
        <main className="flex-1 w-full">
          {children}
        </main>

        {/* ── Footer ─────────────────────────────────────────────────── */}
        <footer className="bg-white border-t border-[var(--border)] py-4 mt-8">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-[var(--muted-foreground)]">
            <span>Made with ❤️ for NCERT Social Science Study</span>
            <div className="flex items-center gap-4">
              <a href="/api/health" className="flex items-center gap-1.5 hover:text-[var(--primary)] transition-colors">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block"></span>
                System Status
              </a>
              <span>•</span>
              <a href="/admin" className="hover:text-[var(--primary)] transition-colors">
                Teacher Portal
              </a>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
