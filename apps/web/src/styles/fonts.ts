import {
  Geist,
  Geist_Mono,
  Instrument_Serif,
  Noto_Sans_Devanagari,
  Tiro_Devanagari_Hindi,
} from "next/font/google";

const sans = Geist({ subsets: ["latin"], display: "swap", variable: "--font-geist" });
const mono = Geist_Mono({
  subsets: ["latin"],
  display: "swap",
  preload: false,
  variable: "--font-geist-mono",
});
const display = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  display: "swap",
  preload: false,
  variable: "--font-instrument",
});
const devanagariSans = Noto_Sans_Devanagari({
  subsets: ["devanagari"],
  weight: ["400", "500", "600"],
  display: "swap",
  preload: false,
  variable: "--font-devanagari-sans",
});
const devanagariDisplay = Tiro_Devanagari_Hindi({
  subsets: ["devanagari"],
  weight: "400",
  display: "swap",
  preload: false,
  variable: "--font-devanagari-display",
});

export const fontVariables = [
  sans.variable,
  mono.variable,
  display.variable,
  devanagariSans.variable,
  devanagariDisplay.variable,
].join(" ");
