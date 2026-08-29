import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  clearSessionCookie,
  hashPassword,
  sessionCookie,
  verifyPassword,
  SESSION_COOKIE,
} from '../server/lib/auth.mjs';
import { parseCookies } from '../server/lib/helpers.mjs';

test('hashPassword/verifyPassword round-trip and reject wrong password', () => {
  const stored = hashPassword('hunter22');
  assert.match(stored, /^scrypt:[0-9a-f]+:[0-9a-f]+$/);
  assert.equal(verifyPassword('hunter22', stored), true);
  assert.equal(verifyPassword('hunter23', stored), false);
  assert.equal(verifyPassword('', stored), false);
  assert.equal(verifyPassword('hunter22', 'garbage'), false);
});

test('password hashes are salted (same password, different hashes)', () => {
  assert.notEqual(hashPassword('same-password'), hashPassword('same-password'));
});

test('sessionCookie is HttpOnly SameSite with expiry', () => {
  const expires = new Date('2026-01-01T00:00:00Z');
  const cookie = sessionCookie('tok123', expires);
  assert.ok(cookie.startsWith(`${SESSION_COOKIE}=tok123`));
  assert.ok(cookie.includes('HttpOnly'));
  assert.ok(cookie.includes('SameSite=Lax'));
  assert.ok(cookie.includes('Expires=Thu, 01 Jan 2026'));
  assert.ok(!cookie.includes('Secure'));
  assert.ok(sessionCookie('t', expires, { secure: true }).includes('Secure'));
});

test('clearSessionCookie expires immediately', () => {
  const cookie = clearSessionCookie();
  assert.ok(cookie.includes(`${SESSION_COOKIE}=`));
  assert.ok(cookie.includes('Max-Age=0'));
  assert.ok(cookie.includes('HttpOnly'));
});

test('auth sessionCookie value is URL-encoded', () => {
  const cookie = sessionCookie('a b/c', new Date());
  assert.ok(cookie.includes(`${SESSION_COOKIE}=a%20b%2Fc`));
});

test('parseCookies reads back what sessionCookie writes', () => {
  const cookie = sessionCookie('tok-xyz', new Date());
  const header = cookie.split(';')[0];
  assert.equal(parseCookies(header)[SESSION_COOKIE], 'tok-xyz');
});
