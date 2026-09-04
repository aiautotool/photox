import test from 'node:test';
import assert from 'node:assert/strict';
import {
  forwardedProtoIsHttps,
  isTrustedProxyPeer,
  parseTrustedProxyAddresses,
  resolveClientAddress,
} from './webProxyTrust.js';

test('trusted proxy config normalizes loopback and IPv4-mapped peers', () => {
  assert.deepEqual(parseTrustedProxyAddresses('loopback,10.0.0.2'), ['127.0.0.1', '::1', '10.0.0.2']);
  assert.equal(isTrustedProxyPeer('::ffff:127.0.0.1', ['127.0.0.1']), true);
  assert.throws(() => parseTrustedProxyAddresses('proxy.internal'), /invalid address/);
});

test('untrusted peers cannot spoof forwarded client identity or HTTPS', () => {
  const trusted = ['127.0.0.1'];
  assert.equal(resolveClientAddress('203.0.113.10', '198.51.100.5', trusted), '203.0.113.10');
  assert.equal(forwardedProtoIsHttps('203.0.113.10', 'https', trusted), false);
});

test('trusted proxy resolves nearest untrusted client and HTTPS protocol', () => {
  const trusted = ['127.0.0.1', '10.0.0.2'];
  assert.equal(resolveClientAddress('127.0.0.1', '198.51.100.7, 10.0.0.2', trusted), '198.51.100.7');
  assert.equal(forwardedProtoIsHttps('127.0.0.1', 'http, https', trusted), true);
});

test('malformed forwarded addresses are ignored rather than becoming rate-limit identities', () => {
  const trusted = ['127.0.0.1'];
  assert.equal(resolveClientAddress('127.0.0.1', 'spoofed, 198.51.100.9', trusted), '198.51.100.9');
  assert.equal(resolveClientAddress('127.0.0.1', 'spoofed', trusted), '127.0.0.1');
});
