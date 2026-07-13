import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const packageDir = new URL('../packages/hermes-marketing-agent-skills/', import.meta.url).pathname;
const installer = join(packageDir, 'install-hermes-marketing-skills.sh');
const manifestPath = join(packageDir, 'manifest.json');

test('package contains every declared skill with a SKILL.md file', () => {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

  assert.equal(manifest.skills.length, 15);
  assert.equal(new Set(manifest.skills).size, manifest.skills.length);

  for (const skill of manifest.skills) {
    assert.ok(existsSync(join(packageDir, 'skills', skill, 'SKILL.md')), `${skill} is missing SKILL.md`);
  }
});

test('installer supports dry runs and preserves existing skills in a backup', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'hermes-marketing-skills-test-'));
  const target = join(sandbox, 'marketing');
  const backupDir = join(sandbox, 'backups');

  try {
    const dryRun = execFileSync(installer, ['--dry-run', '--target', target, '--backup-dir', backupDir], { encoding: 'utf8' });
    assert.match(dryRun, /Dry run/);
    assert.equal(existsSync(target), false);

    execFileSync(installer, ['--target', target, '--backup-dir', backupDir], { encoding: 'utf8' });
    assert.equal(readdirSync(target).length, 15);

    execFileSync(installer, ['--target', target, '--backup-dir', backupDir], { encoding: 'utf8' });
    const backups = readdirSync(backupDir);
    assert.equal(backups.length, 1);
    assert.equal(readdirSync(join(backupDir, backups[0])).length, 15);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});
