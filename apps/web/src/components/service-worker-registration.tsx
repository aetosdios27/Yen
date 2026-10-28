"use client";

import { useEffect } from "react";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      return;
    }
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    const register = () => {
      // Classic worker (no `type: "module"`): module service workers are not available on older
      // Android WebViews or Firefox, and sw.js loads its rules with importScripts instead.
      navigator.serviceWorker.register("/sw.js").catch(() => {
        console.warn("Yen could not register its service worker. Offline support is unavailable.");
      });
    };

    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
    }
  }, []);

  return null;
}
