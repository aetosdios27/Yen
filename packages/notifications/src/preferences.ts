import type { UserId } from "@yen/shared";
import type { NotificationChannel, UserPreferences } from "./types.js";

export function getDefaultUserPreferences(userId: UserId): UserPreferences {
  return {
    user_id: userId,
    whatsapp_enabled: true,
    sms_enabled: true,
    email_enabled: true,
    opted_out: false,
    locale: "en",
    quiet_hours_enabled: false,
    quiet_hours_start: null,
    quiet_hours_end: null,
    timezone: "Asia/Kolkata",
  };
}

export function isChannelEnabled(
  preferences: UserPreferences,
  channel: NotificationChannel,
): boolean {
  if (preferences.opted_out) {
    return false;
  }
  switch (channel) {
    case "whatsapp":
      return preferences.whatsapp_enabled;
    case "sms":
      return preferences.sms_enabled;
    case "email":
      return preferences.email_enabled;
  }
}

/** Resolves the user's explicitly selected channel without silently changing channels. */
export function getEligibleChannels(
  preferences: UserPreferences,
  preferredChannel: NotificationChannel = "whatsapp",
): NotificationChannel[] {
  if (preferences.opted_out) {
    return [];
  }

  return isChannelEnabled(preferences, preferredChannel) ? [preferredChannel] : [];
}

/**
 * Parses "HH:mm" into minutes since midnight (0..1439).
 */
function parseTimeToMinutes(timeStr: string): number {
  const parts = timeStr.split(":");
  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  return hours * 60 + minutes;
}

/**
 * Checks whether the specified date falls inside user's configured quiet hours.
 */
export function isDuringQuietHours(preferences: UserPreferences, now: Date = new Date()): boolean {
  if (!preferences.quiet_hours_enabled) {
    return false;
  }
  if (!preferences.quiet_hours_start || !preferences.quiet_hours_end) {
    return false;
  }

  // Format current time in user's timezone as HH:mm
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: preferences.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const formattedParts = formatter.formatToParts(now);
  const hourPart = formattedParts.find((p) => p.type === "hour")?.value ?? "00";
  const minutePart = formattedParts.find((p) => p.type === "minute")?.value ?? "00";
  const currentMinutes = Number(hourPart) * 60 + Number(minutePart);

  const startMinutes = parseTimeToMinutes(preferences.quiet_hours_start);
  const endMinutes = parseTimeToMinutes(preferences.quiet_hours_end);

  if (startMinutes <= endMinutes) {
    // Normal window, e.g. 13:00 - 15:00
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }

  // Overnight window, e.g. 22:00 - 07:00
  return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

/**
 * Calculates the exact Date when quiet hours will end.
 */
export function calculateQuietHoursEnd(preferences: UserPreferences, now: Date = new Date()): Date {
  if (!preferences.quiet_hours_end) {
    return now;
  }

  const [endHour, endMinute] = preferences.quiet_hours_end.split(":").map(Number);
  if (endHour === undefined || endMinute === undefined) {
    return now;
  }

  // Advance by up to 24 hours until quiet hours end
  const candidate = new Date(now.getTime());
  // Adjust time forward in 15 minute increments until outside quiet hours
  for (let i = 0; i < 96; i++) {
    candidate.setTime(candidate.getTime() + 15 * 60 * 1000);
    if (!isDuringQuietHours(preferences, candidate)) {
      return candidate;
    }
  }

  // Fallback 8 hours later
  return new Date(now.getTime() + 8 * 3600 * 1000);
}
