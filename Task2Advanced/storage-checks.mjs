import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { S3Client, GetBucketAclCommand, GetBucketEncryptionCommand, GetBucketPolicyCommand, GetBucketVersioningCommand, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { backendConfig, encryptionSettings, environments, required } from './lib.mjs';
import { verifyStorageMetadata } from './storage-metadata.mjs';

assert.deepEqual(process.argv.slice(2), ['--write-probes'], 'Explicit --write-probes is required; this check writes synthetic verification objects');
const directory = required(process.env, 'TF_STATE_CREDENTIALS_DIRECTORY');
assert(path.isAbsolute(directory), 'Credential directory must be absolute and private');
const credentialDirectory = lstatSync(directory);
assert(credentialDirectory.isDirectory() && !credentialDirectory.isSymbolicLink() && credentialDirectory.uid === process.getuid() && (credentialDirectory.mode & 0o077) === 0, 'Credential directory must be owned by the runner with mode 0700');
const clients = new Map();
const run = randomUUID();
const probeKey = environment => `sprint11/${environment}/verification/${run}/versioned-probe.txt`;
const lockKey = environment => `sprint11/${environment}/verification/${run}/conditional-lock.json`;
const created = [];
const firstVersions = new Map();
let operation = 'metadata';
let activeEnvironment;

try {
  for (const environment of environments) {
    activeEnvironment = environment;
    const configuration = backendConfig(environment, process.env);
    const identity = JSON.parse(readFileSync(path.join(directory, `state-${environment}.json`), 'utf8'));
    assert(identity.accessKeyId && identity.secretAccessKey, 'Missing explicit S3 credentials');
    const client = new S3Client({
      endpoint: configuration.endpoints.s3, region: configuration.region, forcePathStyle: true, maxAttempts: 2,
      requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
      credentials: { accessKeyId: identity.accessKeyId, secretAccessKey: identity.secretAccessKey },
    });
    clients.set(environment, { client, bucket: configuration.bucket });
    const input = { Bucket: configuration.bucket };
    const [versioning, encryption, acl, policy] = await Promise.all([
      client.send(new GetBucketVersioningCommand(input)), client.send(new GetBucketEncryptionCommand(input)),
      client.send(new GetBucketAclCommand(input)), client.send(new GetBucketPolicyCommand(input)),
    ]);
    verifyStorageMetadata({ ...encryptionSettings(process.env), bucket: configuration.bucket }, { versioning, encryption, acl, policy });
  }
  for (const environment of environments) {
    activeEnvironment = environment;
    const { client, bucket } = clients.get(environment);
    const input = { Bucket: bucket, Key: probeKey(environment) };
    operation = 'create-synthetic-object';
    const first = await client.send(new PutObjectCommand({ ...input, Body: 'synthetic-version-one', IfNoneMatch: '*' }));
    created.push({ client, input });
    assert(first.VersionId, 'Version ID is missing');
    firstVersions.set(environment, first.VersionId);
    operation = 'verify-encrypted-object';
    const head = await client.send(new HeadObjectCommand(input));
    assert.equal(head.ServerSideEncryption, encryptionSettings(process.env).mode === 'bucket-kms' ? 'aws:kms' : 'AES256');
    if (encryptionSettings(process.env).mode === 'bucket-kms') assert.equal(head.SSEKMSKeyId, encryptionSettings(process.env).keyId);
    operation = 'verify-object-versions';
    const second = await client.send(new PutObjectCommand({ ...input, Body: 'synthetic-version-two' }));
    assert(second.VersionId && second.VersionId !== first.VersionId, 'Version IDs must differ');
    const previous = await client.send(new GetObjectCommand({ ...input, VersionId: first.VersionId }));
    assert.equal(await previous.Body.transformToString(), 'synthetic-version-one');
    const current = await client.send(new GetObjectCommand(input));
    assert.equal(await current.Body.transformToString(), 'synthetic-version-two');
    const anonymous = await fetch(`${backendConfig(environment, process.env).endpoints.s3}/${bucket}/${input.Key}`, { redirect: 'error' });
    assert.equal(anonymous.status, 403, 'Anonymous synthetic object read must be forbidden');
    await anonymous.body?.cancel();
    const lockInput = { Bucket: bucket, Key: lockKey(environment) };
    operation = 'conditional-write-race';
    const race = await Promise.allSettled(['one', 'two'].map(value => client.send(new PutObjectCommand({ ...lockInput, Body: `synthetic-lock-${value}`, IfNoneMatch: '*' }))));
    if (race.some(result => result.status === 'fulfilled')) created.push({ client, input: lockInput });
    assert.equal(race.filter(result => result.status === 'fulfilled').length, 1, 'Exactly one conditional write must win');
    const rejected = race.find(result => result.status === 'rejected');
    assert([409, 412].includes(rejected?.reason?.$metadata?.httpStatusCode), 'Losing conditional write must conflict');
    console.log(JSON.stringify({ environment, encryptedObject: true, versionRecovery: true, conditionalWriteRace: true }));
  }
  for (const environment of environments) {
    activeEnvironment = environment;
    operation = 'cross-environment-read';
    const { client, bucket } = clients.get(environment);
    for (const other of environments.filter(value => value !== environment)) {
      const foreign = { Bucket: bucket, Key: probeKey(other) };
      await assert.rejects(client.send(new GetObjectCommand(foreign)), error => error.$metadata?.httpStatusCode === 403, 'Cross-environment object read must be forbidden');
      await assert.rejects(client.send(new GetObjectCommand({ ...foreign, VersionId: firstVersions.get(other) })), error => error.$metadata?.httpStatusCode === 403, 'Cross-environment version read must be forbidden');
      await assert.rejects(client.send(new PutObjectCommand({ ...foreign, Body: 'synthetic-forbidden-overwrite' })), error => error.$metadata?.httpStatusCode === 403, 'Cross-environment object write must be forbidden');
      await assert.rejects(client.send(new DeleteObjectCommand(foreign)), error => error.$metadata?.httpStatusCode === 403, 'Cross-environment object delete must be forbidden');
    }
  }
  console.log('PASS: 24 cross-environment reads/version reads/writes/deletes and three anonymous reads denied. This is an S3 conditional-write test, not Terraform lock contention or cloud deployment.');
} catch (error) {
  console.error(JSON.stringify({ environment: activeEnvironment, operation, failure: error.name ?? 'Error', status: error.$metadata?.httpStatusCode }));
  process.exitCode = 1;
} finally {
  for (const { client, input } of created) {
    try { await client.send(new DeleteObjectCommand(input)); } catch {
      console.error('Synthetic probe cleanup failed; inspect the private verification prefix');
      process.exitCode = 1;
    }
  }
  for (const { client } of clients.values()) client.destroy();
}
