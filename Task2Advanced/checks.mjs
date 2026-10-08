import assert from 'node:assert/strict';
import { backendConfig, backendHcl, digest, executionContext, planLifetimeMs, summarizePlan, verifyPlan } from './lib.mjs';

const variables = {
  TF_STATE_ENDPOINT: 'https://state.example.invalid', TF_STATE_BUCKET: 'example-state', TF_STATE_REGION: 'us-east-1',
  TF_SOURCE_REVISION: 'a'.repeat(40), TF_RUN_ID: '123', TF_RUN_ATTEMPT: '1',
  TF_VAR_folder_id: 'synthetic-folder', TF_VAR_boot_image_id: 'synthetic-image', TF_VAR_ssh_public_key: 'synthetic-public-key',
};
const configurations = ['dev', 'stage', 'prod'].map(environment => backendConfig(environment, variables));
assert.equal(new Set(configurations.map(config => config.key)).size, 3);
for (const configuration of configurations) {
  assert.equal(configuration.use_lockfile, true);
  assert.equal(configuration.encrypt, true);
  assert(!Object.hasOwn(configuration, 'access_key'));
  assert(!Object.hasOwn(configuration, 'secret_key'));
}
for (const endpoint of ['http://state.example.invalid', 'https://user:password@state.example.invalid', 'https://state.example.invalid/path', 'https://state.example.invalid?token=example']) {
  assert.throws(() => backendConfig('dev', { ...variables, TF_STATE_ENDPOINT: endpoint }));
}
assert.throws(() => backendConfig('../prod', variables));
assert.throws(() => backendConfig('dev', { ...variables, TF_STATE_BUCKET: '' }));
assert.throws(() => executionContext('dev', { ...variables, TF_RUN_ID: '../123' }, configurations[0]));
assert(backendHcl(configurations[0]).includes('key = "sprint11/dev/terraform.tfstate"'));
assert.equal(backendHcl({ sample: '${example} %{example}' }), 'sample = "$${example} %%{example}"\n');

const context = executionContext('dev', variables, configurations[0]);
const plan = Buffer.from('synthetic plan, not Terraform output');
const now = 100_000;
const metadata = { context, createdAt: now, sha256: digest(plan) };
verifyPlan(metadata, context, plan, now + 1);
for (const field of Object.keys(context)) {
  assert.throws(() => verifyPlan(metadata, { ...context, [field]: 'different' }, plan, now));
}
assert.throws(() => verifyPlan(metadata, context, Buffer.from('changed'), now));
assert.throws(() => verifyPlan(metadata, context, plan, now + planLifetimeMs + 1));
assert.throws(() => verifyPlan(metadata, context, plan, now - 1));
assert.notEqual(executionContext('dev', { ...variables, TF_VAR_folder_id: 'another-folder' }, configurations[0]).configuration, context.configuration);
assert.deepEqual(summarizePlan({ resource_changes: [{ change: { actions: ['create'] } }, { change: { actions: ['delete', 'create'] } }], output_changes: { x: { actions: ['update'] } } }), { resources: { create: 1, 'delete/create': 1 }, outputs: 1 });
console.log('PASS: three isolated backend keys, safe config, plan/run/input/version binding, checksum/expiry rejection, sanitized counts');
console.log('Remote state, lock contention, Jenkins approval and cloud apply were not exercised.');
