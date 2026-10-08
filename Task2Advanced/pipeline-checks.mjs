import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const source = path.dirname(fileURLToPath(import.meta.url));
const fixture = mkdtempSync(path.join(tmpdir(), 'sprint11-pipeline-check-'));
try {
  const checkout = path.join(fixture, 'checkout');
  const bin = path.join(fixture, 'bin');
  const store = path.join(fixture, 'private-plans');
  for (const directory of [checkout, bin, store]) mkdirSync(directory, { mode: 0o700 });
  mkdirSync(path.join(checkout, 'Task2Advanced'));
  mkdirSync(path.join(checkout, 'Task1Advanced/envs/dev'), { recursive: true });
  for (const file of ['lib.mjs', 'pipeline.mjs']) copyFileSync(path.join(source, file), path.join(checkout, 'Task2Advanced', file));
  writeFileSync(path.join(checkout, 'Task1Advanced/envs/dev/fixture.txt'), 'Synthetic configuration; not a cloud deployment.');
  const git = (...args) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: checkout, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q');
  git('add', 'Task1Advanced/envs/dev/fixture.txt', 'Task2Advanced/lib.mjs', 'Task2Advanced/pipeline.mjs');
  git('-c', 'user.name=Local Check', '-c', 'user.email=check@example.invalid', 'commit', '-qm', 'Add synthetic pipeline fixture');
  const mock = path.join(bin, 'terraform');
  writeFileSync(mock, `#!${process.execPath}
import fs from 'node:fs';
process.chdir(process.argv[2].slice('-chdir='.length));
const args = process.argv.slice(3);
fs.appendFileSync(process.env.FAKE_CALL_LOG, args[0] + '\\n');
if (args[0] === 'version') console.log(JSON.stringify({terraform_version:'1.12.2'}));
if (args[0] === 'plan') fs.writeFileSync(args.find(arg => arg.startsWith('-out=')).slice(5), 'synthetic plan bytes');
if (args[0] === 'show') console.log(args.includes('-json') ? JSON.stringify({resource_changes:[]}) : 'Synthetic plan description');
if (args[0] === 'apply' && process.env.FAKE_APPLY_FAILURE === 'true') {
  fs.writeFileSync('errored.tfstate', 'synthetic recovery state');
  console.error('SYNTHETIC_PRIVATE_DIAGNOSTIC');
  process.exit(1);
}
`);
  chmodSync(mock, 0o700);
  const variables = {
    PATH: `${bin}:${process.env.PATH}`, TF_DEPLOYMENT_ENABLED: 'true', TF_PLAN_DIRECTORY: store,
    TF_STATE_ENDPOINT: 'https://state.example.invalid', TF_STATE_BUCKET: 'example-state', TF_STATE_REGION: 'us-east-1',
    TF_VAR_folder_id: 'synthetic-folder', TF_VAR_boot_image_id: 'synthetic-image', TF_VAR_ssh_public_key: 'synthetic-public-key',
    AWS_ACCESS_KEY_ID: 'synthetic-not-a-credential', AWS_SECRET_ACCESS_KEY: 'synthetic-not-a-credential', YC_TOKEN: 'synthetic-not-a-token',
    TF_SOURCE_REVISION: git('rev-parse', 'HEAD'), TF_RUN_ID: '123', TF_RUN_ATTEMPT: '1', FAKE_CALL_LOG: path.join(fixture, 'calls.txt'),
  };
  function run(operation, overrides = {}, expectedCode = 0) {
    const result = spawnSync(process.execPath, ['Task2Advanced/pipeline.mjs', operation, 'dev'], { cwd: checkout, env: { ...variables, ...overrides }, encoding: 'utf8' });
    assert.equal(result.status, expectedCode, result.stderr);
    return `${result.stdout}${result.stderr}`;
  }
  run('plan', { TF_DEPLOYMENT_ENABLED: 'false' }, 1);
  assert(!existsSync(variables.FAKE_CALL_LOG));
  run('plan');
  const planned = path.join(store, '123-1-dev');
  assert(existsSync(path.join(planned, 'approved.tfplan')));
  run('apply', { TF_VAR_folder_id: 'different-folder' }, 1);
  assert(!readFileSync(variables.FAKE_CALL_LOG, 'utf8').split('\n').includes('apply'));
  run('apply');
  assert(existsSync(path.join(planned, 'apply-completed.json')));
  assert(!existsSync(path.join(store, 'dev.recovery-required.json')));
  run('apply', {}, 1);
  const calls = readFileSync(variables.FAKE_CALL_LOG, 'utf8').trim().split('\n');
  assert.equal(calls.filter(call => call === 'plan').length, 1);
  assert.equal(calls.filter(call => call === 'apply').length, 1);
  run('plan', { TF_RUN_ID: '124' });
  const failed = run('apply', { TF_RUN_ID: '124', FAKE_APPLY_FAILURE: 'true' }, 1);
  assert(!failed.includes('SYNTHETIC_PRIVATE_DIAGNOSTIC'));
  assert(existsSync(path.join(store, 'dev.recovery-required.json')));
  assert.equal(readFileSync(path.join(store, '124-1-dev/source/Task1Advanced/envs/dev/errored.tfstate'), 'utf8'), 'synthetic recovery state');
  assert(readFileSync(path.join(store, '124-1-dev/apply-failure.private.log'), 'utf8').includes('SYNTHETIC_PRIVATE_DIAGNOSTIC'));
  run('plan', { TF_RUN_ID: '125' }, 1);
  console.log('PASS: disabled gate, exact saved plan, input mismatch rejection, no replan, repeated apply rejection, private failure recovery and blocked retry');
  console.log('Terraform was a local stub. No credentials, network services, real state or cloud resources were used.');
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
