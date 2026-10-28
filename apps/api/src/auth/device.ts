/**
 * Extracts a concise human-readable device/browser descriptor from User-Agent for device list.
 */
export function parseDeviceInfo(userAgent: string | undefined): string {
  if (!userAgent || userAgent.trim() === "") return "Unknown device";
  const ua = userAgent.toLowerCase();
  let os = "Unknown OS";
  if (ua.includes("android")) os = "Android";
  else if (ua.includes("iphone") || ua.includes("ipad") || ua.includes("ios")) os = "iOS";
  else if (ua.includes("mac os") || ua.includes("macintosh")) os = "macOS";
  else if (ua.includes("windows")) os = "Windows";
  else if (ua.includes("linux")) os = "Linux";

  let client = "Browser";
  if (ua.includes("firefox")) client = "Firefox";
  else if (ua.includes("edg")) client = "Edge";
  else if (ua.includes("chrome") || ua.includes("crios")) client = "Chrome";
  else if (ua.includes("safari")) client = "Safari";
  else if (ua.includes("yen")) client = "Yen App";

  return `${client} on ${os}`;
}
