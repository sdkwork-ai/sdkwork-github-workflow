import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  dependencyRefInputs,
  renderAppWorkflows,
  renderRepositoryWorkflows,
} from '../scripts/render-app-workflows.mjs';

const templates = {
  packageTemplate: await readFile('templates/app-package.workflow.yml', 'utf8'),
  verifyTemplate: await readFile('templates/app-verify.workflow.yml', 'utf8'),
};

test('renders both entrypoints unchanged for a configuration without dependency refs', () => {
  const rendered = renderAppWorkflows(templates);
  assert.equal(rendered.packageWorkflow, templates.packageTemplate);
  assert.equal(rendered.verifyWorkflow, templates.verifyTemplate);
});

test('renders declared dependency ref inputs into the package entrypoint', () => {
  const rendered = renderAppWorkflows({
    ...templates,
    refInputs: ['SDKWORK_CORE_REF', 'SDKWORK_UI_REF'],
  });

  // Each dependency ref is dispatchable and falls back to its repository variable.
  for (const [input, variable] of [
    ['sdkwork_core_ref', 'SDKWORK_CORE_REF'],
    ['sdkwork_ui_ref', 'SDKWORK_UI_REF'],
  ]) {
    assert.match(rendered.packageWorkflow, new RegExp(`^ {6}${input}:$`, 'mu'));
    assert.match(
      rendered.packageWorkflow,
      new RegExp(`"${variable}": "\\$\\{\\{ github\\.event\\.inputs\\.${input} \\|\\| vars\\.${variable} \\}\\}"`, 'u'),
    );
  }
  // A ref the configuration does not declare must not leak into the entrypoint.
  assert.doesNotMatch(rendered.packageWorkflow, /SDKWORK_APPBASE_REF/u);
  // The verification entrypoint carries no dependency wiring of its own: the
  // planner reads the checkout plan from agent.workflow.json there.
  assert.equal(rendered.verifyWorkflow, templates.verifyTemplate);
});

test('pins the framework ref in both entrypoints', () => {
  const rendered = renderAppWorkflows({ ...templates, frameworkRef: 'a'.repeat(40) });
  assert.match(rendered.packageWorkflow, new RegExp(`sdkwork-package\\.yml@${'a'.repeat(40)}`, 'u'));
  assert.match(rendered.verifyWorkflow, new RegExp(`sdkwork-ci\\.yml@${'a'.repeat(40)}`, 'u'));
  assert.match(rendered.packageWorkflow, new RegExp(`framework_ref: ${'a'.repeat(40)}`, 'u'));
  assert.match(rendered.verifyWorkflow, new RegExp(`framework_ref: ${'a'.repeat(40)}`, 'u'));
});

test('collects dependency ref inputs in declaration order without duplicates', () => {
  assert.deepEqual(dependencyRefInputs({
    dependencies: [
      { refInput: 'SDKWORK_CORE_REF' },
      { repository: 'sdkwork-ai/x' },
      { refInput: 'SDKWORK_UI_REF' },
    ],
    verificationDependencies: [
      { refInput: 'SDKWORK_CORE_REF', purpose: 'typecheck' },
      { refInput: 'SDKWORK_APPBASE_REF' },
    ],
  }), ['SDKWORK_CORE_REF', 'SDKWORK_UI_REF', 'SDKWORK_APPBASE_REF']);
  assert.deepEqual(dependencyRefInputs({}), []);
});

test('renders one repository from its configuration and reports no change on the second pass', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'render-app-workflows-'));
  try {
    await mkdir(path.join(root, '.github', 'workflows'), { recursive: true });
    await writeFile(path.join(root, 'agent.workflow.json'), `${JSON.stringify({
      schemaVersion: '2026-06-06.agent.workflow.v1',
      app: { id: 'render-demo', repository: 'sdkwork-ai/render-demo' },
      release: { artifactPrefix: 'render-demo' },
      targets: [{
        id: 'linux-x64-standalone-server-tar-gz',
        packageId: 'linux-x64-standalone-server-tar-gz',
        profileBinding: 'fixed',
        deploymentProfile: 'standalone',
        runtimeTarget: 'server',
        profile: 'server',
        platform: 'linux',
        architecture: 'x64',
        variant: 'server',
        format: 'tar.gz',
        runner: 'ubuntu-24.04',
        outputGlobs: ['dist/*.tar.gz'],
      }],
      dependencies: [{ id: 'core', repository: 'sdkwork-ai/sdkwork-core', refInput: 'SDKWORK_CORE_REF', path: '../sdkwork-core' }],
    }, null, 2)}\n`, 'utf8');

    const first = await renderRepositoryWorkflows(root, { write: true });
    assert.equal(first.changed.length, 2);
    assert.match(await readFile(path.join(root, '.github', 'workflows', 'package.yml'), 'utf8'), /sdkwork_core_ref/u);
    assert.match(await readFile(path.join(root, '.github', 'workflows', 'verify.yml'), 'utf8'), /sdkwork-ci\.yml@v1/u);

    const second = await renderRepositoryWorkflows(root, { write: true });
    assert.deepEqual(second.changed, []);
    assert.equal(second.unchanged.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
