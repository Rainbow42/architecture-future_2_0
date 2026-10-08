import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { backendConfig, backendHcl, digest, executionContext, required, summarizePlan, terraformVersion, verifyPlan } from './lib.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [operation, environment] = process.argv.slice(2);

try {
  assert(['plan', 'apply'].includes(operation), 'Use plan|apply dev|stage|prod');
  process.umask(0o077);
  const variables = process.env;
  assert.equal(variables.TF_DEPLOYMENT_ENABLED, 'true', 'Deployment is disabled');
  assert.equal(variables.TF_WORKSPACE ?? 'default', 'default', 'Only the default workspace is supported');
  for (const name of Object.keys(variables)) {
    assert(!name.startsWith('TF_CLI_ARGS') && !name.startsWith('TF_LOG'), 'Remove ambient Terraform arguments/log settings');
  }
  const backend = backendConfig(environment, variables);
  const context = executionContext(environment, variables, backend);
  for (const name of ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'YC_TOKEN']) required(variables, name);
  const store = required(variables, 'TF_PLAN_DIRECTORY');
  assert(path.isAbsolute(store) && path.resolve(store) !== '/' && path.resolve(store) !== repository, 'Use a dedicated absolute plan directory outside the checkout');
  assert(!path.resolve(store).startsWith(`${repository}${path.sep}`), 'Do not store sensitive plans in the checkout');
  function checkPrivateDirectory(directory) {
    const stat = lstatSync(directory);
    assert(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === process.getuid() && (stat.mode & 0o077) === 0, 'Plan directory must be owned by the runner and have mode 0700');
  }
  checkPrivateDirectory(store);
  const recoveryGuard = path.join(store, `${environment}.recovery-required.json`);
  assert(!existsSync(recoveryGuard), 'A previous apply needs state reconciliation; inspect the private runner before starting a new run');
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(), context.revision, 'Checkout must match the run commit');
  assert.equal(execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: repository, encoding: 'utf8' }).trim(), '', 'Tracked files must be clean');
  const runDirectory = path.join(store, `${context.runId}-${context.attempt}-${environment}`);
  const snapshot = path.join(runDirectory, 'source');
  const configDirectory = path.join(snapshot, 'Task1Advanced/envs', environment);
  const savedPlan = path.join(runDirectory, 'approved.tfplan');
  const manifest = path.join(runDirectory, 'manifest.json');
  const backendFile = path.join(runDirectory, 'backend.local.hcl');
  if (operation === 'plan') {
    mkdirSync(runDirectory, { mode: 0o700 });
    mkdirSync(snapshot, { mode: 0o700 });
    const archive = execFileSync('git', ['archive', context.revision, 'Task1Advanced'], { cwd: repository, maxBuffer: 16 * 1024 * 1024 });
    execFileSync('tar', ['-xf', '-', '-C', snapshot], { input: archive });
    writeFileSync(backendFile, backendHcl(backend), { mode: 0o600, flag: 'wx' });
  } else {
    checkPrivateDirectory(runDirectory);
    assert(!existsSync(path.join(runDirectory, 'apply-started.json')), 'Apply already started for this plan; reconcile the state and create a new plan');
    verifyPlan(JSON.parse(readFileSync(manifest, 'utf8')), context, readFileSync(savedPlan));
    assert.equal(readFileSync(backendFile, 'utf8'), backendHcl(backend), 'Stored backend differs');
  }
  const commandEnvironment = { ...variables, TF_DATA_DIR: path.join(runDirectory, 'data'), TF_WORKSPACE: 'default', TF_IN_AUTOMATION: 'true' };
  function terraform(...args) {
    try {
      return execFileSync('terraform', [`-chdir=${configDirectory}`, ...args], {
        env: commandEnvironment, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      writeFileSync(path.join(runDirectory, `${operation}-failure.private.log`), `${error.stdout?.toString() ?? ''}\n${error.stderr?.toString() ?? ''}`, { mode: 0o600 });
      throw new Error(`Terraform ${args[0]} failed. Inspect ${runDirectory} privately before retrying; it may contain errored.tfstate. No raw logs or state were published.`);
    }
  }
  assert.equal(JSON.parse(terraform('version', '-json')).terraform_version, terraformVersion, 'Unexpected Terraform version');
  terraform('init', '-input=false', '-reconfigure', '-lockfile=readonly', `-backend-config=${backendFile}`);
  terraform('validate', '-no-color');
  if (operation === 'plan') {
    terraform('plan', '-input=false', '-no-color', '-lock-timeout=60s', `-var-file=${environment}.tfvars`, `-out=${savedPlan}`);
    writeFileSync(path.join(runDirectory, 'plan.private.txt'), terraform('show', '-no-color', savedPlan), { mode: 0o600, flag: 'wx' });
    const summary = summarizePlan(JSON.parse(terraform('show', '-json', savedPlan)));
    const metadata = { context, createdAt: Date.now(), sha256: digest(readFileSync(savedPlan)) };
    writeFileSync(manifest, JSON.stringify(metadata, null, 2), { mode: 0o600, flag: 'wx' });
    const message = `Plan: ${environment}\nCommit: ${context.revision}\nSHA256: ${metadata.sha256}\nCounts: ${JSON.stringify(summary)}\nPrivate plan on the dedicated runner: ${runDirectory}/plan.private.txt\nReview the complete plan before approving apply. Counts alone are not a review.\n`;
    process.stdout.write(message);
  } else {
    const metadata = JSON.parse(readFileSync(manifest, 'utf8'));
    verifyPlan(metadata, context, readFileSync(savedPlan));
    writeFileSync(path.join(runDirectory, 'apply-started.json'), JSON.stringify({ sha256: metadata.sha256 }), { mode: 0o600, flag: 'wx' });
    writeFileSync(recoveryGuard, JSON.stringify({ runDirectory, sha256: metadata.sha256 }), { mode: 0o600, flag: 'wx' });
    terraform('apply', '-input=false', '-no-color', '-lock-timeout=60s', savedPlan);
    writeFileSync(path.join(runDirectory, 'apply-completed.json'), JSON.stringify({ sha256: metadata.sha256 }), { mode: 0o600, flag: 'wx' });
    unlinkSync(recoveryGuard);
    process.stdout.write(`Applied saved plan ${metadata.sha256} for ${environment}.\n`);
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
