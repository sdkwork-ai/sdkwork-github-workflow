import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  initApplicationWorkflow,
  SUPPORTED_RUNTIME_TARGETS,
  validateWorkflowConfig,
} from '../scripts/agent-workflow.mjs';
import {
  defaultTargetsForRuntimeTargets,
  defaultToolchainsForRuntimeTargets,
  supportedRuntimeTargets,
} from '../scripts/package-mode-starters.mjs';

test('every application mode has a starter that the planner accepts', () => {
  for (const runtimeTarget of supportedRuntimeTargets()) {
    const targets = defaultTargetsForRuntimeTargets([runtimeTarget]);
    assert.ok(targets.length > 0, `${runtimeTarget} has no starter`);
    for (const target of targets) {
      assert.equal(target.runtimeTarget, runtimeTarget);
    }
  }
});

test('the starter table covers every runtime target the planner accepts', () => {
  // A runtime target without a starter is an application mode the framework
  // validates but cannot scaffold; the two vocabularies must stay identical.
  assert.deepEqual(
    [...supportedRuntimeTargets()].sort(),
    [...SUPPORTED_RUNTIME_TARGETS].sort(),
  );
});

test('each mode starter renders a valid workflow configuration', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'package-modes-'));
  try {
    for (const runtimeTarget of supportedRuntimeTargets()) {
      const appRoot = path.join(root, runtimeTarget.replaceAll('-', '_'));
      await initApplicationWorkflow({
        root: appRoot,
        appId: `mode-${runtimeTarget}`,
        repository: 'sdkwork-ai/mode-demo',
        runtimeTargets: [runtimeTarget],
      });
      const config = JSON.parse(await readFile(path.join(appRoot, 'agent.workflow.json'), 'utf8'));
      assert.deepEqual(validateWorkflowConfig(config), [], `${runtimeTarget}: ${JSON.stringify(validateWorkflowConfig(config))}`);
      assert.ok(config.targets.every((target) => target.runtimeTarget === runtimeTarget));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('mobile frameworks enrol the toolchains their mode needs', () => {
  assert.deepEqual(defaultToolchainsForRuntimeTargets(['android-native']), {
    node: '22', pnpm: '10.33.0', java: '21', android: true,
  });
  assert.equal(defaultToolchainsForRuntimeTargets(['harmony-native']).android, undefined);
  const ios = defaultToolchainsForRuntimeTargets(['capacitor-ios']);
  assert.equal(ios.xcode, true);
  assert.equal(defaultToolchainsForRuntimeTargets(['flutter-android']).flutter, 'stable');
});

test('harmony mode produces a HAP artifact on a Harmony host', () => {
  const [target] = defaultTargetsForRuntimeTargets(['harmony-native']);
  assert.equal(target.platform, 'harmony');
  assert.deepEqual(target.formats, ['hap']);
  assert.match(target.id, /-mobile-hap$/u);
});

test('an unknown application mode is refused instead of silently scaffolded', () => {
  assert.throws(() => defaultTargetsForRuntimeTargets(['symbian-native']), /Unsupported runtime target/u);
});
