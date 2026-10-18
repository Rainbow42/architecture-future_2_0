import assert from 'node:assert/strict';
import { constants, generateKeyPairSync, verify } from 'node:crypto';
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { exchangeAuthorizedKey, iamEndpoint, readAuthorizedKey, signedJwt } from './iam-token.mjs';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 4096 });
const identity = 'a'.repeat(20);
const key = { id: 'b'.repeat(20), service_account_id: identity, private_key: `Synthetic prefix\n${privateKey.export({ type: 'pkcs8', format: 'pem' })}` };
const jwt = signedJwt(key, identity, 1_000_000);
const parts = jwt.split('.');
assert.deepEqual(JSON.parse(Buffer.from(parts[0], 'base64url')), { alg: 'PS256', typ: 'JWT', kid: key.id });
assert.deepEqual(JSON.parse(Buffer.from(parts[1], 'base64url')), { aud: iamEndpoint, iss: identity, iat: 1000, exp: 1600 });
assert(verify('sha256', Buffer.from(parts.slice(0, 2).join('.')), { key: publicKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }, Buffer.from(parts[2], 'base64url')));
assert.throws(() => signedJwt(key, 'c'.repeat(20)));
let requests = 0;
const response = (token = 'synthetic-not-an-iam-token', expiresAt = new Date(Date.now() + 60 * 60_000).toISOString()) => ({ ok: true, json: async () => ({ iamToken: token, expiresAt }) });
const request = async (url, options) => {
  requests += 1;
  assert.equal(url, iamEndpoint);
  assert.equal(options.redirect, 'error');
  assert.equal(options.method, 'POST');
  assert.equal(Object.keys(JSON.parse(options.body)).join(','), 'jwt');
  return response();
};
assert.equal(await exchangeAuthorizedKey(key, identity, request), 'synthetic-not-an-iam-token');
await exchangeAuthorizedKey(key, identity, request);
assert.equal(requests, 2, 'Each stage must exchange a fresh JWT');
await assert.rejects(exchangeAuthorizedKey(key, identity, async () => ({ ok: false })));
await assert.rejects(exchangeAuthorizedKey(key, identity, async () => response('short')));
await assert.rejects(exchangeAuthorizedKey(key, identity, async () => response(undefined, new Date().toISOString())));
const directory = mkdtempSync(path.join(tmpdir(), 'sprint11-iam-check-'));
try {
  const filename = path.join(directory, 'synthetic-key.json');
  writeFileSync(filename, JSON.stringify(key), { mode: 0o600 });
  assert.equal(readAuthorizedKey(filename).service_account_id, identity);
  chmodSync(filename, 0o644);
  assert.throws(() => readAuthorizedKey(filename));
  chmodSync(filename, 0o600);
  symlinkSync(filename, path.join(directory, 'symlink.json'));
  assert.throws(() => readAuthorizedKey(path.join(directory, 'symlink.json')));
} finally { rmSync(directory, { recursive: true, force: true }); }
console.log('PASS: synthetic PS256 signature, identity binding, fresh exchange per stage, token lifetime, private-key file protection. No real IAM request was made.');
