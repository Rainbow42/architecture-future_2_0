import assert from 'node:assert/strict';
import { planIntent, releaseAddresses, verifyReleasePlan } from './release-scope.mjs';

const variables = { JOB_BASE_NAME: 'future-release-stage', TF_PLAN_INTENT: 'release-stage-compute', TF_RELEASE_VM_ID: 'v'.repeat(20), TF_RELEASE_BOOT_DISK_ID: 'b'.repeat(20), TF_RELEASE_DATA_DISK_ID: 'd'.repeat(20) };
const intent = planIntent('stage', variables);
const plan = { resource_changes: [
  { address: releaseAddresses[0], change: { actions: ['delete'], before: { id: intent.targets.VM, folder_id: 'training-folder', zone: 'ru-central1-d', boot_disk: [{ disk_id: intent.targets.BOOT_DISK, auto_delete: true }], secondary_disk: [{ disk_id: intent.targets.DATA_DISK, auto_delete: false }] } } },
  { address: releaseAddresses[1], change: { actions: ['delete'], before: { id: intent.targets.DATA_DISK, folder_id: 'training-folder', zone: 'ru-central1-d' } } },
] };
verifyReleasePlan(plan, intent, 'training-folder');
assert.deepEqual(planIntent('dev', {}), { kind: 'deploy' });
assert.throws(() => planIntent('prod', variables));
assert.throws(() => planIntent('stage', { ...variables, JOB_BASE_NAME: 'future-deploy-stage' }));
assert.throws(() => planIntent('stage', { ...variables, TF_RELEASE_DATA_DISK_ID: variables.TF_RELEASE_BOOT_DISK_ID }));
for (const mutate of [
  p => p.resource_changes.push({ address: 'yandex_vpc_network.environment', change: { actions: ['delete'] } }),
  p => { p.resource_changes[0].change.actions = ['delete', 'create']; },
  p => { p.resource_changes[0].change.before.id = 'another-vm'; },
  p => { p.resource_changes[1].change.before.id = 'another-disk'; },
  p => { p.resource_changes[0].change.before.folder_id = 'another-folder'; },
  p => { p.resource_changes[1].change.before.zone = 'ru-central1-e'; },
  p => { p.resource_changes[0].change.before.boot_disk[0].disk_id = 'another-boot-disk'; },
  p => { p.resource_changes[0].change.before.boot_disk[0].auto_delete = false; },
  p => { p.resource_changes[0].change.before.secondary_disk.push({ disk_id: 'extra-disk' }); },
  p => { p.resource_changes = []; },
]) {
  const changed = structuredClone(plan);
  mutate(changed);
  assert.throws(() => verifyReleasePlan(changed, intent, 'training-folder'));
}
console.log('PASS: exact stage VM/boot/data scope, wrong identities and folders rejected, no network deletion, no replacement or additional disks. Synthetic data only.');
