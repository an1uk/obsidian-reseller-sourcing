import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import stylelint from 'stylelint';
import { ESLint } from 'eslint';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('production lint keeps every reported type-safety and blocking host rule enabled', async () => {
  const config = await new ESLint({ cwd: project }).calculateConfigForFile(path.join(project, 'src/storage/store.ts'));
  for (const name of [
    '@typescript-eslint/no-unsafe-assignment', '@typescript-eslint/no-unsafe-argument', '@typescript-eslint/no-unsafe-call',
    '@typescript-eslint/no-unsafe-member-access', '@typescript-eslint/no-unsafe-return', '@typescript-eslint/no-unnecessary-type-assertion',
    '@typescript-eslint/no-floating-promises', '@typescript-eslint/unbound-method',
    'obsidianmd/no-static-styles-assignment', 'obsidianmd/settings-tab/no-problematic-settings-headings', 'no-control-regex',
  ]) {
    const value = config.rules[name];
    assert.equal(Array.isArray(value) ? value[0] : value, 2, name);
  }
});

test('CSS config resolves the complete official Obsidian rule set without overrides', async () => {
  const file = path.join(project, 'map.css');
  const effective = await stylelint.resolveConfig(file, { cwd: project });
  const official = await stylelint.resolveConfig(file, { cwd: project, config: { extends: ['stylelint-config-obsidianmd'] } });
  assert.ok(effective?.rules); assert.ok(official?.rules);
  assert.ok(Object.keys(effective.rules).length > 50, 'Inherited standard rules must remain enabled');
  assert.deepEqual(effective.rules, official.rules);
  for (const name of ['declaration-no-important', 'selector-pseudo-class-disallowed-list', 'declaration-block-no-duplicate-properties', 'plugin/no-unsupported-browser-features']) assert.ok(effective.rules[name], name);
});
