import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";
import "./globals.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-dm-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "SST Chapter Library — NCERT Resources",
  description: "Browse NCERT Social Science chapter notes, textbook PDFs, and presentations for Classes 6 to 10.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={dmSans.variable}>
      <body className="min-h-screen flex flex-col font-sans bg-[var(--background)] text-[var(--foreground)] antialiased selection:bg-[var(--primary)] selection:text-white">
        <header className="border-b border-[var(--border)] bg-[var(--card)]/90 backdrop-blur-md px-4 py-3 sticky top-0 z-40 shadow-xs transition-colors">
          <div className="max-w-5xl mx-auto flex items-center justify-between">
            <a href="/" className="flex items-center gap-2.5 group">
              <span className="w-9 h-9 rounded-xl bg-gradient-to-tr from-[var(--primary)] to-[var(--secondary)] flex items-center justify-center text-white font-bold text-base shadow-sm group-hover:scale-105 transition-transform">
                📚
              </span>
              <div>
                <span className="font-bold text-base sm:text-lg tracking-tight bg-gradient-to-r from-[var(--primary)] to-[#4f46e5] bg-clip-text text-transparent">
                  SST Library
                </span>
                <span className="hidden sm:inline-block text-[11px] font-medium text-[var(--muted-foreground)] ml-2 px-2 py-0.5 rounded-full bg-[var(--muted)]">
                  Class 6–10 NCERT
                </span>
              </div>
            </a>

            <nav className="flex items-center gap-3">
              <a
                href="/admin"
                className="text-xs font-semibold px-3 py-1.5 rounded-full border border-[var(--border)] hover:bg-[var(--muted)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-all"
              >
                Teacher Admin
              </a>
            </nav>
          </div>
        </header>

        <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-6 sm:py-8">
          {children}
        </main>

        <footer className="border-t border-[var(--border)] py-6 text-center text-xs text-[var(--muted-foreground)] bg-[var(--card)]/40 mt-12">
          <div className="max-w-5xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2.5">
            <span>Made with ❤️ for NCERT Social Science Study</span>
            <div className="flex items-center gap-4">
              <a href="/api/health" className="hover:text-[var(--primary)] transition-colors">
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
