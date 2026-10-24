import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import "./globals.css";

const sans = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

const SITE = process.env.WEB_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
const DESCRIPTION = "Nori turns your resume into a career graph, finds roles that fit, tailors a one-page resume where every line traces to something you did, and fills the application for your approval.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: "Nori", template: "%s - Nori" },
  description: DESCRIPTION,
  applicationName: "Nori",
  openGraph: { type: "website", siteName: "Nori", title: "Nori: a job agent that cannot lie about you", description: DESCRIPTION },
  twitter: { card: "summary_large_image", title: "Nori: a job agent that cannot lie about you", description: DESCRIPTION },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfaf8" },
    { media: "(prefers-color-scheme: dark)", color: "#151311" },
  ],
};

// Every page reads live API data; never prerender at build time.
export const dynamic = "force-dynamic";

/** Applies a saved light or dark choice before first paint, so the page never flashes the other theme. */
const THEME_BOOT = `try{var t=localStorage.getItem("nori-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body className="min-h-screen bg-bg text-ink antialiased">{children}</body>
    </html>
  );
}
