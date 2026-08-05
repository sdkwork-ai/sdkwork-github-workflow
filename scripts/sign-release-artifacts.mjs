#!/usr/bin/env node

// Signs release artifacts for one SDKWork application package.
//
// Usage:
//   node sign-release-artifacts.mjs --app <app-id> [--package-id <package-id>] [--glob <glob>]
//
// Requires SDKWORK_RELEASE_SIGNING_KEY_FILE pointing at a PEM private key. Every matched
// artifact gets `<artifact>.sha256` and `<artifact>.sig` sidecars. The script fails closed
// (non-zero exit) when the key is missing or any artifact cannot be signed, so a release
// can never ship unsigned artifacts silently.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const args = process.argv.slice(2);
function optionValue(name, fallback = null) {
  const index = args.indexOf(name);
  if (index === -1 || index + 1 >= args.length) {
    return fallback;
  }
  return args[index + 1];
}

const appId = optionValue('--app');
if (!appId) {
  console.error('sign-release-artifacts: --app <app-id> is required');
  process.exit(2);
}
const packageId = optionValue('--package-id');
const globPattern = optionValue('--glob');

function sha256Hex(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function isSidecar(name) {
  return name.endsWith('.sig') || name.endsWith('.sha256') || name.endsWith('.sbom.json');
}

function collectArtifacts(rootDir) {
  const artifacts = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && !isSidecar(entry.name)) {
        artifacts.push(full);
      }
    }
  };
  walk(rootDir);
  return artifacts;
}

const keyFile = process.env.SDKWORK_RELEASE_SIGNING_KEY_FILE;
if (!keyFile || !existsSync(keyFile)) {
  console.error('sign-release-artifacts: SDKWORK_RELEASE_SIGNING_KEY_FILE is not set or missing; refusing to sign');
  process.exit(1);
}

let artifacts = [];
if (globPattern) {
  // Minimal glob support: `**` matches any depth, `*` matches file names within a path.
  const [base, ...tailParts] = globPattern.split('/');
  const patternTail = tailParts.join('/');
  const filter = new RegExp(
    '^' +
      patternTail
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '__DOUBLE_STAR__')
        .replace(/\*/g, '[^/]*')
        .replace(/__DOUBLE_STAR__/g, '.*') +
      '$',
  );
  const walk = (dir, depth) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && (patternTail.includes('**') || depth < patternTail.split('/').length)) {
        walk(full, depth + 1);
      } else if (entry.isFile() && !isSidecar(entry.name)) {
        const relative = path.relative(base, full).replace(/\\/g, '/');
        if (filter.test(relative)) {
          artifacts.push(full);
        }
      }
    }
  };
  walk(base, 0);
} else {
  // Default: everything under target/release and the browser dist folder.
  const candidates = [
    path.join(process.cwd(), 'target', 'release'),
    path.join(process.cwd(), 'apps', 'sdkwork-knowledgebase-pc', 'dist'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      artifacts.push(...collectArtifacts(candidate));
    }
  }
}

if (artifacts.length === 0) {
  console.error(`sign-release-artifacts: no artifacts matched for app=${appId} package=${packageId ?? 'all'}`);
  process.exit(1);
}

let signed = 0;
for (const artifact of artifacts) {
  const digest = sha256Hex(artifact);
  const checksumPath = `${artifact}.sha256`;
  writeFileSync(checksumPath, `${digest}  ${path.basename(artifact)}\n`);
  const signaturePath = `${artifact}.sig`;
  try {
    execFileSync(
      'openssl',
      ['dgst', '-sha256', '-sign', keyFile, '-out', signaturePath, artifact],
      { stdio: 'pipe' },
    );
  } catch (error) {
    console.error(`sign-release-artifacts: openssl signing failed for ${artifact}: ${error.message}`);
    process.exit(1);
  }
  console.log(`signed ${path.relative(process.cwd(), artifact)} (sha256 ${digest.slice(0, 12)}...)`);
  signed += 1;
}

console.log(`sign-release-artifacts: ${signed} artifact(s) signed for ${appId}`);
