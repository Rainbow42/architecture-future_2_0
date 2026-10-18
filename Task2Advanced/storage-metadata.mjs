import assert from 'node:assert/strict';

export function verifyStorageMetadata(settings, metadata) {
  assert.equal(metadata.versioning.Status, 'Enabled', 'Backend bucket versioning must be enabled');
  const rules = metadata.encryption.ServerSideEncryptionConfiguration?.Rules ?? [];
  assert.equal(rules.length, 1, 'Expected one default bucket encryption rule');
  const encryption = rules[0].ApplyServerSideEncryptionByDefault;
  assert(encryption, 'Default bucket encryption is missing');
  if (settings.mode === 'bucket-kms') {
    assert.equal(encryption.SSEAlgorithm, 'aws:kms', 'Backend must enforce default KMS encryption');
    assert.equal(encryption.KMSMasterKeyID, settings.keyId, 'Unexpected backend KMS key');
  } else {
    assert.equal(encryption.SSEAlgorithm, 'AES256', 'Backend must enforce default SSE-S3 encryption');
  }
  for (const grant of metadata.acl.Grants ?? []) {
    assert(!grant.Grantee?.URI, 'Group ACL grants are not allowed on the backend bucket');
  }
  const policy = JSON.parse(metadata.policy.Policy);
  const statements = Array.isArray(policy.Statement) ? policy.Statement : [policy.Statement];
  for (const statement of statements.filter(item => item.Effect === 'Allow')) {
    const principal = statement.Principal;
    assert(principal && principal !== '*', 'Anonymous or unspecified Allow principal is not allowed');
    const values = typeof principal === 'string' ? [principal] : Object.values(principal).flat();
    assert(values.length > 0 && values.every(value => typeof value === 'string' && !value.includes('*')), 'Wildcard Allow principals are not allowed');
  }
  const deniesHttp = statements.some(statement => {
    const resources = [statement.Resource].flat();
    const actions = [statement.Action].flat();
    const conditions = statement.Condition ?? {};
    const booleanConditions = conditions.Bool ?? {};
    const transport = Object.entries(booleanConditions).find(([key]) => key.toLowerCase() === 'aws:securetransport');
    return statement.Effect === 'Deny' && statement.Principal === '*'
      && Object.keys(conditions).length === 1 && Object.keys(booleanConditions).length === 1
      && transport && ['false', false].includes(transport[1])
      && actions.some(action => action === '*' || action === 's3:*')
      && resources.includes(`arn:aws:s3:::${settings.bucket}`)
      && resources.includes(`arn:aws:s3:::${settings.bucket}/*`);
  });
  assert(deniesHttp, 'Backend policy must deny insecure transport for bucket and objects');
  return { encryption: encryption.SSEAlgorithm, versioning: 'Enabled', anonymousAccess: false, insecureTransport: false };
}
