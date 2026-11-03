#!/usr/bin/env node

/**
 * Release preflight for the SDKWork GitHub workflow framework.
 *
 * Fails before packaging/deployment when a test, staging, demo, or production
 * profile has no valid public application access token. The standalone copy is
 * used by reusable workflows after checking out only this framework repository.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_RELEASE_ENVIRONMENTS = ['test', 'staging', 'demo', 'production'];
const PROFILE_PATTERN = /^(?:standalone|cloud)\.(development|test|staging|demo|production)$/u;
const EXPECTED_HEADER = 'eyJhbGciOiJub25lIiwia2lkIjoicHVibGljLWFwcC10b2tlbiIsInR5cCI6IkpXVCJ9';

function parseArgs(argv) {
  const options = { root: process.cwd(), profiles: [], allowNoSurfaces: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--allow-no-surfaces') {
      options.allowNoSurfaces = true;
      continue;
    }
    if (token === '--root' || token === '--profiles') {
      const value = String(argv[index + 1] ?? '').trim();
      if (!value) throw new Error(`${token} requires a value.`);
      if (token === '--root') options.root = path.resolve(value);
      else options.profiles = value.split(',').map((profile) => profile.trim()).filter(Boolean);
      index += 1;
      continue;
    }
    throw new Error(`Unsupported release access token option: ${token}`);
  }
  return options;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8').replace(/^\uFEFF/u, ''));
}

function readToken(filePath) {
  const text = readFileSync(filePath, 'utf8');
  const jsonMatch = /"SDKWORK_ACCESS_TOKEN"\s*:\s*"([^"]+)"/u.exec(text);
  if (jsonMatch) return jsonMatch[1].trim();
  const envMatch = /^SDKWORK_ACCESS_TOKEN=(.*)$/mu.exec(text);
  return envMatch ? envMatch[1].trim().replace(/^["']|["']$/gu, '') : '';
}

function assertToken(token, expected) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('token is not a JWT compact value');
  if (parts[0] !== EXPECTED_HEADER) throw new Error('token header is not the public application header');
  if (parts[2] !== 'public') throw new Error('token signature segment is not public');
  let claims;
  try {
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    throw new Error('token claims are not valid JSON');
  }
  if (claims.token_class !== 'application') throw new Error('token_class must be application');
  if (claims.token_type !== 'access') throw new Error('token_type must be access');
  if (claims.iss !== 'sdkwork-iam-public') throw new Error('iss must be sdkwork-iam-public');
  if (expected.environment && claims.environment !== expected.environment) {
    throw new Error(`environment claim ${claims.environment} does not match ${expected.environment}`);
  }
  if (expected.deploymentProfile && claims.deployment_profile !== expected.deploymentProfile) {
    throw new Error(`deployment_profile claim ${claims.deployment_profile} does not match ${expected.deploymentProfile}`);
  }
  if (expected.appId && claims.app_id !== expected.appId) {
    throw new Error(`app_id claim ${claims.app_id} does not match ${expected.appId}`);
  }
}

function formatFromManifest(manifest) {
  const framework = String(manifest?.runtime?.framework ?? '').trim();
  if (framework === 'flutter') return 'flutter';
  if (framework === 'harmony-native' || framework === 'android-native' || framework === 'ios-native') return 'native';
  if (framework.startsWith('mp-') || framework.includes('mini-program') || framework === 'multi-mini-program') {
    return 'mini-program';
  }
  return 'vite';
}

function profilePath(appRoot, format, profileId) {
  if (format === 'flutter') return path.join(appRoot, 'env', `sdkwork.${profileId}.json`);
  if (format === 'mini-program') return path.join(appRoot, 'config', 'mini-program', `runtime-env.${profileId}.json`);
  if (format === 'native' || format === 'harmony-native') {
    return path.join(appRoot, 'config', 'app', `runtime-env.${profileId}.json`);
  }
  return path.join(appRoot, `.env.${profileId}`);
}

function readSurfaces(root) {
  const configPath = path.join(root, 'etc', 'client-env.materialization.json');
  if (existsSync(configPath)) {
    return readJson(configPath).surfaces ?? [];
  }
  // Fallback for repositories that have app manifests but no materialization config.
  const appsDir = path.join(root, 'apps');
  if (!existsSync(appsDir)) return [];
  return readdirSync(appsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => existsSync(path.join(appsDir, entry.name, 'agent.app.config.json')))
    .map((entry) => ({
      id: entry.name,
      root: `apps/${entry.name}`,
      format: formatFromManifest(readJson(path.join(appsDir, entry.name, 'agent.app.config.json'))),
    }));
}

export function checkReleaseAccessTokenEnv(rootDir, { environments = DEFAULT_RELEASE_ENVIRONMENTS, allowNoSurfaces = false } = {}) {
  const root = path.resolve(rootDir);
  const deploymentPath = path.join(root, 'etc', 'sdkwork.deployment.config.json');
  if (!existsSync(deploymentPath)) {
    return { root, checked: [], failures: [{ profileId: '<config>', reason: 'etc/sdkwork.deployment.config.json is missing' }] };
  }
  const declared = Object.keys(readJson(deploymentPath).profiles ?? {});
  const releaseProfiles = declared.filter((profileId) => {
    const match = PROFILE_PATTERN.exec(profileId);
    return match && environments.includes(match[1]);
  });
  const surfaces = readSurfaces(root);
  if (surfaces.length === 0) {
    return allowNoSurfaces
      ? { root, checked: [], failures: [], skipped: true }
      : { root, checked: [], failures: [{ profileId: '<surfaces>', reason: 'no client surface declares an access token' }] };
  }
  const clientSurfaces = surfaces.filter((surface) => surface.format !== 'none');
  if (clientSurfaces.length === 0) {
    return { root, checked: [], failures: [], skipped: true };
  }
  const checked = [];
  const failures = [];
  for (const surface of clientSurfaces) {
    if (surface.format === 'none') continue;
    const appRoot = path.join(root, String(surface.root ?? ''));
    const manifestPath = path.join(appRoot, 'agent.app.config.json');
    const manifest = existsSync(manifestPath) ? readJson(manifestPath) : null;
    const format = surface.format === 'auto' || !surface.format
      ? formatFromManifest(manifest)
      : surface.format;
    const excluded = new Set(surface.excludeProfiles ?? []);
    for (const profileId of releaseProfiles) {
      const filePath = profilePath(appRoot, format, profileId);
      if (excluded.has(profileId) && !existsSync(filePath)) {
        continue;
      }
      if (!existsSync(filePath)) {
        failures.push({ profileId: `${surface.id}/${profileId}`, reason: `missing ${path.relative(root, filePath).replaceAll('\\', '/')}` });
        continue;
      }
      const token = readToken(filePath);
      if (!token) {
        failures.push({ profileId: `${surface.id}/${profileId}`, reason: 'SDKWORK_ACCESS_TOKEN is missing or empty' });
        continue;
      }
      const appId = surface.accessToken?.appId ?? manifest?.backend?.appId ?? manifest?.app?.key;
      try {
        assertToken(token, {
          environment: profileId.split('.')[1],
          deploymentProfile: profileId.split('.')[0],
          ...(appId ? { appId } : {}),
        });
        checked.push(`${surface.id}/${profileId}`);
      } catch (error) {
        failures.push({ profileId: `${surface.id}/${profileId}`, reason: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  return { root, checked, failures };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const environments = options.profiles.length > 0
    ? options.profiles.map((profile) => profile.split('.').pop())
    : DEFAULT_RELEASE_ENVIRONMENTS;
  const result = checkReleaseAccessTokenEnv(options.root, { environments, allowNoSurfaces: options.allowNoSurfaces });
  if (result.failures.length === 0) {
    console.log(result.skipped
      ? 'release access-token preflight skipped: no client surface'
      : `release access-token preflight passed: ${result.checked.length} surface/profile pair(s)`);
    return;
  }
  console.error('release access-token preflight failed:');
  for (const failure of result.failures) {
    console.error(`  - ${failure.profileId}: ${failure.reason}`);
  }
  console.error('Configure a valid public application access token in every release profile before building or deploying.');
  process.exitCode = 1;
}

main();
