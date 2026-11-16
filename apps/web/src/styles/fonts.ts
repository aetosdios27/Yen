import { Geist, Geist_Mono, Noto_Sans_Devanagari } from "next/font/google";

const sans = Geist({ subsets: ["latin"], display: "swap", variable: "--font-geist" });
const mono = Geist_Mono({
  subsets: ["latin"],
  display: "swap",
  preload: false,
  variable: "--font-geist-mono",
});
const devanagariSans = Noto_Sans_Devanagari({
  subsets: ["devanagari"],
  weight: ["400", "500", "600"],
  display: "swap",
  preload: false,
  variable: "--font-devanagari-sans",
});
export const fontVariables = [sans.variable, mono.variable, devanagariSans.variable].join(" ");
