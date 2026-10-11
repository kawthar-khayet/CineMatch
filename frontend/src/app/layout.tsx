import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Moviora — Hype or Hidden Gem?",
    template: "%s · Moviora",
  },
  description:
    "Is a movie's hype deserved? Moviora crosses daily trends with IMDb ratings, and recommends movies matched to your tastes, alone or as a group.",
};

// short: label on small screens (the logo already links to the home page)
const NAV = [
  { href: "/", label: "Home", short: null },
  { href: "/hype-check", label: "Hype Check", short: "Hype Check" },
  { href: "/recommend", label: "Recommend", short: "For you" },
];

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur">
          <nav className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
            <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
              <span className="text-xl">🎬</span>
              <span>
                Movi<span className="text-amber-400">ora</span>
              </span>
            </Link>
            <div className="flex items-center gap-1 text-sm sm:gap-2">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`whitespace-nowrap rounded-md px-2 py-1.5 text-muted transition hover:bg-surface hover:text-foreground sm:px-3 ${
                    item.short ? "" : "hidden sm:block"
                  }`}
                >
                  <span className="sm:hidden">{item.short}</span>
                  <span className="hidden sm:inline">{item.label}</span>
                </Link>
              ))}
            </div>
          </nav>
        </header>

        <main className="flex-1">{children}</main>

        <footer className="border-t border-border">
          <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
            <p>
              © 2026 <span className="text-foreground">Moviora</span> — know what is worth
              watching tonight.
            </p>
            <p className="text-xs">
              Data: TMDB, IMDb, MovieLens (GroupLens). This product uses the TMDB API but is not endorsed or certified
              by TMDB.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
