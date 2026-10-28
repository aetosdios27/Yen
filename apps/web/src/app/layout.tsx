import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { AppShell } from "../components/app-shell";
import { ServiceWorkerRegistration } from "../components/service-worker-registration";
import { LocaleProvider } from "../i18n";
import { en } from "../i18n/messages/en";
import { MANIFEST_THEME_COLOR } from "./manifest";
import "./globals.css";

export const metadata: Metadata = {
  title: en.metadata.appTitle,
  description: en.metadata.appDescription,
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: en.app.name,
  },
};

export const viewport: Viewport = {
  themeColor: MANIFEST_THEME_COLOR,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <LocaleProvider>
          <ServiceWorkerRegistration />
          <AppShell>{children}</AppShell>
        </LocaleProvider>
      </body>
    </html>
  );
}
