import assert from 'node:assert/strict';
import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const jobSettingNames = ['TF_DEPLOYMENT_ENABLED', 'TF_ENVIRONMENT', 'TF_APPROVERS',
  'TF_STATE_ENDPOINT', 'TF_STATE_BUCKET', 'TF_STATE_REGION', 'TF_STATE_ENCRYPTION', 'TF_STATE_KMS_KEY_ID',
  'TF_PLAN_DIRECTORY', 'TF_VAR_folder_id', 'TF_VAR_boot_image_id', 'TF_VAR_ssh_public_key',
  'TF_YC_PLAN_SERVICE_ACCOUNT_ID', 'TF_YC_APPLY_SERVICE_ACCOUNT_ID'];

export function validateJobSettings(configurations, jobName) {
  assert(/^future-deploy-(dev|stage|prod)$/.test(jobName), 'Unknown deployment job');
  const configuration = configurations[jobName];
  assert(configuration && !Array.isArray(configuration) && typeof configuration === 'object', 'Missing job configuration');
  assert.deepEqual(Object.keys(configuration).sort(), [...jobSettingNames].sort(), 'Unexpected or missing job settings');
  assert(Object.values(configuration).every(value => typeof value === 'string' && value.trim() && !/[\r\n\0]/.test(value)), 'Job settings must be nonempty single-line strings');
  assert.equal(jobName, `future-deploy-${configuration.TF_ENVIRONMENT}`, 'Job and environment differ');
  assert.equal(configuration.TF_DEPLOYMENT_ENABLED, 'true', 'Deployment is disabled');
  assert.notEqual(configuration.TF_YC_PLAN_SERVICE_ACCOUNT_ID, configuration.TF_YC_APPLY_SERVICE_ACCOUNT_ID, 'Compute identities must differ');
  return jobSettingNames.map(name => `${name}=${configuration[name]}`).join('\n') + '\n';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [filename, jobName, ...extra] = process.argv.slice(2);
    assert(extra.length === 0 && path.isAbsolute(filename));
    const info = lstatSync(filename);
    assert(info.isFile() && !info.isSymbolicLink() && info.uid === process.getuid() && (info.mode & 0o077) === 0, 'Job configuration must be private and runner-owned');
    process.stdout.write(validateJobSettings(JSON.parse(readFileSync(filename, 'utf8')), jobName));
  } catch {
    process.stderr.write('Job settings rejected; no configuration data was published.\n');
    process.exitCode = 1;
  }
}
