import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import * as jose from 'jose';
import { googleIdentity, facebookIdentity } from '../policies/providerIdentity.js';
import { verifyGoogleTokenForAudiences, verifyGoogleIdToken, verifyFacebookAccessToken, getGoogleAuthUrl } from './auth.service.js';
import { closePool } from '../db/client.js';
import { env } from '../config/env.js';

after(closePool);
test('Google requires verified email, stable subject, approved audience and presenter', () => {
  const valid = { sub: 'subject', email: 'verified@example.test', email_verified: true, aud: 'approved' };
  assert.deepEqual(googleIdentity(valid, ['approved']), { id: 'subject', email: valid.email });
  for (const change of [{ email_verified: false }, { email_verified: 'true' }, { sub: '' },
    { aud: 'wrong' }, { azp: 'wrong' }, { aud: ['approved', 'second'] }]) {
    assert.throws(() => googleIdentity({ ...valid, ...change }, ['approved']));
  }
});
test('Google cryptographic verification rejects wrong issuer, audience, signature, algorithm and expiry', async () => {
  const { privateKey, publicKey } = await jose.generateKeyPair('RS256');
  const jwk = await jose.exportJWK(publicKey);
  const keys = jose.createLocalJWKSet({ keys: [{ ...jwk, kid: 'test-key', alg: 'RS256' }] });
  const sign = (changes: jose.JWTPayload = {}) => new jose.SignJWT({
    sub: 'subject', email: 'verified@example.test', email_verified: true,
    aud: 'approved', iss: 'https://accounts.google.com', ...changes,
  }).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).setIssuedAt().setExpirationTime('1h').sign(privateKey);
  assert.equal((await verifyGoogleTokenForAudiences(await sign(), ['approved'], keys)).id, 'subject');
  const previous = { client: env.GOOGLE_CLIENT_ID, mobile: env.GOOGLE_MOBILE_CLIENT_IDS, redirect: env.GOOGLE_REDIRECT_URI };
  env.GOOGLE_CLIENT_ID = 'approved'; env.GOOGLE_MOBILE_CLIENT_IDS = ''; env.GOOGLE_REDIRECT_URI = 'https://api.example.test/callback';
  try {
    assert.equal((await verifyGoogleIdToken(await sign(), keys)).id, 'subject', 'Configured web client supports explicit linking without native IDs');
    assert.ok(new URL(getGoogleAuthUrl('state')).searchParams.get('scope')!.split(' ').includes('openid'));
    await assert.rejects(verifyGoogleIdToken(await sign({ azp: 'unknown-native-presenter' }), keys));
    env.GOOGLE_CLIENT_ID = ''; await assert.rejects(verifyGoogleIdToken(await sign(), keys), /not configured/);
  } finally {
    env.GOOGLE_CLIENT_ID = previous.client; env.GOOGLE_MOBILE_CLIENT_IDS = previous.mobile; env.GOOGLE_REDIRECT_URI = previous.redirect;
  }
  for (const change of [{ iss: 'https://attacker.test' }, { aud: 'wrong' }, { email_verified: false }]) {
    await assert.rejects(verifyGoogleTokenForAudiences(await sign(change), ['approved'], keys));
  }
  const expired = await new jose.SignJWT({ sub: 'subject', aud: 'approved', iss: 'https://accounts.google.com' })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).setIssuedAt(1).setExpirationTime(2).sign(privateKey);
  await assert.rejects(verifyGoogleTokenForAudiences(expired, ['approved'], keys));
  const wrong = await jose.generateKeyPair('RS256');
  const badSignature = await new jose.SignJWT({ sub: 'subject' }).setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuedAt().setExpirationTime('1h').sign(wrong.privateKey);
  await assert.rejects(verifyGoogleTokenForAudiences(badSignature, ['approved'], keys));
  const hs = await new jose.SignJWT({ sub: 'subject' }).setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h').sign(new TextEncoder().encode('attacker-secret'));
  await assert.rejects(verifyGoogleTokenForAudiences(hs, ['approved'], keys));
});
test('Facebook binds debug app and subject to profile; email presence is not proof', () => {
  const data = { is_valid: true, app_id: 'app', user_id: 'subject', expires_at: 2000, data_access_expires_at: 2000 };
  assert.deepEqual(facebookIdentity(data, { id: 'subject' }, 'app', 1000), { id: 'subject', email: '' });
  for (const change of [{ is_valid: false }, { app_id: 'wrong' }, { user_id: 'other' }, { expires_at: 999 }, { data_access_expires_at: 999 }]) {
    assert.throws(() => facebookIdentity({ ...data, ...change }, { id: 'subject', email: 'present@example.test' }, 'app', 1000));
  }
});

test('Facebook token verification rejects debug/profile subject collisions before account login', async () => {
  const previous = { client: env.FACEBOOK_CLIENT_ID, secret: env.FACEBOOK_CLIENT_SECRET, fetch: globalThis.fetch };
  env.FACEBOOK_CLIENT_ID = 'test-app'; env.FACEBOOK_CLIENT_SECRET = 'test-only-secret';
  let profileId = 'subject';
  globalThis.fetch = async input => new Response(JSON.stringify(String(input).includes('/debug_token?') ? {
    data: { is_valid: true, app_id: 'test-app', user_id: 'subject', expires_at: Math.floor(Date.now() / 1000) + 3600 },
  } : { id: profileId, email: 'present-but-unverified@example.test' }), { headers: { 'content-type': 'application/json' } });
  try {
    assert.equal((await verifyFacebookAccessToken('test-token')).id, 'subject');
    profileId = 'different-subject'; await assert.rejects(verifyFacebookAccessToken('test-token'), /subject/);
  } finally { env.FACEBOOK_CLIENT_ID = previous.client; env.FACEBOOK_CLIENT_SECRET = previous.secret; globalThis.fetch = previous.fetch; }
});
