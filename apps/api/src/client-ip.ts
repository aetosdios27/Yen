import { isIP } from "node:net";

export function clientIp(socket: string, forwarded: string | undefined, hops: number): string {
  if (hops === 0 || !forwarded) return socket;
  const addresses = forwarded.split(",");
  if (addresses.length < hops) return socket;
  const selected = addresses[addresses.length - hops]?.trim();
  if (!selected) return socket;
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(selected);
  const ipv4WithPort = /^(\d+\.\d+\.\d+\.\d+):\d+$/.exec(selected);
  const address = bracketed?.[1] ?? ipv4WithPort?.[1] ?? selected;
  const version = isIP(address);
  if (version === 4) return address;
  if (version === 6) {
    try {
      return new URL(`http://[${address}]/`).hostname.slice(1, -1);
    } catch {
      return socket;
    }
  }
  return socket;
}
