import type { Metadata } from "next";
import { catalog } from "../../i18n/catalog";

export const metadata: Metadata = { title: "You are offline" };

// This page is served by the service worker when a request fails, possibly before any of its
// scripts were ever cached. It therefore needs no JavaScript: both languages are printed as plain
// HTML and "try again" is an ordinary link rather than a button with a click handler.
const en = catalog.en.offline;
const hi = catalog.hi.offline;

export default function OfflinePage() {
  return (
    <div className="mx-auto flex max-w-[var(--container-phone)] flex-col items-center justify-center px-4 py-16 text-center">
      <div
        aria-hidden="true"
        className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-surface text-ink-muted"
      >
        <svg
          aria-hidden="true"
          xmlns="http://www.w3.org/2000/svg"
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-8 w-8"
        >
          <line x1="1" y1="1" x2="23" y2="23" />
          <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
          <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
          <path d="M10.71 5.05A16 16 0 0 1 22.58 9" />
          <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
          <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
          <line x1="12" y1="20" x2="12.01" y2="20" />
        </svg>
      </div>
      <h1 className="text-heading font-semibold text-ink" lang="en">
        {en.title}
      </h1>
      <p className="mt-4 text-body text-ink-muted" lang="en">
        {en.message}
      </p>
      <h2 className="mt-8 text-heading font-semibold text-ink" lang="hi">
        {hi.title}
      </h2>
      <p className="mt-4 text-body text-ink-muted" lang="hi">
        {hi.message}
      </p>
      <div className="mt-8">
        <a
          href="/"
          className="tap-target inline-flex items-center justify-center gap-2 rounded-control border-2 border-primary bg-primary px-5 py-3 text-body font-semibold text-on-solid transition-colors hover:bg-primary-hover"
        >
          <span lang="en">{en.retry}</span>
          <span aria-hidden="true">·</span>
          <span lang="hi">{hi.retry}</span>
        </a>
      </div>
    </div>
  );
}
