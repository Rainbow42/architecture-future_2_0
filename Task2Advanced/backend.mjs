import { backendConfig, backendHcl } from './lib.mjs';

try {
  process.stdout.write(backendHcl(backendConfig(process.argv[2], process.env)));
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
