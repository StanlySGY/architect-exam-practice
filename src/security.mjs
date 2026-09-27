import { timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

function normalizedHost(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw.startsWith("[")) {
    const close = raw.indexOf("]");
    return close > 0 ? raw.slice(1, close) : raw;
  }
  if (isIP(raw) === 6) return raw;
  return raw.split(":")[0];
}

export const normalizeHost = normalizedHost;

export function isLoopbackHost(value) {
  const host = normalizedHost(value);
  if (host === "localhost") return true;
  if (isIP(host) === 4) return host.split(".")[0] === "127";
  return isIP(host) === 6 && (host === "::1" || host === "0:0:0:0:0:0:0:1");
}

export function accessTokenMatches(provided, expected) {
  if (typeof provided !== "string" || typeof expected !== "string") return false;
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function ipv4Parts(value) {
  const parts = String(value).split(".").map(Number);
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? parts
    : null;
}

function privateIpv4(value) {
  const parts = ipv4Parts(value);
  if (!parts) return false;
  const [first, second] = parts;
  return (
    first === 0 ||
    first === 10 ||
    (first === 100 && second >= 64 && second <= 127) ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51) ||
    (first === 203 && second === 0) ||
    first >= 224
  );
}

function privateIpv6(value) {
  const address = String(value).toLowerCase().split("%")[0];
  if (address === "::" || address === "::1") return true;
  const mappedMatch = address.match(/^(?:::ffff:|0:0:0:0:0:ffff:)(.+)$/);
  if (mappedMatch) {
    let mapped = mappedMatch[1];
    if (/^[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(mapped)) {
      const [high, low] = mapped.split(":").map((part) => Number.parseInt(part, 16));
      mapped = `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
    }
    if (privateIpv4(mapped)) return true;
  }
  const firstHextet = Number.parseInt(address.split(":")[0] || "0", 16);
  return (
    (firstHextet & 0xfe00) === 0xfc00 ||
    (firstHextet >= 0xfe80 && firstHextet <= 0xfebf) ||
    firstHextet >= 0xff00
  );
}

export function isPrivateAddress(value) {
  const address = String(value ?? "").trim();
  if (isIP(address) === 4) return privateIpv4(address);
  if (isIP(address) === 6) return privateIpv6(address);
  return false;
}

export function isBlockedHostname(value) {
  const host = normalizedHost(value);
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "metadata" ||
    host === "metadata.google.internal" ||
    host.endsWith(".internal")
  );
}

export function parseAllowedHosts(value) {
  return new Set(
    String(value ?? "")
      .split(",")
      .map((item) => {
        const raw = item.trim().toLowerCase();
        if (!raw) return "";
        if (raw.startsWith("[")) {
          const close = raw.indexOf("]");
          if (close > 0) {
            const host = normalizedHost(raw.slice(0, close + 1));
            const suffix = raw.slice(close + 1);
            return /^:\d+$/.test(suffix) ? `${host}${suffix}` : host;
          }
        }
        if (isIP(raw) === 6) return raw;
        const portMatch = raw.match(/^(.+):(\d+)$/);
        return portMatch ? `${normalizedHost(portMatch[1])}:${portMatch[2]}` : normalizedHost(raw);
      })
      .filter(Boolean),
  );
}

export function isAllowedHost(hostname, port, allowedHosts) {
  const host = normalizedHost(hostname);
  const portSuffix = port ? `:${port}` : "";
  return allowedHosts.has(host) || allowedHosts.has(`${host}${portSuffix}`);
}
