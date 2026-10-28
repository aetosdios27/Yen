"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
  prompt(): Promise<void>;
}

export interface UseInstallPromptOptions {
  /**
   * Action-based trigger override. If true, satisfies the "useful action" condition
   * even on the first page view.
   */
  trigger?: boolean | undefined;
  /**
   * Minimum session page views before showing prompt automatically. Defaults to 2.
   */
  minPageViews?: number | undefined;
  /**
   * How long dismissal is remembered in milliseconds. Defaults to 14 days.
   */
  dismissExpiryMs?: number | undefined;
  /**
   * LocalStorage key for dismissal expiry timestamp.
   */
  storageKey?: string | undefined;
  /**
   * SessionStorage key for session page views.
   */
  sessionKey?: string | undefined;
}

const DEFAULT_EXPIRY_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
const DEFAULT_STORAGE_KEY = "yen_pwa_dismissed_until";
const DEFAULT_SESSION_KEY = "yen_pwa_session_views";

export function useInstallPrompt(options: UseInstallPromptOptions = {}) {
  const {
    trigger = false,
    minPageViews = 2,
    dismissExpiryMs = DEFAULT_EXPIRY_MS,
    storageKey = DEFAULT_STORAGE_KEY,
    sessionKey = DEFAULT_SESSION_KEY,
  } = options;

  const [hasPromptEvent, setHasPromptEvent] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const [hasUsefulActivity, setHasUsefulActivity] = useState(false);
  const deferredPromptRef = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    // Check if dismissed and not expired
    const dismissedUntil = window.localStorage?.getItem(storageKey);
    if (dismissedUntil) {
      const expiry = Number(dismissedUntil);
      if (!Number.isNaN(expiry) && expiry > Date.now()) {
        setIsDismissed(true);
        return;
      }
      // Expired: clean it up
      window.localStorage?.removeItem(storageKey);
    }

    // Track session page views (first view = 1, second view = 2, etc.)
    let currentViews = 1;
    try {
      const stored = window.sessionStorage?.getItem(sessionKey);
      currentViews = (stored ? Number(stored) : 0) + 1;
      window.sessionStorage?.setItem(sessionKey, String(currentViews));
    } catch {
      // sessionStorage might be disabled in private mode
    }

    const useful = trigger || currentViews >= minPageViews;
    setHasUsefulActivity(useful);

    // Detect iOS (where beforeinstallprompt is not supported)
    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIosDevice =
      /iphone|ipad|ipod/.test(userAgent) ||
      (window.navigator.platform === "MacIntel" && window.navigator.maxTouchPoints > 1);
    const isStandalone =
      (window.navigator as unknown as { standalone?: boolean }).standalone === true ||
      (typeof window.matchMedia === "function" &&
        window.matchMedia("(display-mode: standalone)").matches);

    if (isIosDevice && !isStandalone) {
      setIsIos(true);
    }

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      deferredPromptRef.current = event as BeforeInstallPromptEvent;
      setHasPromptEvent(true);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    };
  }, [trigger, minPageViews, storageKey, sessionKey]);

  const promptInstall = useCallback(async () => {
    if (!deferredPromptRef.current) {
      return;
    }
    await deferredPromptRef.current.prompt();
    const choice = await deferredPromptRef.current.userChoice;
    deferredPromptRef.current = null;
    setHasPromptEvent(false);
    if (choice.outcome === "accepted" || choice.outcome === "dismissed") {
      setIsDismissed(true);
    }
  }, []);

  const dismiss = useCallback(() => {
    if (typeof window !== "undefined") {
      try {
        window.localStorage?.setItem(storageKey, String(Date.now() + dismissExpiryMs));
      } catch {
        // Ignore private browsing storage errors
      }
    }
    setIsDismissed(true);
  }, [storageKey, dismissExpiryMs]);

  // Can install if useful activity has occurred, not dismissed, and either:
  // 1) beforeinstallprompt was captured, or
  // 2) user is on iOS in browser
  const canPrompt = hasUsefulActivity && !isDismissed && (hasPromptEvent || isIos);

  return {
    canPrompt,
    isIos,
    isDismissed,
    hasUsefulActivity,
    promptInstall,
    dismiss,
  };
}
