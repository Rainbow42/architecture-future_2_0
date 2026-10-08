import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const terraformVersion = '1.12.2';
export const environments = ['dev', 'stage', 'prod'];
export const planLifetimeMs = 24 * 60 * 60 * 1000;
export const digest = value => createHash('sha256').update(value).digest('hex');

export function required(variables, name) {
  const value = variables[name];
  assert(typeof value === 'string' && value.trim(), `Missing ${name}`);
  return value;
}

export function backendConfig(environment, variables) {
  assert(environments.includes(environment), 'Unknown environment');
  const endpoint = new URL(required(variables, 'TF_STATE_ENDPOINT'));
  assert(endpoint.protocol === 'https:' && !endpoint.username && !endpoint.password, 'Backend requires HTTPS without embedded credentials');
  assert(!endpoint.search && !endpoint.hash && endpoint.pathname === '/', 'Backend endpoint must be an origin');
  const bucket = required(variables, 'TF_STATE_BUCKET');
  assert(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket), 'Invalid bucket name');
  const region = required(variables, 'TF_STATE_REGION');
  assert(/^[a-z0-9-]+$/.test(region), 'Invalid region');
  return {
    bucket,
    key: `sprint11/${environment}/terraform.tfstate`,
    workspace_key_prefix: `sprint11/${environment}/workspaces`,
    region,
    endpoints: { s3: endpoint.origin },
    use_lockfile: true,
    use_path_style: true,
    encrypt: true,
    skip_credentials_validation: true,
    skip_requesting_account_id: true,
    skip_metadata_api_check: true,
    skip_region_validation: true,
  };
}

export function backendHcl(configuration) {
  return Object.entries(configuration).map(([key, value]) => `${key} = ${JSON.stringify(value).replaceAll('${', () => '$${').replaceAll('%{', () => '%%{')}`).join('\n') + '\n';
}

export function executionContext(environment, variables, backend) {
  const inputs = Object.fromEntries(['TF_VAR_folder_id', 'TF_VAR_boot_image_id', 'TF_VAR_ssh_public_key'].map(name => [name, required(variables, name)]));
  const context = {
    environment,
    revision: required(variables, 'TF_SOURCE_REVISION'),
    runId: required(variables, 'TF_RUN_ID'),
    attempt: required(variables, 'TF_RUN_ATTEMPT'),
    terraform: terraformVersion,
    configuration: digest(JSON.stringify({ backend, inputs })),
  };
  assert(/^[a-f0-9]{40}$/.test(context.revision), 'Expected a full Git commit SHA');
  assert(/^\d+$/.test(context.runId) && /^\d+$/.test(context.attempt), 'Invalid run identity');
  return context;
}

export function verifyPlan(metadata, context, plan, now = Date.now()) {
  assert.deepEqual(metadata.context, context, 'Saved plan belongs to a different run, revision, inputs or backend');
  assert(Number.isSafeInteger(metadata.createdAt) && metadata.createdAt <= now && now - metadata.createdAt <= planLifetimeMs, 'Plan has expired or has an invalid timestamp');
  assert.equal(metadata.sha256, digest(plan), 'Saved plan checksum differs');
}

export function summarizePlan(plan) {
  const resources = {};
  for (const change of plan.resource_changes ?? []) {
    const action = change.change.actions.join('/');
    resources[action] = (resources[action] ?? 0) + 1;
  }
  return { resources, outputs: Object.values(plan.output_changes ?? {}).filter(change => change.actions.some(action => action !== 'no-op')).length };
}
