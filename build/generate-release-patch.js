#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PATCH_ALLOWED_ROOTS = new Set(['public', 'desktop', 'build']);
const PATCH_ALLOWED_FILES = new Set(['server.js', 'dj-analyzer.js', 'package.json', 'package-lock.json']);
const PATCH_BLOCKED_EXT = /\.(exe|dll|node|msi|bat|cmd|ps1|pfx|pem|key)$/i;
const GIT_OUTPUT_MAX_BUFFER = 64 * 1024 * 1024;

function usage() {
  console.error('Usage: node build/generate-release-patch.js <from-ref> <to-ref> [output-dir]');
  process.exit(1);
}

function normalizeVersion(value) {
  return String(value || '').trim().replace(/^v/i, '');
}

function runGit(args) {
  return execFileSync('git', args, {
    cwd: path.resolve(__dirname, '..'),
    maxBuffer: GIT_OUTPUT_MAX_BUFFER
  });
}

function gitText(args) {
  return runGit(args).toString('utf8').trim();
}

function safePatchRelativePath(value) {
  const rel = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
  if (!rel || rel.includes('\0')) return '';
  const parts = rel.split('/').filter(Boolean);
  if (!parts.length || parts.some(part => part === '..' || part === '.')) return '';
  const root = parts[0];
  if (PATCH_ALLOWED_FILES.has(rel)) return rel;
  if (!PATCH_ALLOWED_ROOTS.has(root)) return '';
  if (PATCH_BLOCKED_EXT.test(rel)) return '';
  return parts.join('/');
}

function fileExistsAtRef(ref, rel) {
  try {
    runGit(['cat-file', '-e', `${ref}:${rel}`]);
    return true;
  } catch (error) {
    return false;
  }
}

function readFileAtRef(ref, rel) {
  return runGit(['show', `${ref}:${rel}`]);
}

function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function changedPatchFiles(fromRef, toRef) {
  const output = gitText(['diff', '--name-only', fromRef, toRef, '--']);
  return output
    .split(/\r?\n/)
    .map(safePatchRelativePath)
    .filter(Boolean)
    .filter((rel, index, list) => list.indexOf(rel) === index)
    .filter(rel => fileExistsAtRef(toRef, rel));
}

function buildPatch(fromRef, toRef) {
  const from = normalizeVersion(fromRef);
  const to = normalizeVersion(toRef);
  if (!from || !to) usage();
  const files = changedPatchFiles(fromRef, toRef).map(rel => {
    const content = readFileAtRef(toRef, rel);
    return {
      path: rel,
      encoding: 'base64',
      sha256: sha256Hex(content),
      contentBase64: content.toString('base64')
    };
  });
  if (!files.length) throw new Error('No patchable files changed between refs');
  return {
    type: 'mineradio-resource-patch',
    from,
    to,
    restartRequired: true,
    files
  };
}

function main() {
  const fromRef = process.argv[2];
  const toRef = process.argv[3];
  const outputDir = process.argv[4] || 'dist';
  if (!fromRef || !toRef) usage();

  const patch = buildPatch(fromRef, toRef);
  const outDir = path.resolve(__dirname, '..', outputDir);
  fs.mkdirSync(outDir, { recursive: true });
  const fileName = `Mineradio-${patch.from}-to-${patch.to}.patch.json`;
  const outPath = path.join(outDir, fileName);
  fs.writeFileSync(outPath, JSON.stringify(patch), 'utf8');
  console.log(outPath);
  console.log(`files=${patch.files.length}`);
}

main();
