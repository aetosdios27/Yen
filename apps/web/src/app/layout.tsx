import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppShell } from "../components/app-shell";
import { LocaleProvider } from "../i18n";
import { en } from "../i18n/messages/en";
import "./globals.css";

export const metadata: Metadata = {
  title: en.metadata.appTitle,
  description: en.metadata.appDescription,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <LocaleProvider>
          <AppShell>{children}</AppShell>
        </LocaleProvider>
      </body>
    </html>
  );
}
