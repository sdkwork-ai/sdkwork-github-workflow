#!/usr/bin/env node

/**
 * Release preflight for the SDKWork GitHub workflow framework.
 *
 * Fail fast when a release/test/staging/demo/production deployment profile has
 * no valid public application access token. This is the standalone copy used by
 * reusable workflows after checking out only this framework repository; it is
 * vendored from `sdkwork-specs/tools/check-release-access-token-env.mjs` with
 * its helper modules (`app-access-token.mjs`, `app-access-token-anchor.mjs`,
 * `materialize-client-env.mjs`) inlined so no sibling checkout is required.
 *
 * Each surface resolves its own deployment anchor: the surface-scoped variable
 * in the process environment, the same variable recorded in the profile env
 * layer, then the repository-level variable (`APP_ACCESS_TOKEN_SPEC.md`
 * §3.1.1). A source checkout has no anchor yet, so verification reports the
 * pair as skipped; packaging passes `--require-anchor` when a deployment must
 * have materialized the anchor. It never reads a secret or prints a token.
 *
 * Usage:
 *   node scripts/check-release-access-token-env.mjs --root <repo>
 *   node scripts/check-release-access-token-env.mjs --root <repo> --profiles test,demo
 *   node scripts/check-release-access-token-env.mjs --root <repo> --surface <id>[,<id>]
 *   node scripts/check-release-access-token-env.mjs --root <repo> --require-anchor
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Public application access token primitives
// (vendored from sdkwork-specs/tools/app-access-token.mjs)
// ---------------------------------------------------------------------------

export const PUBLIC_APP_ACCESS_TOKEN_ISS = 'sdkwork-iam-public';
export const PUBLIC_APP_ACCESS_TOKEN_SIGNATURE = 'public';
export const PUBLIC_APP_ACCESS_TOKEN_CLASS = 'application';
export const PUBLIC_APP_ACCESS_TOKEN_VERSION = 1;

/**
 * Committed app id placeholder for a surface whose anchor is known only at
 * deployment (`APP_ACCESS_TOKEN_SPEC.md` §3.1.1).
 */
export const PUBLIC_APP_ACCESS_TOKEN_PENDING_APP_ID = '__SDKWORK_DEPLOY_APPLICATION_ID__';

export const APP_ACCESS_TOKEN_APP_ID_ENV_FIELD = 'appIdEnv';

const APP_ID_ENV_PLACEHOLDER_PATTERN = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/u;

/**
 * True when a token claim still carries the committed app id placeholder.
 * @param appId - token `app_id` or `aud` claim.
 * @param envName - declared anchor variable, when known.
 */
export function isApplicationAccessTokenPendingAppId(appId, envName = '') {
  const value = String(appId ?? '').trim();
  if (!value) {
    return false;
  }
  const name = String(envName ?? '').trim();
  return value === PUBLIC_APP_ACCESS_TOKEN_PENDING_APP_ID
    || (name ? value === `__${name}__` : false);
}

/**
 * Raised when an `appIdEnv`-sourced surface is materialized or verified without
 * the named environment variable.
 */
export class MissingAppIdEnvironmentError extends Error {
  constructor(envName) {
    super(
      `${envName} is not set: this surface takes its public application token app id from the `
      + 'deployment application anchor, so the generator must fail instead of falling back to a '
      + 'compiled-in app id',
    );
    this.name = 'MissingAppIdEnvironmentError';
    this.code = 'APP_ID_ENV_MISSING';
    this.envName = envName;
  }
}

/**
 * Classify a resolver failure as the "anchor unavailable" case.
 * @param error - thrown value.
 */
export function isMissingAppIdEnvironmentError(error) {
  return error instanceof MissingAppIdEnvironmentError;
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Env-name suffix that identifies one surface inside a deployment anchor name.
 * @param surfaceId - declared client surface id.
 */
export function surfaceAnchorEnvSuffix(surfaceId) {
  return String(surfaceId ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/gu, '_')
    .replace(/^_+/u, '')
    .replace(/_+$/u, '');
}

/**
 * Per-surface anchor variable derived from a declared anchor variable.
 * @param baseEnvName - the declared anchor variable (`accessToken.appIdEnv`).
 * @param surfaceId - declared client surface id.
 */
export function surfaceApplicationTokenEnvName(baseEnvName, surfaceId) {
  const base = String(baseEnvName ?? '').trim();
  const suffix = surfaceAnchorEnvSuffix(surfaceId);
  if (!base || !suffix) {
    return '';
  }
  return `${base}_${suffix}`;
}

/**
 * Environment variable a surface takes its deployment anchor from, if any.
 * @param accessTokenSpec - materialization `accessToken` input object.
 */
export function resolveApplicationAccessTokenEnvName(accessTokenSpec = {}) {
  const spec = accessTokenSpec && typeof accessTokenSpec === 'object' ? accessTokenSpec : {};
  const envField = String(spec[APP_ACCESS_TOKEN_APP_ID_ENV_FIELD] ?? '').trim();
  if (envField) {
    return envField;
  }
  const placeholder = APP_ID_ENV_PLACEHOLDER_PATTERN.exec(String(spec.appId ?? '').trim());
  return placeholder?.[1] ?? '';
}

function resolveAppIdFromEnvironment(envName, env) {
  const value = String(env?.[envName] ?? '').trim();
  if (!value) {
    throw new MissingAppIdEnvironmentError(envName);
  }
  return { appId: value, source: 'env', envName };
}

/**
 * Resolve the app id of one `accessToken` input object.
 *
 * Precedence: `appIdEnv` (or an inline `${ENV_VAR}` placeholder in `appId`)
 * reads the deployment anchor; a plain `appId` remains a literal identity.
 * @param accessTokenSpec - materialization `accessToken` input object.
 * @param env - environment bag to read the anchor from.
 */
export function resolveApplicationAccessTokenAppId(accessTokenSpec = {}, env = process.env) {
  const spec = accessTokenSpec && typeof accessTokenSpec === 'object' ? accessTokenSpec : {};
  const envField = String(spec[APP_ACCESS_TOKEN_APP_ID_ENV_FIELD] ?? '').trim();
  const declaredAppId = String(spec.appId ?? '').trim();
  if (envField && declaredAppId) {
    throw new Error(
      `accessToken must declare either ${APP_ACCESS_TOKEN_APP_ID_ENV_FIELD} or appId, not both.`,
    );
  }
  if (envField) {
    return resolveAppIdFromEnvironment(envField, env);
  }
  const placeholder = APP_ID_ENV_PLACEHOLDER_PATTERN.exec(declaredAppId);
  if (placeholder?.[1]) {
    return resolveAppIdFromEnvironment(placeholder[1], env);
  }
  if (declaredAppId) {
    return { appId: declaredAppId, source: 'literal' };
  }
  throw new Error(
    `accessToken must declare ${APP_ACCESS_TOKEN_APP_ID_ENV_FIELD} (a deployment anchor env var) `
    + 'or appId (a repository-owned app id) for a public application access token.',
  );
}

export const APPLICATION_OWNERSHIP_SCOPES = Object.freeze(['TENANT', 'ORGANIZATION', 'USER']);
export const DEFAULT_APPLICATION_OWNERSHIP_SCOPE = 'TENANT';
export const APPLICATION_OWNERSHIP_SCOPE_ENV = 'SDKWORK_APPLICATION_OWNERSHIP_SCOPE';
export const APPLICATION_OWNER_USER_ID_ENV = 'SDKWORK_APPLICATION_OWNER_USER_ID';
export const APP_ACCESS_TOKEN_OWNERSHIP_SCOPE_FIELD = 'ownershipScope';
export const APP_ACCESS_TOKEN_OWNER_USER_ID_FIELD = 'ownerUserId';

function normalizeApplicationOwnershipScope(value, label = 'ownershipScope') {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (!normalized) {
    throw new Error(`${label} is required; expected one of ${APPLICATION_OWNERSHIP_SCOPES.join(', ')}.`);
  }
  if (!APPLICATION_OWNERSHIP_SCOPES.includes(normalized)) {
    throw new Error(
      `${label}=${String(value)} is not a release scope; expected one of `
      + `${APPLICATION_OWNERSHIP_SCOPES.join(', ')}.`,
    );
  }
  return normalized;
}

function resolveLoginScope(organizationId) {
  return organizationId === '0' ? 'TENANT' : 'ORGANIZATION';
}

/**
 * Resolve a surface's declared release scope with deployment precedence:
 * process environment, then `accessToken.ownershipScope`, then `TENANT`.
 * @param accessTokenSpec - materialization `accessToken` input object.
 * @param env - environment bag to read the override from.
 */
export function resolveApplicationOwnershipScope(accessTokenSpec = {}, env = process.env) {
  const spec = accessTokenSpec && typeof accessTokenSpec === 'object' ? accessTokenSpec : {};
  const fromEnvironment = String(env?.[APPLICATION_OWNERSHIP_SCOPE_ENV] ?? '').trim();
  if (fromEnvironment) {
    return {
      ownershipScope: normalizeApplicationOwnershipScope(
        fromEnvironment,
        APPLICATION_OWNERSHIP_SCOPE_ENV,
      ),
      source: 'environment',
    };
  }
  const declared = String(spec[APP_ACCESS_TOKEN_OWNERSHIP_SCOPE_FIELD] ?? '').trim();
  if (declared) {
    return {
      ownershipScope: normalizeApplicationOwnershipScope(
        declared,
        `accessToken.${APP_ACCESS_TOKEN_OWNERSHIP_SCOPE_FIELD}`,
      ),
      source: 'declaration',
    };
  }
  return { ownershipScope: DEFAULT_APPLICATION_OWNERSHIP_SCOPE, source: 'default' };
}

/**
 * Resolve the owner user id of a `USER`-scoped surface, if one is declared.
 * @param accessTokenSpec - materialization `accessToken` input object.
 * @param env - environment bag to read the override from.
 */
export function resolveApplicationOwnerUserId(accessTokenSpec = {}, env = process.env) {
  const spec = accessTokenSpec && typeof accessTokenSpec === 'object' ? accessTokenSpec : {};
  const fromEnvironment = String(env?.[APPLICATION_OWNER_USER_ID_ENV] ?? '').trim();
  if (fromEnvironment) {
    return { userId: fromEnvironment, source: 'environment' };
  }
  const declared = String(spec[APP_ACCESS_TOKEN_OWNER_USER_ID_FIELD] ?? '').trim();
  if (declared) {
    return { userId: declared, source: 'declaration' };
  }
  return { userId: '', source: 'none' };
}

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

/**
 * Decode and validate the public application access token shape.
 * @param token - compact JWT.
 */
export function decodeApplicationAccessToken(token) {
  const parts = normalizeText(token).split('.');
  if (parts.length !== 3) {
    throw new Error('Public application access token must be a three-part JWT compact serialization.');
  }
  let header;
  let payload;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch (error) {
    throw new Error(`Public application access token payload is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (header?.alg !== 'none' || header?.kid !== 'public-app-token') {
    throw new Error('Public application access token header must declare alg=none and kid=public-app-token.');
  }
  if (parts[2] !== PUBLIC_APP_ACCESS_TOKEN_SIGNATURE) {
    throw new Error(`Public application access token signature segment must be "${PUBLIC_APP_ACCESS_TOKEN_SIGNATURE}".`);
  }
  if (payload?.token_class !== PUBLIC_APP_ACCESS_TOKEN_CLASS || payload?.token_type !== 'access') {
    throw new Error('Public application access token must declare token_class=application and token_type=access.');
  }
  const organizationId = String(payload.organization_id ?? '');
  const expectedLoginScope = resolveLoginScope(organizationId);
  if (payload.login_scope !== expectedLoginScope) {
    throw new Error(
      `Public application access token login_scope=${payload.login_scope} is inconsistent with `
      + `organization_id=${organizationId}; expected ${expectedLoginScope}.`,
    );
  }
  const declaredOwnershipScope = String(payload.ownership_scope ?? '').trim();
  const ownershipScope = declaredOwnershipScope
    ? normalizeApplicationOwnershipScope(declaredOwnershipScope, 'ownership_scope')
    : expectedLoginScope;
  if (ownershipScope === 'ORGANIZATION' && organizationId === '0') {
    throw new Error(
      'Public application access token ownership_scope=ORGANIZATION requires a non-zero '
      + `organization_id; got ${organizationId || '(empty)'}.`,
    );
  }
  if (ownershipScope !== 'ORGANIZATION' && organizationId !== '0') {
    throw new Error(
      `Public application access token ownership_scope=${ownershipScope} requires organization_id=0; `
      + `got ${organizationId}.`,
    );
  }
  if (ownershipScope === 'USER') {
    const userId = String(payload.user_id ?? '').trim();
    if (!userId || userId === '0') {
      throw new Error(
        'Public application access token ownership_scope=USER must carry the installation owner in its '
        + `user_id claim; got ${userId || '(empty)'}.`,
      );
    }
  }
  return { header, payload };
}

/**
 * Validate one committed token against the expected app/profile identity.
 * @param token - committed token.
 * @param expected - expected app identity and profile.
 */
export function assertApplicationAccessToken(token, expected = {}) {
  const { payload } = decodeApplicationAccessToken(token);
  const checks = [
    ['app_id', expected.appId],
    ['aud', expected.appId],
    ['tenant_id', expected.tenantId],
    ['organization_id', expected.organizationId ?? '0'],
    ['environment', expected.environment],
    ['deployment_profile', expected.deploymentProfile],
    ['runtime_target', expected.runtimeTarget],
    ['login_scope', expected.loginScope],
  ];
  for (const [claim, value] of checks) {
    if (value !== undefined && String(payload[claim] ?? '') !== String(value)) {
      throw new Error(`Public application access token claim ${claim}=${payload[claim]} does not match ${value}.`);
    }
  }
  if (expected.ownershipScope !== undefined) {
    const wanted = normalizeApplicationOwnershipScope(expected.ownershipScope, 'expected ownershipScope');
    const declared = String(payload.ownership_scope ?? '').trim();
    if (!declared && wanted !== DEFAULT_APPLICATION_OWNERSHIP_SCOPE) {
      throw new Error(
        `Public application access token is missing claim ownership_scope=${wanted}; an absent claim `
        + `is only valid for ${DEFAULT_APPLICATION_OWNERSHIP_SCOPE} (APP_ACCESS_TOKEN_SPEC.md §3.2.1).`,
      );
    }
    const effective = declared
      ? normalizeApplicationOwnershipScope(declared, 'ownership_scope')
      : resolveLoginScope(String(payload.organization_id ?? '0'));
    if (effective !== wanted) {
      throw new Error(
        `Public application access token claim ownership_scope=${declared || effective} does not match ${wanted}.`,
      );
    }
  }
  if (expected.ownerUserId !== undefined) {
    const wanted = String(expected.ownerUserId).trim();
    if (wanted && String(payload.user_id ?? '').trim() !== wanted) {
      throw new Error(
        `Public application access token claim user_id=${payload.user_id ?? ''} does not match ${wanted}.`,
      );
    }
  }
  return payload;
}

// ---------------------------------------------------------------------------
// Per-surface deployment anchor resolution
// (vendored from sdkwork-specs/tools/app-access-token-anchor.mjs)
// ---------------------------------------------------------------------------

export const DEFAULT_DEPLOYMENT_CONFIG_PATH = 'etc/sdkwork.deployment.config.json';

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8').replace(/^\uFEFF/u, ''));
}

function relativeTo(rootDir, filePath) {
  return path.relative(rootDir, filePath).replaceAll('\\', '/');
}

/**
 * Env files that may record one profile's surface anchor: the resolved profile
 * file named by `etc/sdkwork.deployment.config.json`, then the authored
 * override layer.
 */
export function surfaceAnchorEnvFiles(
  rootDir,
  profileId,
  deploymentConfigPath = DEFAULT_DEPLOYMENT_CONFIG_PATH,
) {
  const root = path.resolve(rootDir);
  const files = [];
  const configFile = path.resolve(root, deploymentConfigPath);
  if (existsSync(configFile)) {
    const config = readJson(configFile);
    const configured = String(config?.profiles?.[profileId]?.config ?? '').trim();
    if (configured) {
      const profileFile = path.resolve(root, 'etc', configured);
      const relative = path.relative(root, profileFile);
      if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
        files.push(profileFile);
      }
    }
  }
  files.push(path.join(root, 'etc', 'topology', 'overrides', `${profileId}.env`));
  return [...new Set(files)];
}

/**
 * Read one recorded anchor variable out of a profile's env layer.
 */
export function readRecordedSurfaceAnchor(
  rootDir,
  profileId,
  envName,
  deploymentConfigPath = DEFAULT_DEPLOYMENT_CONFIG_PATH,
) {
  for (const filePath of surfaceAnchorEnvFiles(rootDir, profileId, deploymentConfigPath)) {
    if (!existsSync(filePath)) {
      continue;
    }
    const values = parseClientEnvDotenv(readFileSync(filePath, 'utf8').replace(/^\uFEFF/u, ''));
    const value = String(values[envName] ?? '').trim();
    if (value) {
      return { value, source: relativeTo(path.resolve(rootDir), filePath) };
    }
  }
  return { value: '', source: '' };
}

/**
 * Expected anchor of one (surface, profile) pair, plus the layer it came from.
 * @param options - repository root, declared surface, profile, env bag.
 */
export function resolveSurfaceAnchor({
  rootDir,
  surface,
  profileId,
  env = process.env,
  deploymentConfigPath = DEFAULT_DEPLOYMENT_CONFIG_PATH,
} = {}) {
  const surfaceId = String(surface?.id ?? '').trim();
  const spec = surface?.accessToken;
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new Error(`${surfaceId || 'surface'}: accessToken is required.`);
  }
  const baseEnvName = resolveApplicationAccessTokenEnvName(spec);
  const root = path.resolve(rootDir);
  if (!baseEnvName) {
    // A literal `accessToken.appId` is repository-owned: it takes no environment
    // anchor and is compared as declared.
    const { appId } = resolveApplicationAccessTokenAppId(spec, env);
    return {
      surfaceId,
      appId,
      baseEnvName: '',
      surfaceEnvName: '',
      envName: '',
      source: 'literal',
      sourceFile: '',
    };
  }
  const surfaceEnvName = surfaceApplicationTokenEnvName(baseEnvName, surfaceId);
  if (!surfaceEnvName) {
    throw new Error(
      `${surfaceId || 'surface'}: surface id must yield a surface-scoped anchor variable; `
      + 'the declared id has no name characters',
    );
  }
  const recorded = readRecordedSurfaceAnchor(root, profileId, surfaceEnvName, deploymentConfigPath);
  const explicit = String(env?.[surfaceEnvName] ?? '').trim();
  const repository = String(env?.[baseEnvName] ?? '').trim();
  let source = '';
  if (explicit) {
    source = 'environment';
  } else if (recorded.value) {
    source = 'recorded';
  } else if (repository) {
    source = 'repository';
  }
  const appId = resolveSurfaceAccessTokenAppId(
    surface,
    env,
    recorded.value ? { [surfaceEnvName]: recorded.value } : {},
  );
  return {
    surfaceId,
    appId,
    baseEnvName,
    surfaceEnvName,
    envName: source === 'repository' ? baseEnvName : surfaceEnvName,
    source,
    sourceFile: source === 'recorded' ? recorded.source : '',
  };
}

// ---------------------------------------------------------------------------
// Client surface declaration helpers
// (vendored from sdkwork-specs/tools/materialize-client-env.mjs)
// ---------------------------------------------------------------------------

function surfaceIdOf(surface) {
  return String(surface?.id ?? '').trim();
}

/**
 * The declared anchor variable of one surface, plus its surface-scoped form.
 */
export function surfaceAnchorEnvNames(surface) {
  const base = resolveApplicationAccessTokenEnvName(surface?.accessToken);
  if (!base) {
    return { baseEnvName: '', surfaceEnvName: '' };
  }
  return {
    baseEnvName: base,
    surfaceEnvName: surfaceApplicationTokenEnvName(base, surfaceIdOf(surface)),
  };
}

/**
 * Fail when two declared surfaces would read the same anchor variable.
 */
function assertDistinctSurfaceAnchorEnvNames(surfaces) {
  const byEnvName = new Map();
  for (const surface of surfaces) {
    const id = surfaceIdOf(surface);
    const { surfaceEnvName } = surfaceAnchorEnvNames(surface);
    if (!surfaceEnvName) {
      continue;
    }
    const bucket = byEnvName.get(surfaceEnvName) ?? [];
    bucket.push(id || '(surface without id)');
    byEnvName.set(surfaceEnvName, bucket);
  }
  for (const [envName, ids] of byEnvName) {
    if (ids.length > 1) {
      throw new Error(
        `${envName} would be the anchor variable of ${ids.join(' and ')}; surface ids must derive `
        + 'distinct anchor variables so each surface can carry its own deployment anchor',
      );
    }
  }
}

/**
 * Restrict the declared client surfaces to the requested surface ids.
 */
export function filterClientEnvSurfaces(surfaces, surfaceIds = []) {
  const declared = Array.isArray(surfaces) ? surfaces : [];
  if (!Array.isArray(surfaceIds) || surfaceIds.length === 0) {
    return [...declared];
  }
  const wanted = [...new Set(surfaceIds.map((value) => String(value ?? '').trim()).filter(Boolean))];
  const known = new Set(declared.map(surfaceIdOf));
  const unknown = wanted.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new Error(
      `--surface ${unknown.join(', ')} is not declared in etc/client-env.materialization.json; `
      + `declared surface(s): ${[...known].join(', ')}`,
    );
  }
  assertDistinctSurfaceAnchorEnvNames(declared);
  const selected = wanted.filter((id) => known.has(id));
  return declared.filter((surface) => selected.includes(surfaceIdOf(surface)));
}

/**
 * Environment one surface resolves its deployment anchor from: the per-surface
 * variable in the process environment, then the same variable in the resolved
 * deployment profile, then the declared base variable.
 */
export function surfaceAnchorEnvironment(surface, env = process.env, sourceValues = {}) {
  const { baseEnvName, surfaceEnvName } = surfaceAnchorEnvNames(surface);
  if (!surfaceEnvName) {
    return env;
  }
  const explicit = String(env?.[surfaceEnvName] ?? '').trim();
  const recorded = String(sourceValues?.[surfaceEnvName] ?? '').trim();
  const value = explicit || recorded;
  if (!value) {
    return env;
  }
  let projected;
  try {
    projected = { ...env };
  } catch {
    projected = {};
  }
  projected[baseEnvName] = value;
  return projected;
}

/**
 * Resolve one surface's public token `app_id` from its deployment anchor.
 */
export function resolveSurfaceAccessTokenAppId(surface, env = process.env, sourceValues = {}) {
  const spec = surface?.accessToken;
  if (!spec || typeof spec !== 'object') {
    throw new Error(
      `${surfaceIdOf(surface) || 'surface'} must declare accessToken.appIdEnv (a deployment anchor `
      + 'env var) or accessToken.appId.',
    );
  }
  const { appId } = resolveApplicationAccessTokenAppId(
    spec,
    surfaceAnchorEnvironment(surface, env, sourceValues),
  );
  return appId;
}

export function parseClientEnvDotenv(source) {
  const values = {};
  for (const rawLine of String(source ?? '').split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      throw new Error(`Invalid dotenv line: ${rawLine}`);
    }
    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if (
      value.length >= 2
      && ((value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function readSurfaceManifestIdentity(rootDir, surface) {
  const manifestPath = path.join(path.resolve(rootDir, String(surface.root ?? '.')), 'agent.app.config.json');
  if (!existsSync(manifestPath)) {
    return undefined;
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/u, ''));
  } catch (error) {
    throw new Error(
      `${path.relative(rootDir, manifestPath).replaceAll('\\', '/')} is unreadable: `
      + `${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const backend = manifest?.backend && typeof manifest.backend === 'object' ? manifest.backend : {};
  const read = (value) => (typeof value === 'string' ? value.trim() : '');
  return {
    tenantId: read(backend.tenantId),
    organizationId: read(backend.organizationId),
  };
}

/**
 * Refuse a surface token declaration that contradicts its root's manifest.
 */
export function assertSurfaceAccessTokenIdentity({ rootDir, surface, accessToken }) {
  const identity = readSurfaceManifestIdentity(rootDir, surface);
  if (identity === undefined) {
    return;
  }
  const declaredTenant = String(accessToken?.tenantId ?? '').trim() || '100001';
  if (identity.tenantId && declaredTenant !== identity.tenantId) {
    throw new Error(
      `${surface.id}: accessToken.tenantId=${declaredTenant} contradicts the manifest `
      + `backend.tenantId=${identity.tenantId}; the public token must resolve the root's own tenant.`,
    );
  }
  const declaredOrganization = String(accessToken?.organizationId ?? '').trim() || '0';
  if (identity.organizationId && identity.organizationId !== '0' && declaredOrganization !== identity.organizationId) {
    throw new Error(
      `${surface.id}: accessToken.organizationId=${declaredOrganization} contradicts the manifest `
      + `backend.organizationId=${identity.organizationId}; an organization-bound application cannot `
      + 'ship a token outside that organization.',
    );
  }
}

// ---------------------------------------------------------------------------
// The release preflight itself
// ---------------------------------------------------------------------------

const DEFAULT_RELEASE_ENVIRONMENTS = ['test', 'staging', 'demo', 'production'];
const PROFILE_PATTERN = /^(?:standalone|cloud)\.(development|test|staging|demo|production)$/u;

function parseArgs(argv) {
  const options = {
    root: process.cwd(),
    profiles: [],
    json: false,
    allowNoSurfaces: false,
    requireAnchor: false,
    surfaceIds: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--json') {
      options.json = true;
      continue;
    }
    if (token === '--allow-no-surfaces') {
      options.allowNoSurfaces = true;
      continue;
    }
    // Packaging passes this so a missing anchor is a release failure; a source
    // checkout has no anchor yet, so the check reports it and skips.
    if (token === '--require-anchor') {
      options.requireAnchor = true;
      continue;
    }
    if (token === '--root' || token === '--profiles' || token === '--surface') {
      const value = String(argv[index + 1] ?? '').trim();
      if (!value) throw new Error(`${token} requires a value.`);
      if (token === '--root') {
        options.root = path.resolve(value);
      } else if (token === '--profiles') {
        options.profiles = value.split(',').map((profile) => profile.trim()).filter(Boolean);
      } else {
        options.surfaceIds.push(...value.split(',').map((entry) => entry.trim()).filter(Boolean));
      }
      index += 1;
      continue;
    }
    throw new Error(`Unsupported release access token option: ${token}`);
  }
  return options;
}

function formatFromManifest(manifest) {
  const framework = String(manifest?.runtime?.framework ?? '').trim();
  if (framework === 'flutter') return 'flutter';
  if (framework === 'harmony-native' || framework === 'android-native' || framework === 'ios-native') return 'native';
  // uni-app x / uniappx apps use the native JSON runtime profile
  // (`config/app/runtime-env.<profile>.json`, UNIAPP_X_APP_ARCHITECTURE_SPEC §12).
  if (framework.includes('uni-app-x') || framework.includes('uniappx')) return 'native';
  if (framework.startsWith('mp-') || framework.includes('mini-program') || framework === 'multi-mini-program') {
    return 'mini-program';
  }
  return 'vite';
}

function profilePath(appRoot, format, profileId) {
  if (format === 'flutter') return path.join(appRoot, 'env', `sdkwork.${profileId}.json`);
  if (format === 'mini-program') return path.join(appRoot, 'config', 'mini-program', `runtime-env.${profileId}.json`);
  if (format === 'native') return path.join(appRoot, 'config', 'app', `runtime-env.${profileId}.json`);
  return path.join(appRoot, `.env.${profileId}`);
}

function readToken(filePath) {
  const text = readFileSync(filePath, 'utf8');
  const jsonMatch = /"SDKWORK_ACCESS_TOKEN"\s*:\s*"([^"]+)"/u.exec(text);
  if (jsonMatch) return jsonMatch[1].trim();
  const envMatch = /^SDKWORK_ACCESS_TOKEN=(.*)$/mu.exec(text);
  return envMatch ? envMatch[1].trim().replace(/^["']|["']$/gu, '') : '';
}

function readSurfaces(root) {
  const configPath = path.join(root, 'etc', 'client-env.materialization.json');
  if (!existsSync(configPath)) return null;
  const config = readJson(configPath);
  return (config.surfaces ?? []).map((surface) => ({
    ...surface,
    format: String(surface.format ?? '').trim(),
  }));
}

function anchorVariables(error, surfaceId) {
  const surfaceEnvName = surfaceApplicationTokenEnvName(error.envName, surfaceId);
  return surfaceEnvName ? `${surfaceEnvName} (or ${error.envName})` : error.envName;
}

function resolveSurfaceFormat(surface, root) {
  const appRoot = path.join(root, String(surface.root ?? ''));
  const manifestPath = path.join(appRoot, 'agent.app.config.json');
  let format = surface.format;
  let manifest = null;
  if (existsSync(manifestPath)) {
    try {
      manifest = readJson(manifestPath);
    } catch {
      manifest = null;
    }
    if (!format || format === 'auto') format = formatFromManifest(manifest);
  }
  if (!format) format = 'vite';
  if (format === 'harmony-native' || format === 'android-native' || format === 'ios-native') {
    format = 'native';
  }
  return { appRoot, manifest, format };
}

export function checkReleaseAccessTokenEnv(
  rootDir,
  {
    environments = DEFAULT_RELEASE_ENVIRONMENTS,
    allowNoSurfaces = false,
    requireAnchor = false,
    surfaceIds = [],
    env = process.env,
  } = {},
) {
  const root = path.resolve(rootDir);
  const deploymentPath = path.join(root, 'etc', 'sdkwork.deployment.config.json');
  if (!existsSync(deploymentPath)) {
    return {
      root,
      checked: [],
      pending: [],
      skippedSurfaces: [],
      failures: [{ profileId: '<config>', reason: 'etc/sdkwork.deployment.config.json is missing' }],
    };
  }
  const deployment = readJson(deploymentPath);
  const declared = Object.keys(deployment.profiles ?? {});
  const releaseProfiles = declared.filter((profileId) => {
    const match = PROFILE_PATTERN.exec(profileId);
    return match && environments.includes(match[1]);
  });
  const surfaces = readSurfaces(root);
  const checked = [];
  const pending = [];
  const skippedSurfaces = [];
  const failures = [];

  if (!surfaces || surfaces.length === 0) {
    // Server-only repositories have no client document to carry a public
    // token; the pre-commit hook opts out explicitly with `--allow-no-surfaces`.
    if (allowNoSurfaces) return { root, checked, pending, skippedSurfaces, failures, skipped: true };
    failures.push({
      profileId: '<surfaces>',
      reason: 'etc/client-env.materialization.json declares no client surface to carry the access token',
    });
    return { root, checked, pending, skippedSurfaces, failures };
  }
  const selectedSurfaces = filterClientEnvSurfaces(surfaces, surfaceIds);
  const clientSurfaces = selectedSurfaces.filter((surface) => surface.format !== 'none');
  if (clientSurfaces.length === 0) {
    // A repository that declares only format=none surfaces is server-only; it
    // has no browser/mobile document to carry a public application token.
    return { root, checked, pending, skippedSurfaces, failures, skipped: true };
  }

  for (const surface of clientSurfaces) {
    const surfaceId = String(surface?.id ?? '').trim();
    const { appRoot, manifest, format } = resolveSurfaceFormat(surface, root);
    const usesAnchor = surface.accessToken
      && typeof surface.accessToken === 'object'
      && !Array.isArray(surface.accessToken);
    // The release scope is resolved the way the materializer resolves it
    // (`SDKWORK_APPLICATION_OWNERSHIP_SCOPE`, then `accessToken.ownershipScope`,
    // then `TENANT`), so a packaged token must carry the installation's scope
    // (`APP_ACCESS_TOKEN_SPEC.md` §3.2.1).
    let ownershipScope;
    let ownerUserId = '';
    if (usesAnchor) {
      try {
        // The declaration must agree with the root's manifest identity
        // (`APP_ACCESS_TOKEN_SPEC.md` §3): a release token cannot resolve another
        // tenant, or an organization the application is not bound to.
        assertSurfaceAccessTokenIdentity({ rootDir: root, surface, accessToken: surface.accessToken });
      } catch (error) {
        failures.push({
          profileId: surfaceId,
          reason: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      try {
        ({ ownershipScope } = resolveApplicationOwnershipScope(surface.accessToken, env));
        if (ownershipScope === 'USER') {
          ({ userId: ownerUserId } = resolveApplicationOwnerUserId(surface.accessToken, env));
        }
      } catch (error) {
        failures.push({
          profileId: surfaceId,
          reason: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
    }
    // A legacy surface without an `accessToken` input has no deployment anchor;
    // its manifest identity is compared instead.
    const manifestAppId = manifest?.backend?.appId ?? manifest?.app?.key;
    const excluded = new Set(surface.excludeProfiles ?? []);
    for (const profileId of releaseProfiles) {
      const filePath = profilePath(appRoot, format, profileId);
      if (excluded.has(profileId) && !existsSync(filePath)) {
        continue;
      }
      let appId = manifestAppId;
      let resolution = null;
      if (usesAnchor) {
        try {
          resolution = resolveSurfaceAnchor({
            rootDir: root,
            surface,
            profileId,
            env,
            deploymentConfigPath: DEFAULT_DEPLOYMENT_CONFIG_PATH,
          });
          appId = resolution.appId;
        } catch (error) {
          if (isMissingAppIdEnvironmentError(error)) {
            const entry = {
              profileId: `${surfaceId}/${profileId}`,
              reason: `${anchorVariables(error, surfaceId)} is required to verify this release surface's public application token`,
            };
            if (requireAnchor) {
              failures.push(entry);
            } else {
              skippedSurfaces.push(entry);
            }
            continue;
          }
          failures.push({
            profileId: `${surfaceId}/${profileId}`,
            reason: error instanceof Error ? error.message : String(error),
          });
          continue;
        }
      }
      if (!existsSync(filePath)) {
        failures.push({
          profileId: `${surfaceId}/${profileId}`,
          reason: `missing ${path.relative(root, filePath).replaceAll('\\', '/')}`,
        });
        continue;
      }
      const token = readToken(filePath);
      if (!token) {
        failures.push({ profileId: `${surfaceId}/${profileId}`, reason: 'SDKWORK_ACCESS_TOKEN is missing or empty' });
        continue;
      }
      let payload;
      try {
        ({ payload } = decodeApplicationAccessToken(token));
      } catch (error) {
        failures.push({
          profileId: `${surfaceId}/${profileId}`,
          reason: error instanceof Error ? error.message.split('\n')[0] : String(error),
        });
        continue;
      }
      if (
        isApplicationAccessTokenPendingAppId(payload.app_id, resolution?.baseEnvName)
        || isApplicationAccessTokenPendingAppId(payload.aud, resolution?.baseEnvName)
      ) {
        const file = path.relative(root, filePath).replaceAll('\\', '/');
        pending.push({ profileId: `${surfaceId}/${profileId}`, file });
        if (requireAnchor) {
          const provenance = resolution ? ` (from ${resolution.envName}=${appId})` : '';
          failures.push({
            profileId: `${surfaceId}/${profileId}`,
            reason: `needs materialization: ${file} still carries the ${PUBLIC_APP_ACCESS_TOKEN_PENDING_APP_ID} `
              + `placeholder instead of ${appId}${provenance}`,
          });
        }
        continue;
      }
      try {
        const environment = profileId.split('.')[1];
        const deploymentProfile = profileId.split('.')[0];
        // The decode above only classifies the pending placeholder; reuse the
        // token validator for the claim checks.
        assertApplicationAccessToken(token, {
          environment,
          deploymentProfile,
          ...(appId ? { appId } : {}),
          // The materializer derives `organization_id` from the surface
          // declaration, so the release gate compares the same value instead of
          // assuming a tenant-level (0) token.
          ...(usesAnchor
            ? { organizationId: String(surface.accessToken.organizationId ?? '0').trim() }
            : {}),
          ...(ownershipScope ? { ownershipScope } : {}),
          ...(ownerUserId ? { ownerUserId } : {}),
        });
        checked.push(`${surfaceId}/${profileId}`);
      } catch (error) {
        failures.push({
          profileId: `${surfaceId}/${profileId}`,
          reason: error instanceof Error ? error.message.split('\n')[0] : String(error),
        });
      }
    }
  }

  if (
    checked.length === 0
    && failures.length === 0
    && skippedSurfaces.length === 0
    && pending.length === 0
  ) {
    failures.push({
      profileId: '<matrix>',
      reason: `no client surface covers ${environments.join(', ')}`,
    });
  }
  return { root, checked, pending, skippedSurfaces, failures };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const environments = options.profiles.length > 0
    ? options.profiles.map((profile) => profile.split('.').pop())
    : DEFAULT_RELEASE_ENVIRONMENTS;
  const result = checkReleaseAccessTokenEnv(options.root, {
    environments,
    allowNoSurfaces: options.allowNoSurfaces,
    requireAnchor: options.requireAnchor,
    surfaceIds: options.surfaceIds,
  });
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    if (result.failures.length === 0) {
      console.log(`release access-token preflight passed: ${result.checked.length} surface/profile pair(s)`);
      for (const entry of result.skippedSurfaces ?? []) {
        console.log(`  - skipped ${entry.profileId}: ${entry.reason}`);
      }
      for (const entry of result.pending ?? []) {
        console.log(`  - needs materialization: ${entry.profileId} (${entry.file})`);
      }
    } else {
      console.error('release access-token preflight failed:');
      for (const failure of result.failures) {
        console.error(`  - ${failure.profileId}: ${failure.reason}`);
      }
      console.error('Configure a valid public application access token in every release profile before building or deploying.');
    }
  }
  if (result.failures.length > 0) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
