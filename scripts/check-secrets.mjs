import { execFileSync } from 'node:child_process';
import { findSecretKinds, forbiddenPath } from './secret-patterns.mjs';

// Read Git's index, not the working directory, so this checks precisely what
// would be committed. Never log a matched value or inspect .local credentials.
const git = (...args) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
try {
  const files = git('ls-files', '-z').split('\0').filter(Boolean);
  const failures = [];
  for (const file of files) {
    if (forbiddenPath(file)) {
      failures.push(`${file}: private or generated path`);
      continue;
    }
    const kinds = findSecretKinds(git('show', `:${file}`));
    if (kinds.length) failures.push(`${file}: ${kinds.join(', ')}`);
  }
  if (failures.length) {
    console.error(
      `Commit blocked. Remove credentials or private files from the index:\n${failures.join('\n')}`,
    );
    process.exitCode = 1;
  } else
    console.log(
      `Secret scan passed for ${files.length} indexed files. Matched values are never printed.`,
    );
} catch {
  console.error(
    'Could not inspect the Git index. Run this check inside the repository.',
  );
  process.exitCode = 1;
}
