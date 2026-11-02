import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCiSetupPlan,
  runCiSetupPlan,
  validateWorkflowConfig,
} from '../scripts/agent-workflow.mjs';

function baseConfig() {
  return {
    schemaVersion: '2026-06-06.agent.workflow.v1',
    app: { id: 'ci-demo', repository: 'sdkwork-ai/ci-demo' },
    release: { artifactPrefix: 'ci-demo' },
    targets: [{
      id: 'linux-x64-standalone-server-tar-gz',
      packageId: 'linux-x64-standalone-server-tar-gz',
      profileBinding: 'fixed',
      deploymentProfile: 'standalone',
      runtimeTarget: 'server',
      profile: 'server',
      platform: 'linux',
      architecture: 'x64',
      formats: ['tar.gz'],
      runner: 'ubuntu-24.04',
      outputGlobs: ['dist/*.tar.gz'],
    }],
  };
}

test('ci.setup carries environment preparation as lifecycle-shaped steps', () => {
  const config = {
    ...baseConfig(),
    ci: {
      setup: [
        { name: 'Install PHP', run: 'sudo apt-get install -y php-cli' },
        { name: 'Install Composer', run: 'curl -sS https://getcomposer.org/installer | php', shell: 'bash' },
      ],
    },
  };
  assert.deepEqual(validateWorkflowConfig(config), []);
  const plan = createCiSetupPlan(config);
  assert.equal(plan.steps.length, 2);
  assert.equal(plan.steps[0].name, 'Install PHP');
  assert.equal(plan.steps[1].shell, 'bash');
});

test('ci rejects fields and steps the framework cannot run', () => {
  for (const [config, message] of [
    [{ ci: { unknown: [] } }, /unknown is not supported/u],
    [{ ci: { setup: [{ name: 'no command' }] } }, /ci\.setup\[0\] must declare run/u],
    [{ ci: { setup: [{ run: 'echo hi', shell: 'fish' }] } }, /unsupported shell fish/u],
    [{ ci: { setup: [{ run: 'echo hi', env: { TOKEN: 1 } }] } }, /ci\.setup\[0\]\.env\.TOKEN must be a string/u],
  ]) {
    const issues = validateWorkflowConfig({ ...baseConfig(), ...config });
    assert.ok(issues.some((issue) => message.test(issue)), `${JSON.stringify(config)} → ${issues.join('; ')}`);
  }
});

test('ci.setup runs each declared step in order and stops at the first failure', async () => {
  const config = {
    ...baseConfig(),
    ci: {
      setup: [
        { name: 'first', run: 'process.exit(0)', shell: 'node' },
        { name: 'second', run: 'process.exit(3)', shell: 'node' },
        { name: 'never', run: 'process.exit(0)', shell: 'node' },
      ],
    },
  };
  const result = await runCiSetupPlan(config, { env: process.env });
  assert.equal(result.ok, false);
  assert.deepEqual(result.steps.map((step) => step.name), ['first', 'second']);

  const ok = await runCiSetupPlan({
    ...baseConfig(),
    ci: { setup: [{ name: 'ok', run: 'process.exit(0)', shell: 'node' }] },
  }, { env: process.env });
  assert.equal(ok.ok, true);
});
