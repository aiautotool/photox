import net from 'node:net';

export interface TrustedProxyConfig {
  trustedProxyAddresses: string[];
}

function normalizeAddress(value: string | undefined): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('::ffff:') && net.isIP(raw.slice(7)) === 4) return raw.slice(7);
  return raw;
}

export function parseTrustedProxyAddresses(value: string | undefined): string[] {
  const result = new Set<string>();
  for (const entry of String(value || '').split(',')) {
    const normalized = normalizeAddress(entry);
    if (!normalized) continue;
    if (normalized === 'loopback') {
      result.add('127.0.0.1');
      result.add('::1');
      continue;
    }
    if (!net.isIP(normalized)) throw new Error(`PHOTOX_WEB_TRUSTED_PROXIES contains invalid address: ${entry.trim()}`);
    result.add(normalized);
  }
  return [...result];
}

export function isTrustedProxyPeer(remoteAddress: string | undefined, trustedProxyAddresses: readonly string[]): boolean {
  const peer = normalizeAddress(remoteAddress);
  return Boolean(peer && trustedProxyAddresses.some(address => normalizeAddress(address) === peer));
}

function forwardedValues(value: string | string[] | undefined): string[] {
  const raw = Array.isArray(value) ? value.join(',') : String(value || '');
  return raw.split(',').map(part => part.trim()).filter(Boolean);
}

export function resolveClientAddress(
  remoteAddress: string | undefined,
  xForwardedFor: string | string[] | undefined,
  trustedProxyAddresses: readonly string[],
): string {
  const peer = normalizeAddress(remoteAddress) || 'unknown';
  if (!isTrustedProxyPeer(peer, trustedProxyAddresses)) return peer;

  const chain = forwardedValues(xForwardedFor).map(normalizeAddress).filter(address => net.isIP(address) !== 0);
  if (!chain.length) return peer;

  // Walk from the hop nearest PhotoX backwards. Forwarded values supplied by an
  // untrusted client cannot move the trust boundary past the first untrusted hop.
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const candidate = chain[index];
    if (!isTrustedProxyPeer(candidate, trustedProxyAddresses)) return candidate;
  }
  return chain[0] || peer;
}

export function forwardedProtoIsHttps(
  remoteAddress: string | undefined,
  xForwardedProto: string | string[] | undefined,
  trustedProxyAddresses: readonly string[],
): boolean {
  if (!isTrustedProxyPeer(remoteAddress, trustedProxyAddresses)) return false;
  const values = forwardedValues(xForwardedProto);
  if (!values.length) return false;
  return values[values.length - 1].toLowerCase() === 'https';
}
