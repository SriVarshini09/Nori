import { Instrument_Serif } from "next/font/google";
import "@/components/landing/landing.css";

/** The serif is the landing page's accent voice (one or two italic words per heading); the app stays on Inter. */
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--font-serif", display: "swap" });

export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${serif.variable} ln ln-grain min-h-screen`}>{children}</div>;
}
