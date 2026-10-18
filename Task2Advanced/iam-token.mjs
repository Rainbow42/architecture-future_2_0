import assert from 'node:assert/strict';
import { constants, createPrivateKey, sign } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const iamEndpoint = 'https://iam.api.cloud.yandex.net/iam/v1/tokens';

export function readAuthorizedKey(filename) {
  assert(path.isAbsolute(filename), 'Use an explicit authorized-key file');
  const info = lstatSync(filename);
  assert(info.isFile() && !info.isSymbolicLink() && info.uid === process.getuid() && (info.mode & 0o077) === 0, 'Authorized-key file must be private and runner-owned');
  return JSON.parse(readFileSync(filename, 'utf8'));
}

export function signedJwt(key, expectedIdentity, now = Date.now()) {
  assert(/^[a-z0-9]{20}$/.test(expectedIdentity), 'Expected service account ID is required');
  assert.equal(key.service_account_id, expectedIdentity, 'Authorized key belongs to another identity');
  assert(/^[a-z0-9]{20}$/.test(key.id), 'Invalid authorized-key ID');
  const start = String(key.private_key ?? '').indexOf('-----BEGIN');
  assert(start >= 0, 'Private key is missing');
  const privateKey = createPrivateKey(key.private_key.slice(start));
  assert(privateKey.asymmetricKeyType === 'rsa' && privateKey.asymmetricKeyDetails.modulusLength >= 4096, 'Expected an RSA4096 authorized key');
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const issued = Math.floor(now / 1000);
  const body = `${encode({ alg: 'PS256', typ: 'JWT', kid: key.id })}.${encode({ aud: iamEndpoint, iss: expectedIdentity, iat: issued, exp: issued + 600 })}`;
  const signature = sign('sha256', Buffer.from(body), { key: privateKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 });
  return `${body}.${signature.toString('base64url')}`;
}

export async function exchangeAuthorizedKey(key, expectedIdentity, request = fetch) {
  const jwt = signedJwt(key, expectedIdentity);
  const response = await request(iamEndpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jwt }),
    redirect: 'error', signal: AbortSignal.timeout(15_000),
  });
  assert(response.ok, 'IAM exchange was rejected');
  const result = await response.json();
  assert(typeof result.iamToken === 'string' && result.iamToken.length > 20, 'IAM token is missing');
  assert(Date.parse(result.expiresAt) - Date.now() >= 35 * 60_000, 'IAM token does not cover the stage timeout');
  return result.iamToken;
}
