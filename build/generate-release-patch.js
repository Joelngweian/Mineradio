#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PATCH_ALLOWED_ROOTS = new Set(['public', 'desktop', 'build', 'server']);
const PATCH_ALLOWED_FILES = new Set(['server.js', 'server-app.js', 'dj-analyzer.js', 'package.json', 'package-lock.json']);
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

function versionAtRef(ref) {
  const packageInfo = JSON.parse(readFileAtRef(ref, 'package.json').toString('utf8'));
  const version = normalizeVersion(packageInfo && packageInfo.version);
  if (!version) throw new Error(`Missing package version at ${ref}`);
  return version;
}

function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function changedPatchEntries(fromRef, toRef) {
  const output = gitText(['diff', '--name-status', '--no-renames', fromRef, toRef, '--']);
  const entries = [];
  output.split(/\r?\n/).forEach(line => {
    if (!line.trim()) return;
    const columns = line.split('\t');
    const status = String(columns.shift() || '').trim().toUpperCase();
    const rel = safePatchRelativePath(columns[0]);
    if (!rel || entries.some(entry => entry.path === rel)) return;
    if (status === 'D') {
      entries.push({ path: rel, action: 'delete' });
      return;
    }
    if (!fileExistsAtRef(toRef, rel)) return;
    entries.push({ path: rel, action: 'write' });
  });
  return entries;
}

function buildPatch(fromRef, toRef) {
  const from = versionAtRef(fromRef);
  const to = versionAtRef(toRef);
  const files = changedPatchEntries(fromRef, toRef).map(entry => {
    if (entry.action === 'delete') return entry;
    const content = readFileAtRef(toRef, entry.path);
    return {
      path: entry.path,
      action: 'write',
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
