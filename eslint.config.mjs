import { defineConfig } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';
import json from '@eslint/json';
import { DEFAULT_BRANDS } from 'eslint-plugin-obsidianmd/dist/lib/rules/ui/brands.js';
import { DEFAULT_ACRONYMS } from 'eslint-plugin-obsidianmd/dist/lib/rules/ui/acronyms.js';

export default defineConfig([
  // Review production code and metadata; test doubles and build tools are not host code.
  { ignores: ['**/*', '!src/', '!src/**', '!package.json', '!manifest.json', 'src/map/adapt-upstream.mjs'] },
  ...obsidianmd.configs.recommended,
  {
    files: ['manifest.json'],
    plugins: { json, obsidianmd },
    language: 'json/json',
    // ESLint's JavaScript whitespace rule does not accept JSONSourceCode.
    rules: { 'no-irregular-whitespace': 'off', 'obsidianmd/validate-manifest': 'error' },
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      'obsidianmd/ui/sentence-case': ['warn', {
        enforceCamelCaseLower: true,
        brands: [...DEFAULT_BRANDS, 'Google Maps', 'Web Clipper', 'Chrome', 'OpenFreeMap', 'OpenStreetMap', 'OpenMapTiles', 'MapLibre GL JS', 'Obsidian Maps', 'Reseller sourcing'],
        acronyms: [...DEFAULT_ACRONYMS, 'MIT', 'ICU', 'ISC'],
      }],
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/unbound-method': 'error',
    },
  },
]);
