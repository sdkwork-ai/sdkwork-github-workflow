#!/usr/bin/env node

/**
 * Render an application repository's GitHub workflow entrypoints from its
 * `agent.workflow.json`.
 *
 * The framework owns both entrypoints (`package.yml`, `verify.yml`); an
 * application owns the configuration. Rendering from the configuration keeps the
 * dependency ref inputs and the pinned framework ref in sync with the checked-in
 * templates, so a repository never hand-maintains reusable-workflow wiring.
 */

import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const TEMPLATE_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates');
const PACKAGE_TEMPLATE = path.join(TEMPLATE_DIRECTORY, 'app-package.workflow.yml');
const VERIFY_TEMPLATE = path.join(TEMPLATE_DIRECTORY, 'app-verify.workflow.yml');
const DEFAULT_FRAMEWORK_REF = 'v1';

function pinFrameworkRef(template, workflow, frameworkRef) {
  return template
    .replaceAll(`sdkwork-ai/sdkwork-github-workflow/.github/workflows/${workflow}@v1`, `sdkwork-ai/sdkwork-github-workflow/.github/workflows/${workflow}@${frameworkRef}`)
    .replaceAll('framework_ref: v1', `framework_ref: ${frameworkRef}`);
}

/**
 * Collect the dependency ref inputs a configuration declares.
 *
 * `refInput` is the repository-variable name (`SDKWORK_CORE_REF`); the dispatch
 * input is its lower-case form, and a blank input falls back to the variable.
 * @param {object} config - Parsed `agent.workflow.json`.
 * @returns {string[]} Declared ref input names, de-duplicated in declaration order.
 */
export function dependencyRefInputs(config) {
  const names = [];
  for (const collection of ['dependencies', 'verificationDependencies']) {
    for (const dependency of config?.[collection] ?? []) {
      const refInput = dependency?.refInput;
      if (typeof refInput !== 'string' || refInput.trim() === '') continue;
      if (!names.includes(refInput.trim())) names.push(refInput.trim());
    }
  }
  return names;
}

/**
 * Render both entrypoints for one configuration.
 * @param {{ packageTemplate: string, verifyTemplate: string, frameworkRef?: string, refInputs?: string[], scripts?: string[]|null }} options - Template text, pinned ref, declared dependency ref inputs, and the gate scripts the verification entrypoint runs.
 * @returns {{ packageWorkflow: string, verifyWorkflow: string }} Rendered workflow YAML.
 */
export function renderAppWorkflows({ packageTemplate, verifyTemplate, frameworkRef = DEFAULT_FRAMEWORK_REF, refInputs = [], scripts = null }) {
  const packageWorkflow = pinFrameworkRef(packageTemplate, 'sdkwork-package.yml', frameworkRef);
  let verifyWorkflow = pinFrameworkRef(verifyTemplate, 'sdkwork-ci.yml', frameworkRef);
  if (Array.isArray(scripts) && scripts.length > 0) {
    const renderedScripts = scripts.join(',');
    // CRLF templates are possible on a Windows checkout, so the line matches with
    // optional trailing whitespace and the replacement writes the canonical form.
    const line = /^ {6}scripts: verify[ \t]*\r?$/mu;
    if (!line.test(verifyWorkflow)) {
      throw new Error('verify template has no scripts line to render');
    }
    // Test before replacing: a gate list identical to the template value is a
    // valid render, and comparing the two strings would misreport it.
    verifyWorkflow = verifyWorkflow.replace(line, `      scripts: ${renderedScripts}`);
  }
  if (refInputs.length === 0) return { packageWorkflow, verifyWorkflow };

  const dispatchInputs = refInputs
    .map((refInput) => [
      `      ${refInput.toLowerCase()}:`,
      `        description: '${refInput} dependency ref; blank falls back to the repository variable.'`,
      '        required: false',
      "        default: ''",
    ].join('\n'))
    .join('\n');
  const withInputs = packageWorkflow.replace(/\npermissions:\n/u, `\n${dispatchInputs}\n\npermissions:\n`);
  if (withInputs === packageWorkflow) {
    throw new Error('package template has no dispatch-input insertion point before permissions:');
  }

  const entries = refInputs.map((refInput) => {
    const input = refInput.toLowerCase();
    return `          "${refInput}": "\${{ github.event.inputs.${input} || vars.${refInput} }}"`;
  });
  const block = /( +)dependency_refs_json: >-\n[\s\S]*?(?=\n    secrets:)/u;
  if (!block.test(withInputs)) {
    throw new Error('package template has no dependency_refs_json block to render');
  }
  const rendered = withInputs.replace(
    block,
    (match, indent) => `${indent}dependency_refs_json: >-\n${indent}  {\n${entries.map((entry) => `${indent}    ${entry}`).join(',\n')}\n${indent}  }`,
  );
  return { packageWorkflow: rendered, verifyWorkflow };
}

/**
 * Read the framework ref an existing entrypoint already pins.
 *
 * Re-rendering must not silently retarget a repository from its pinned commit to
 * the default release line: the ref is a supply-chain choice the repository made.
 * @param {string} root - Application repository root.
 * @returns {string|null} Pinned ref, or null when neither entrypoint exists.
 */
function detectFrameworkRef(root) {
  for (const [workflow, name] of [['package.yml', 'sdkwork-package.yml'], ['verify.yml', 'sdkwork-ci.yml']]) {
    const file = path.join(root, '.github', 'workflows', workflow);
    if (!existsSync(file)) continue;
    const match = new RegExp(`sdkwork-github-workflow/\\.github/workflows/${name.replaceAll('.', '\\.')}@([^\\s]+)`, 'u')
      .exec(readFileSync(file, 'utf8'));
    if (match) return match[1];
  }
  return null;
}

/**
 * Render one repository's entrypoints on disk.
 * @param {string} root - Application repository root.
 * @param {{ write?: boolean, frameworkRef?: string, verifyOnly?: boolean, scripts?: string[]|null }} [options] - Write mode, pinned framework ref, verification-only mode, and the gate scripts to render.
 * @returns {Promise<{ root: string, changed: string[], unchanged: string[] }>} Written and matching files.
 */
export async function renderRepositoryWorkflows(root, options = {}) {
  const write = options.write === true;
  const frameworkRef = options.frameworkRef ?? detectFrameworkRef(root) ?? DEFAULT_FRAMEWORK_REF;
  const configPath = path.join(root, 'agent.workflow.json');
  const config = existsSync(configPath) ? JSON.parse(await readFile(configPath, 'utf8')) : null;
  // A `ci-only` repository packages nothing, so a package entrypoint would be a
  // release pipeline with no target: its role forces verification-only rendering.
  const verifyOnly = options.verifyOnly === true || config?.workflowRole === 'ci-only';
  const refInputs = verifyOnly ? [] : dependencyRefInputs(config);
  const rendered = renderAppWorkflows({
    packageTemplate: await readFile(PACKAGE_TEMPLATE, 'utf8'),
    verifyTemplate: await readFile(VERIFY_TEMPLATE, 'utf8'),
    frameworkRef,
    refInputs,
    scripts: Array.isArray(options.scripts) && options.scripts.length > 0 ? options.scripts : null,
  });
  const files = verifyOnly
    ? [[path.join(root, '.github', 'workflows', 'verify.yml'), rendered.verifyWorkflow]]
    : [
        [path.join(root, '.github', 'workflows', 'package.yml'), rendered.packageWorkflow],
        [path.join(root, '.github', 'workflows', 'verify.yml'), rendered.verifyWorkflow],
      ];
  const changed = [];
  const unchanged = [];
  for (const [file, content] of files) {
    const current = existsSync(file) ? await readFile(file, 'utf8') : null;
    if (current === content) {
      unchanged.push(file);
      continue;
    }
    changed.push(file);
    if (write) {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, content, 'utf8');
    }
  }
  return { root, changed, unchanged };
}

function parseOptions(argv) {
  const options = { root: null, write: false, frameworkRef: null, help: false, plan: false, verifyOnly: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--root') options.root = argv[++index];
    else if (argument === '--framework-ref') options.frameworkRef = argv[++index];
    else if (argument === '--write') options.write = true;
    else if (argument === '--check') options.write = false;
    else if (argument === '--plan') options.plan = true;
    else if (argument === '--verify-only') options.verifyOnly = true;
    else if (argument === '--scripts') options.scripts = (argv[++index] ?? '').split(',').map((value) => value.trim()).filter(Boolean);
    else if (argument === '--help' || argument === '-h') options.help = true;
    else throw new Error(`render-app-workflows: unknown argument ${argument}`);
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseOptions(process.argv.slice(2));
    if (options.help || !options.root) {
      console.log('Usage: node scripts/render-app-workflows.mjs --root <repo> [--write | --plan | --check] [--verify-only] [--framework-ref <ref>]');
      process.exitCode = options.help ? 0 : 2;
    } else {
      const root = path.resolve(options.root);
      const result = await renderRepositoryWorkflows(root, {
        write: options.write,
        frameworkRef: options.frameworkRef,
        verifyOnly: options.verifyOnly === true,
        scripts: options.scripts ?? null,
      });
      const verb = options.write ? 'rendered' : 'differs';
      for (const file of result.changed) console.log(`[render-app-workflows] ${verb} ${path.relative(root, file)}`);
      for (const file of result.unchanged) console.log(`[render-app-workflows] ok      ${path.relative(root, file)}`);
      // `--plan` reports what `--write` would change without failing the caller;
      // `--check` (the default) exits non-zero so a gate can require alignment.
      if (!options.write && !options.plan && result.changed.length > 0) process.exitCode = 1;
    }
  } catch (error) {
    console.error(`[render-app-workflows] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
