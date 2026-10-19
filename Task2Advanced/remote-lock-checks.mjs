import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, copyFileSync, lstatSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { S3Client, HeadObjectCommand, DeleteObjectCommand, GetBucketAclCommand, GetBucketEncryptionCommand, GetBucketPolicyCommand, GetBucketVersioningCommand } from '@aws-sdk/client-s3';
import { backendConfig, backendHcl, encryptionSettings, required, terraformVersion } from './lib.mjs';
import { verifyStorageMetadata } from './storage-metadata.mjs';

assert.deepEqual(process.argv.slice(2), ['--write-probes']);
const privateRoot = required(process.env, 'TF_LOCK_PROBE_DIRECTORY');
const terraform = required(process.env, 'TF_BINARY');
assert(path.isAbsolute(privateRoot) && path.isAbsolute(terraform));
const info = lstatSync(privateRoot);
assert(info.isDirectory() && !info.isSymbolicLink() && info.uid === process.getuid() && (info.mode & 0o077) === 0, 'A private runner-owned 0700 directory is required');
const directory = mkdtempSync(path.join(privateRoot, 'remote-lock-'));
chmodSync(directory, 0o700);
const fixture = fileURLToPath(new URL('./checks/remote-lock/main.tf', import.meta.url));
copyFileSync(fixture, path.join(directory, 'main.tf'));
chmodSync(path.join(directory, 'main.tf'), 0o600);
const credentials = JSON.parse(readFileSync(path.join(required(process.env, 'TF_STATE_CREDENTIALS_DIRECTORY'), 'state-dev.json'), 'utf8'));
const configuration = backendConfig('dev', process.env);
assert.equal(encryptionSettings(process.env).mode, 'bucket-kms', 'This live probe targets the prepared Yandex KMS backend');
configuration.key = `sprint11/dev/verification/${randomUUID()}/terraform.tfstate`;
configuration.workspace_key_prefix = configuration.key + '-workspaces';
writeFileSync(path.join(directory, 'backend.private.hcl'), backendHcl(configuration), { mode: 0o600 });
const environment = {
  PATH: '/usr/bin:/bin', HOME: directory, TMPDIR: directory,
  TF_IN_AUTOMATION: 'true', TF_INPUT: 'false', TF_CLI_CONFIG_FILE: '/dev/null',
  AWS_ACCESS_KEY_ID: credentials.accessKeyId, AWS_SECRET_ACCESS_KEY: credentials.secretAccessKey,
  AWS_EC2_METADATA_DISABLED: 'true', AWS_SHARED_CREDENTIALS_FILE: path.join(directory, 'no-aws-profile'), AWS_CONFIG_FILE: path.join(directory, 'no-aws-config'),
};
const client = new S3Client({ endpoint: configuration.endpoints.s3, region: configuration.region, forcePathStyle: true, credentials, requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED', maxAttempts: 2 });
const children = [];
let operation = 'metadata-preflight';
function start(name, args) {
  const child = spawn(terraform, args, { cwd: directory, env: environment, stdio: ['ignore', 'pipe', 'pipe'], timeout: 90_000, killSignal: 'SIGINT' });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  const result = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => {
      writeFileSync(path.join(directory, `${name}.private.log`), output, { mode: 0o600 });
      resolve({ code, output });
    });
  });
  children.push(child);
  return { child, result };
}
async function run(name, args) { return await start(name, args).result; }
try {
  const input = { Bucket: configuration.bucket };
  const [versioning, encryption, acl, policy] = await Promise.all([
    client.send(new GetBucketVersioningCommand(input)), client.send(new GetBucketEncryptionCommand(input)),
    client.send(new GetBucketAclCommand(input)), client.send(new GetBucketPolicyCommand(input)),
  ]);
  verifyStorageMetadata({ ...encryptionSettings(process.env), bucket: configuration.bucket }, { versioning, encryption, acl, policy });
  operation = 'version';
  const version = await run('version', ['version', '-json']);
  assert.equal(version.code, 0);
  assert.equal(JSON.parse(version.output).terraform_version, terraformVersion);
  operation = 'init';
  const init = await run('init', ['init', '-input=false', '-no-color', '-backend-config=backend.private.hcl']);
  assert.equal(init.code, 0, 'Remote init failed; inspect the private log');
  operation = 'holder-apply';
  const holder = start('holder', ['apply', '-auto-approve', '-input=false', '-no-color']);
  const lockDeadline = Date.now() + 12_000;
  let acquired = false;
  while (!acquired && Date.now() < lockDeadline) {
    try {
      await client.send(new HeadObjectCommand({ Bucket: configuration.bucket, Key: configuration.key + '.tflock' }));
      acquired = true;
    } catch (error) { if (error.$metadata?.httpStatusCode !== 404) throw error; }
    if (!acquired) await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert(acquired, 'Terraform did not acquire the remote lock');
  operation = 'contender-plan';
  const contender = await run('contender', ['plan', '-input=false', '-no-color', '-lock-timeout=1s']);
  assert.equal(contender.code, 1);
  assert.match(contender.output, /Error acquiring the state lock/);
  operation = 'waiting-plan';
  const waiter = start('waiter', ['plan', '-input=false', '-no-color', '-lock-timeout=40s']);
  const holderResult = await holder.result;
  assert.equal(holderResult.code, 0, 'Holder failed; inspect private diagnostics');
  const waiterResult = await waiter.result;
  assert.equal(waiterResult.code, 0, 'Waiting process failed after lock release');
  assert.match(waiterResult.output, /Acquiring state lock/);
  operation = 'after-release-plan';
  const after = await run('after-release', ['plan', '-input=false', '-no-color', '-lock-timeout=1s', '-detailed-exitcode']);
  assert.equal(after.code, 0, 'Post-release plan must have no changes');
  const stateHead = await client.send(new HeadObjectCommand({ Bucket: configuration.bucket, Key: configuration.key }));
  assert.equal(stateHead.ServerSideEncryption, 'aws:kms');
  assert.equal(stateHead.SSEKMSKeyId, encryptionSettings(process.env).keyId);
  await assert.rejects(client.send(new HeadObjectCommand({ Bucket: configuration.bucket, Key: configuration.key + '.tflock' })), error => error.$metadata?.httpStatusCode === 404);
  await client.send(new DeleteObjectCommand({ Bucket: configuration.bucket, Key: configuration.key }));
  console.log(JSON.stringify({ terraform: terraformVersion, remoteLock: true, competingProcessDenied: true, waitingProcessPassed: true, postReleaseNoChanges: true, encryptedSyntheticState: true, cloudResourcesCreated: false }));
} catch (error) {
  console.error(JSON.stringify({ operation, failure: error.name, status: error.$metadata?.httpStatusCode, privateDiagnostics: directory }));
  process.exitCode = 1;
} finally {
  for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGINT');
  client.destroy();
}
