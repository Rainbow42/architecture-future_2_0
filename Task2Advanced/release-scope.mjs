import assert from 'node:assert/strict';

export const releaseAddresses = ['module.vm_module.yandex_compute_instance.vm', 'module.vm_module.yandex_compute_disk.data'];

export function planIntent(environment, variables) {
  const kind = variables.TF_PLAN_INTENT ?? 'deploy';
  if (kind === 'deploy') return { kind };
  assert.equal(kind, 'release-stage-compute', 'Unknown plan intent');
  assert.equal(environment, 'stage', 'Compute release is limited to stage');
  assert.equal(variables.JOB_BASE_NAME, 'future-release-stage', 'Use the fixed release job');
  const targets = Object.fromEntries(['VM', 'BOOT_DISK', 'DATA_DISK'].map(name => [name, variables[`TF_RELEASE_${name}_ID`]]));
  assert(Object.values(targets).every(value => typeof value === 'string' && /^[a-z0-9]{20}$/.test(value)), 'Release requires exact resource IDs');
  assert.equal(new Set(Object.values(targets)).size, 3, 'Release IDs must differ');
  return { kind, targets };
}

export function verifyReleasePlan(plan, intent, folderId) {
  assert.equal(intent.kind, 'release-stage-compute');
  const changes = (plan.resource_changes ?? []).filter(resource => resource.change.actions.join('/') !== 'no-op');
  assert.deepEqual(changes.map(resource => resource.address).sort(), [...releaseAddresses].sort(), 'Release must change only the VM and managed data disk');
  assert(changes.every(resource => resource.change.actions.join('/') === 'delete'), 'Release must not create, update or replace resources');
  const vm = changes.find(resource => resource.address === releaseAddresses[0]).change.before;
  const disk = changes.find(resource => resource.address === releaseAddresses[1]).change.before;
  assert.equal(vm.id, intent.targets.VM, 'Unexpected VM');
  assert.equal(disk.id, intent.targets.DATA_DISK, 'Unexpected data disk');
  assert.equal(vm.folder_id, folderId, 'Unexpected VM folder');
  assert.equal(disk.folder_id, folderId, 'Unexpected disk folder');
  assert.equal(vm.zone, 'ru-central1-d');
  assert.equal(disk.zone, 'ru-central1-d');
  assert.equal(vm.boot_disk.length, 1);
  assert.equal(vm.boot_disk[0].disk_id, intent.targets.BOOT_DISK, 'Unexpected boot disk');
  assert.equal(vm.boot_disk[0].auto_delete, true, 'Boot disk must be removed with this VM');
  assert.equal(vm.secondary_disk.length, 1, 'Unexpected additional attached disks');
  assert.equal(vm.secondary_disk[0].disk_id, intent.targets.DATA_DISK);
  assert.equal(vm.secondary_disk[0].auto_delete, false);
}
