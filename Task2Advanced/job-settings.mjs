import assert from 'node:assert/strict';
import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const jobSettingNames = ['TF_DEPLOYMENT_ENABLED', 'TF_ENVIRONMENT', 'TF_APPROVERS',
  'TF_STATE_ENDPOINT', 'TF_STATE_BUCKET', 'TF_STATE_REGION', 'TF_STATE_ENCRYPTION', 'TF_STATE_KMS_KEY_ID',
  'TF_PLAN_DIRECTORY', 'TF_VAR_folder_id', 'TF_VAR_boot_image_id', 'TF_VAR_ssh_public_key',
  'TF_YC_PLAN_SERVICE_ACCOUNT_ID', 'TF_YC_APPLY_SERVICE_ACCOUNT_ID'];
export const releaseSettingNames = [...jobSettingNames, 'TF_PLAN_INTENT', 'TF_RELEASE_VM_ID', 'TF_RELEASE_BOOT_DISK_ID', 'TF_RELEASE_DATA_DISK_ID'];

export function validateJobSettings(configurations, jobName) {
  const release = jobName === 'future-release-stage';
  assert(release || /^future-deploy-(dev|stage|prod)$/.test(jobName), 'Unknown deployment job');
  const configuration = configurations[jobName];
  assert(configuration && !Array.isArray(configuration) && typeof configuration === 'object', 'Missing job configuration');
  const names = [...(release ? releaseSettingNames : jobSettingNames)];
  if (Object.hasOwn(configuration, 'TF_VAR_existing_network_id')) {
    assert.equal(jobName, 'future-deploy-prod', 'Network reuse is limited to prod');
    assert(/^[a-z0-9]{20}$/.test(configuration.TF_VAR_existing_network_id), 'Use an exact existing network ID');
    names.push('TF_VAR_existing_network_id');
  }
  assert.deepEqual(Object.keys(configuration).sort(), [...names].sort(), 'Unexpected or missing job settings');
  assert(Object.values(configuration).every(value => typeof value === 'string' && value.trim() && !/[\r\n\0]/.test(value)), 'Job settings must be nonempty single-line strings');
  assert.equal(jobName, release ? `future-release-${configuration.TF_ENVIRONMENT}` : `future-deploy-${configuration.TF_ENVIRONMENT}`, 'Job and environment differ');
  if (release) {
    assert.equal(configuration.TF_PLAN_INTENT, 'release-stage-compute');
    const ids = ['VM', 'BOOT_DISK', 'DATA_DISK'].map(name => configuration[`TF_RELEASE_${name}_ID`]);
    assert(ids.every(value => /^[a-z0-9]{20}$/.test(value)) && new Set(ids).size === 3, 'Release requires three distinct exact resource IDs');
  }
  assert.equal(configuration.TF_DEPLOYMENT_ENABLED, 'true', 'Deployment is disabled');
  assert.notEqual(configuration.TF_YC_PLAN_SERVICE_ACCOUNT_ID, configuration.TF_YC_APPLY_SERVICE_ACCOUNT_ID, 'Compute identities must differ');
  return names.map(name => `${name}=${configuration[name]}`).join('\n') + '\n';
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
