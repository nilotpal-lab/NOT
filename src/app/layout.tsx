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
  title: "SST Library — Social Science Classes 6–10",
  description:
    "Explore chapters, notes, textbooks, and interactive presentations for Classes 6 to 10. Read online or download study materials in one click.",
  icons: {
    icon: "/assets/brand-mark.svg",
    apple: "/assets/favicon-512.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={dmSans.variable}>
      <head>
        <link rel="icon" href="/assets/brand-mark.svg" type="image/svg+xml" />
        <link rel="alternate icon" href="/assets/favicon-512.png" type="image/png" />
      </head>
      <body className="min-h-screen flex flex-col font-sans bg-[var(--page-bg)] text-[var(--foreground)] antialiased selection:bg-[var(--primary)] selection:text-white">
        {/* ── Top Navbar ─────────────────────────────────────────────── */}
        <header className="bg-white border-b border-[var(--border)] px-4 sm:px-8 h-20 sticky top-0 z-40 shadow-xs flex items-center">
          <div className="w-full max-w-[1180px] mx-auto flex items-center justify-between">
            {/* Brand */}
            <a href="/" className="flex items-center gap-3 group">
              <div className="w-11 h-11 flex items-center justify-center shrink-0">
                <img
                  src="/assets/brand-mark.svg"
                  alt="SST Library Logo"
                  className="w-11 h-11 object-contain group-hover:scale-105 transition-transform"
                />
              </div>
              <div className="flex items-center gap-2.5">
                <span className="font-extrabold text-xl tracking-tight text-[var(--foreground)]">
                  SST Library
                </span>
                <span className="inline-flex items-center text-xs font-medium text-[var(--muted-foreground)] bg-[#eef2f8] px-2.5 py-1 rounded-full border border-[var(--border)]/70">
                  Classes 6–10
                </span>
              </div>
            </a>

            {/* Nav */}
            <nav className="flex items-center gap-2">
              <a
                href="/admin"
                className="flex items-center gap-2 text-xs font-semibold px-4 py-2 rounded-full border border-[var(--border)] bg-white text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--primary)]/50 hover:bg-[var(--primary)]/5 transition-all shadow-2xs"
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
        <footer className="bg-white border-t border-[var(--border)] py-4.5 mt-10">
          <div className="max-w-[1180px] mx-auto px-4 sm:px-8 flex flex-col sm:flex-row items-center justify-between gap-2.5 text-xs text-[var(--muted-foreground)]">
            <span>Crafted with ♥ by Nilotpal</span>
            <div className="flex items-center gap-4">
              <a href="/api/health" className="flex items-center gap-1.5 hover:text-[var(--primary)] transition-colors">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block"></span>
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
