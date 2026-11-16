"use client";
// Sonner mounts its portal in the browser.
import { Toaster as Sonner } from "sonner";
export function Toaster() {
  return <Sonner position="bottom-right" theme="light" />;
}
