import assert from 'node:assert/strict';
import { jobSettingNames, releaseSettingNames, validateJobSettings } from './job-settings.mjs';

const configuration = Object.fromEntries(jobSettingNames.map(name => [name, `synthetic-${name}`]));
configuration.TF_ENVIRONMENT = 'dev';
configuration.TF_DEPLOYMENT_ENABLED = 'true';
const settings = { 'future-deploy-dev': configuration };
const output = validateJobSettings(settings, 'future-deploy-dev');
assert.equal(output.split('\n').filter(Boolean).length, jobSettingNames.length);
assert.throws(() => validateJobSettings(settings, 'future-deploy-stage'));
assert.throws(() => validateJobSettings({ 'future-deploy-stage': configuration }, 'future-deploy-stage'));
for (const change of [
  value => { value.PATH = '/untrusted/bin'; },
  value => { delete value.TF_APPROVERS; },
  value => { value.TF_VAR_ssh_public_key = 'synthetic\nTF_DEPLOYMENT_ENABLED=false'; },
  value => { value.TF_DEPLOYMENT_ENABLED = 'false'; },
  value => { value.TF_YC_APPLY_SERVICE_ACCOUNT_ID = value.TF_YC_PLAN_SERVICE_ACCOUNT_ID; },
]) {
  const changed = structuredClone(configuration);
  change(changed);
  assert.throws(() => validateJobSettings({ 'future-deploy-dev': changed }, 'future-deploy-dev'));
}
const release = { ...configuration, TF_ENVIRONMENT: 'stage', TF_PLAN_INTENT: 'release-stage-compute', TF_RELEASE_VM_ID: 'v'.repeat(20), TF_RELEASE_BOOT_DISK_ID: 'b'.repeat(20), TF_RELEASE_DATA_DISK_ID: 'd'.repeat(20) };
assert.equal(validateJobSettings({ 'future-release-stage': release }, 'future-release-stage').trim().split('\n').length, releaseSettingNames.length);
assert.throws(() => validateJobSettings({ 'future-deploy-stage': release }, 'future-deploy-stage'));
assert.throws(() => validateJobSettings({ 'future-release-stage': { ...release, TF_ENVIRONMENT: 'prod' } }, 'future-release-stage'));
const prod = { ...configuration, TF_ENVIRONMENT: 'prod', TF_VAR_existing_network_id: 'n'.repeat(20) };
validateJobSettings({ 'future-deploy-prod': prod }, 'future-deploy-prod');
assert.throws(() => validateJobSettings({ 'future-deploy-dev': { ...prod, TF_ENVIRONMENT: 'dev' } }, 'future-deploy-dev'));
console.log('PASS: fixed job/environment, exact whitelist, no line injection, distinct Compute identities, scoped release and prod network reuse. Synthetic data only.');
