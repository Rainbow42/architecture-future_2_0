import assert from 'node:assert/strict';
import { jobSettingNames, validateJobSettings } from './job-settings.mjs';

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
console.log('PASS: fixed job/environment, exact settings whitelist, no line injection, distinct Compute identities. Synthetic data only.');
