import { isIP } from "node:net";

export function clientIp(socket: string, forwarded: string | undefined, hops: number): string {
  if (hops === 0 || !forwarded) return socket;
  const addresses = forwarded.split(",").map((address) => address.trim());
  if (addresses.length < hops || addresses.some((address) => !isIP(address))) return socket;
  return addresses[addresses.length - hops] ?? socket;
}
