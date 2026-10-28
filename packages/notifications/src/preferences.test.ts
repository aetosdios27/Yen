import { parseUserId } from "@yen/shared";
import { describe, expect, it } from "vitest";
import {
  calculateQuietHoursEnd,
  getDefaultUserPreferences,
  getEligibleChannels,
  isChannelEnabled,
  isDuringQuietHours,
} from "./preferences.js";
import type { UserPreferences } from "./types.js";

describe("User Notification Preferences & Quiet Hours", () => {
  const userResult = parseUserId("11111111-1111-7111-8111-111111111111");
  if (!userResult.ok) throw new Error(userResult.error);
  const userId = userResult.value;

  describe("channel eligibility and opt-out", () => {
    it("provides sane default preferences", () => {
      const prefs = getDefaultUserPreferences(userId);
      expect(prefs.whatsapp_enabled).toBe(true);
      expect(prefs.sms_enabled).toBe(true);
      expect(prefs.email_enabled).toBe(true);
      expect(prefs.opted_out).toBe(false);
      expect(prefs.locale).toBe("en");
      expect(prefs.quiet_hours_enabled).toBe(false);
    });

    it("honors global opt-out across every channel", () => {
      const prefs: UserPreferences = {
        ...getDefaultUserPreferences(userId),
        opted_out: true,
      };

      expect(isChannelEnabled(prefs, "whatsapp")).toBe(false);
      expect(isChannelEnabled(prefs, "sms")).toBe(false);
      expect(isChannelEnabled(prefs, "email")).toBe(false);
      expect(getEligibleChannels(prefs, "whatsapp")).toEqual([]);
    });

    it("does not change the selected channel when WhatsApp is disabled", () => {
      const prefs: UserPreferences = {
        ...getDefaultUserPreferences(userId),
        whatsapp_enabled: false,
      };

      expect(isChannelEnabled(prefs, "whatsapp")).toBe(false);
      expect(isChannelEnabled(prefs, "sms")).toBe(true);
      expect(getEligibleChannels(prefs, "whatsapp")).toEqual([]);
      expect(getEligibleChannels(prefs, "sms")).toEqual(["sms"]);
    });

    it("does not fall back to email when the selected phone channel is disabled", () => {
      const prefs: UserPreferences = {
        ...getDefaultUserPreferences(userId),
        whatsapp_enabled: false,
        sms_enabled: false,
      };

      expect(getEligibleChannels(prefs, "whatsapp")).toEqual([]);
    });

    it("returns empty when all channels are disabled", () => {
      const prefs: UserPreferences = {
        ...getDefaultUserPreferences(userId),
        whatsapp_enabled: false,
        sms_enabled: false,
        email_enabled: false,
      };

      expect(getEligibleChannels(prefs, "whatsapp")).toEqual([]);
    });
  });

  describe("quiet hours", () => {
    it("returns false if quiet hours disabled", () => {
      const prefs = getDefaultUserPreferences(userId);
      expect(isDuringQuietHours(prefs, new Date())).toBe(false);
    });

    it("detects overnight quiet hours correctly in user's timezone", () => {
      const prefs: UserPreferences = {
        ...getDefaultUserPreferences(userId),
        quiet_hours_enabled: true,
        quiet_hours_start: "22:00",
        quiet_hours_end: "07:00",
        timezone: "UTC",
      };

      // 23:30 UTC -> inside quiet hours
      const night = new Date("2026-10-28T23:30:00.000Z");
      expect(isDuringQuietHours(prefs, night)).toBe(true);

      // 03:00 UTC -> inside quiet hours
      const earlyMorning = new Date("2026-10-29T03:00:00.000Z");
      expect(isDuringQuietHours(prefs, earlyMorning)).toBe(true);

      // 12:00 UTC -> outside quiet hours
      const afternoon = new Date("2026-10-28T12:00:00.000Z");
      expect(isDuringQuietHours(prefs, afternoon)).toBe(false);
    });

    it("calculates future end of quiet hours", () => {
      const prefs: UserPreferences = {
        ...getDefaultUserPreferences(userId),
        quiet_hours_enabled: true,
        quiet_hours_start: "22:00",
        quiet_hours_end: "07:00",
        timezone: "UTC",
      };

      const now = new Date("2026-10-28T23:00:00.000Z");
      const end = calculateQuietHoursEnd(prefs, now);
      expect(end.getTime()).toBeGreaterThan(now.getTime());
      expect(isDuringQuietHours(prefs, end)).toBe(false);
    });
  });
});
