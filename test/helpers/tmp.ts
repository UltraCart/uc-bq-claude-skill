/**
 * Temporary-directory helpers for tests that touch the filesystem.
 *
 * Modules like manifest/alarm-state read and write real files, so testing them
 * through fs mocks would mostly assert that the mock was written correctly.
 * These run against a real directory under the OS temp dir instead, and clean
 * up afterwards.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** Create an isolated temp directory. Caller is responsible for removal. */
export function makeTempDir(prefix = 'uc-bq-test-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * Run `fn` with a fresh temp directory, removing it afterwards even if `fn`
 * throws.
 */
export function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = makeTempDir();
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Write a file inside `dir`, creating parent directories as needed. */
export function writeFile(dir: string, relativePath: string, contents: string): string {
  const full = path.join(dir, relativePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents, 'utf-8');
  return full;
}

/**
 * Run `fn` with process.cwd() pointed at `dir`.
 *
 * Several modules resolve config and cache paths relative to the working
 * directory, so exercising them means actually changing it.
 */
export function withCwd<T>(dir: string, fn: () => T): T {
  const previous = process.cwd();
  process.chdir(dir);
  try {
    return fn();
  } finally {
    process.chdir(previous);
  }
}
