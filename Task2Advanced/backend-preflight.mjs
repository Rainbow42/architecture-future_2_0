import { S3Client, GetBucketAclCommand, GetBucketEncryptionCommand, GetBucketPolicyCommand, GetBucketVersioningCommand } from '@aws-sdk/client-s3';
import { backendConfig, encryptionSettings, required } from './lib.mjs';
import { verifyStorageMetadata } from './storage-metadata.mjs';

try {
  const variables = process.env;
  const configuration = backendConfig(process.argv[2], variables);
  const client = new S3Client({
    endpoint: configuration.endpoints.s3,
    region: configuration.region,
    forcePathStyle: true,
    maxAttempts: 2,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    credentials: {
      accessKeyId: required(variables, 'AWS_ACCESS_KEY_ID'),
      secretAccessKey: required(variables, 'AWS_SECRET_ACCESS_KEY'),
    },
  });
  try {
    const input = { Bucket: configuration.bucket };
    const [versioning, encryption, acl, policy] = await Promise.all([
      client.send(new GetBucketVersioningCommand(input)),
      client.send(new GetBucketEncryptionCommand(input)),
      client.send(new GetBucketAclCommand(input)),
      client.send(new GetBucketPolicyCommand(input)),
    ]);
    process.stdout.write(JSON.stringify(verifyStorageMetadata({ ...encryptionSettings(variables), bucket: configuration.bucket }, { versioning, encryption, acl, policy })) + '\n');
  } finally {
    client.destroy();
  }
} catch (error) {
  process.stderr.write(`Backend security preflight failed (${error.name ?? 'Error'}). Inspect private diagnostics; no raw response was published.\n`);
  process.exitCode = 1;
}
