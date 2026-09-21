import {
  constants,
  mkdirSync,
  lstatSync,
  openSync,
  fstatSync,
  fchmodSync,
  readFileSync,
  writeFileSync,
  fsyncSync,
  closeSync,
  renameSync,
  unlinkSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

const MAX_STATE_BYTES = 1024 * 1024;

/** Private, atomic POSIX file storage. Never follow a credential-file symlink. */
export function createStateStore(dataDir) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const directory = lstatSync(dataDir);
  if (!directory.isDirectory() || directory.isSymbolicLink()) {
    throw new Error(
      'Local data directory must be a real directory, not a link.',
    );
  }
  const owner = typeof process.getuid === 'function' ? process.getuid() : null;
  function checkOwner(info) {
    if (owner !== null && info.uid !== owner)
      throw new Error('Local data must belong to the current user.');
  }
  checkOwner(directory);
  const directoryFd = openSync(
    dataDir,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    fchmodSync(directoryFd, 0o700);
  } finally {
    closeSync(directoryFd);
  }
  const file = resolve(dataDir, 'state.json');

  function checkFile(info) {
    checkOwner(info);
    if (!info.isFile() || info.nlink !== 1)
      throw new Error('Local state must be a regular file with no links.');
  }
  function load(fallback) {
    let fd;
    try {
      fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
      const info = fstatSync(fd);
      checkFile(info);
      if (info.size > MAX_STATE_BYTES)
        throw new Error('Local state exceeds the size limit.');
      fchmodSync(fd, 0o600);
      const saved = JSON.parse(readFileSync(fd, 'utf8'));
      if (
        !saved ||
        typeof saved !== 'object' ||
        Array.isArray(saved) ||
        !saved.settings ||
        typeof saved.settings !== 'object' ||
        !Array.isArray(saved.settings.rules) ||
        !Array.isArray(saved.history) ||
        !saved.spotify ||
        typeof saved.spotify !== 'object'
      ) {
        throw new Error('Local state has an invalid structure.');
      }
      return {
        ...fallback,
        ...saved,
        settings: { ...fallback.settings, ...saved.settings },
      };
    } catch (error) {
      if (error.code === 'ENOENT') return fallback;
      // Do not include JSON parser excerpts: they may contain access tokens.
      throw new Error(
        'Cannot safely read .local/state.json. Check ownership, links, or restore a valid backup.',
      );
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  }
  function save(state) {
    const data = JSON.stringify(state, null, 2);
    if (Buffer.byteLength(data) > MAX_STATE_BYTES)
      throw new Error('Local state exceeds the size limit.');
    try {
      checkFile(lstatSync(file));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    // Exclusive, unpredictable temporary file: an existing path is never truncated.
    const temporary = resolve(
      dataDir,
      `.state-${randomBytes(16).toString('hex')}.tmp`,
    );
    let fd;
    try {
      fd = openSync(
        temporary,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600,
      );
      writeFileSync(fd, data);
      fsyncSync(fd);
      closeSync(fd);
      fd = undefined;
      renameSync(temporary, file);
    } finally {
      if (fd !== undefined) closeSync(fd);
      try {
        unlinkSync(temporary);
      } catch {
        // Best-effort cleanup must not hide the original write failure.
      }
    }
  }
  return { load, save };
}
