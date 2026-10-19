import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { exchangeAuthorizedKey, readAuthorizedKey } from './iam-token.mjs';

try {
  const [operation, environment, ...extra] = process.argv.slice(2);
  assert(['plan', 'apply'].includes(operation) && ['dev', 'stage', 'prod'].includes(environment) && extra.length === 0);
  assert.equal(process.env.TF_DEPLOYMENT_ENABLED, 'true', 'Deployment is disabled');
  const identity = process.env[operation === 'plan' ? 'TF_YC_PLAN_SERVICE_ACCOUNT_ID' : 'TF_YC_APPLY_SERVICE_ACCOUNT_ID'];
  assert(process.env.TF_YC_PLAN_SERVICE_ACCOUNT_ID !== process.env.TF_YC_APPLY_SERVICE_ACCOUNT_ID, 'Plan and apply Compute identities must differ');
  const token = await exchangeAuthorizedKey(readAuthorizedKey(process.env.YC_AUTHORIZED_KEY_FILE), identity);
  const childEnvironment = { ...process.env, YC_TOKEN: token };
  delete childEnvironment.YC_AUTHORIZED_KEY_FILE;
  delete childEnvironment.YC_SERVICE_ACCOUNT_KEY_FILE;
  const child = spawn(process.execPath, [fileURLToPath(new URL('./pipeline.mjs', import.meta.url)), operation, environment], { env: childEnvironment, stdio: 'inherit' });
  process.exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => resolve(code ?? 1));
  });
} catch (error) {
  process.stderr.write(`Authenticated pipeline failed (${error.name ?? 'Error'}); no key, JWT or IAM response was published.\n`);
  process.exitCode = 1;
}
