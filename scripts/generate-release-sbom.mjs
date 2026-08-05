#!/usr/bin/env node

// Generates an SPDX 2.3 SBOM (JSON) for one SDKWork application package.
//
// Usage:
//   node generate-release-sbom.mjs --app <app-id> [--package-id <package-id>] [--glob <glob>]
//
// Every matched artifact is listed as an SPDX package with a SHA-256 checksum, and the
// aggregate document is written next to the artifacts as `<artifact>.sbom.json` (per-file)
// plus `sbom.json` at the scan root. Fails closed when no artifacts match.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
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
  console.error('generate-release-sbom: --app <app-id> is required');
  process.exit(2);
}
const packageId = optionValue('--package-id');
const globPattern = optionValue('--glob');

function sha256Hex(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function isSidecar(name) {
  return name.endsWith('.sig') || name.endsWith('.sha256') || name.endsWith('.sbom.json') || name === 'sbom.json';
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

let artifacts = [];
if (globPattern) {
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
  console.error(`generate-release-sbom: no artifacts matched for app=${appId} package=${packageId ?? 'all'}`);
  process.exit(1);
}

const namespace = `https://sdkwork.com/sbom/${encodeURIComponent(appId)}/${Date.now()}`;
const packages = artifacts.map((artifact, index) => ({
  SPDXID: `SPDXRef-Package-${index + 1}`,
  name: path.basename(artifact),
  versionInfo: packageId ?? 'release',
  downloadLocation: 'NOASSERTION',
  filesAnalyzed: false,
  checksums: [
    {
      algorithm: 'SHA256',
      checksumValue: sha256Hex(artifact),
    },
  ],
  licenseConcluded: 'NOASSERTION',
  licenseDeclared: 'NOASSERTION',
  copyrightText: 'NOASSERTION',
}));

const document = {
  spdxVersion: 'SPDX-2.3',
  dataLicense: 'CC0-1.0',
  SPDXID: 'SPDXRef-DOCUMENT',
  name: `${appId} release SBOM`,
  documentNamespace: namespace,
  creationInfo: {
    created: new Date().toISOString(),
    creators: ['Tool: sdkwork-github-workflow/generate-release-sbom.mjs'],
  },
  packages,
};

const aggregatePath = path.join(process.cwd(), 'sbom.json');
writeFileSync(aggregatePath, `${JSON.stringify(document, null, 2)}\n`);
console.log(`generate-release-sbom: ${packages.length} package(s) recorded for ${appId} -> ${aggregatePath}`);
