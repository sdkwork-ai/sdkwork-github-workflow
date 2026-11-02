/**
 * Canonical starter package targets for every client application mode.
 *
 * `agent-workflow.mjs init-app --runtime-targets <csv>` renders these; the
 * planner validates them against the package-mode table in
 * `agent-workflow.mjs`. Adding an application mode is a row here plus a
 * toolchain hook, never a new workflow (GITHUB_WORKFLOW_SPEC.md section 5).
 */

const TARGET = (target) => ({ ...target, formats: [...target.formats], outputGlobs: [...target.outputGlobs] });

/** Starter targets per runtime target, in canonical package-id spelling. */
export const RUNTIME_TARGET_STARTERS = Object.freeze({
  browser: [TARGET({
    id: 'web-universal-cloud-browser-web-url',
    profileBinding: 'fixed', deploymentProfile: 'cloud',
    runtimeTarget: 'browser', targetPlatform: 'web', clientArchitecture: 'pc-web',
    profile: 'browser', platform: 'web', architecture: 'universal',
    formats: ['web-url'], runner: 'ubuntu-24.04', outputGlobs: ['dist/web/**'],
  })],
  desktop: [
    TARGET({
      id: 'windows-x64-standalone-desktop-msi',
      profileBinding: 'fixed', deploymentProfile: 'standalone',
      runtimeTarget: 'desktop', targetPlatform: 'windows', clientArchitecture: 'tauri',
      profile: 'desktop', platform: 'windows', architecture: 'x64',
      formats: ['msi'], runner: 'windows-2022', outputGlobs: ['dist/desktop/*.msi'],
    }),
    TARGET({
      id: 'macos-arm64-standalone-desktop-dmg',
      profileBinding: 'fixed', deploymentProfile: 'standalone',
      runtimeTarget: 'desktop', targetPlatform: 'macos', clientArchitecture: 'tauri',
      profile: 'desktop', platform: 'macos', architecture: 'arm64',
      formats: ['dmg'], runner: 'macos-14', outputGlobs: ['dist/desktop/*.dmg'],
    }),
    TARGET({
      id: 'linux-x64-standalone-desktop-appimage',
      profileBinding: 'fixed', deploymentProfile: 'standalone',
      runtimeTarget: 'desktop', targetPlatform: 'linux', clientArchitecture: 'tauri',
      profile: 'desktop', platform: 'linux', architecture: 'x64',
      formats: ['appimage'], runner: 'ubuntu-24.04', outputGlobs: ['dist/desktop/*.AppImage'],
    }),
  ],
  'tablet-ipados': [TARGET({
    id: 'ipados-universal-standalone-tablet-ipa',
    profileBinding: 'fixed', deploymentProfile: 'standalone',
    runtimeTarget: 'tablet-ipados',
    profile: 'tablet', platform: 'ipados', architecture: 'universal',
    formats: ['ipa'], runner: 'macos-14', outputGlobs: ['build/ipados/ipa/*.ipa'],
  })],
  'tablet-android': [TARGET({
    id: 'android-tablet-arm64-standalone-tablet-aab',
    profileBinding: 'fixed', deploymentProfile: 'standalone',
    runtimeTarget: 'tablet-android',
    profile: 'tablet', platform: 'android-tablet', architecture: 'arm64',
    formats: ['aab'], runner: 'ubuntu-24.04', outputGlobs: ['build/app/outputs/bundle/tabletRelease/*.aab'],
  })],
  'capacitor-ios': [TARGET({
    id: 'ios-universal-standalone-mobile-ipa',
    profileBinding: 'fixed', deploymentProfile: 'standalone',
    runtimeTarget: 'capacitor-ios', targetPlatform: 'ios', clientArchitecture: 'capacitor',
    profile: 'mobile', platform: 'ios', architecture: 'universal',
    formats: ['ipa'], runner: 'macos-14', outputGlobs: ['build/ios/ipa/*.ipa'],
  })],
  'capacitor-android': [TARGET({
    id: 'android-arm64-standalone-mobile-aab',
    profileBinding: 'fixed', deploymentProfile: 'standalone',
    runtimeTarget: 'capacitor-android', targetPlatform: 'android', clientArchitecture: 'capacitor',
    profile: 'mobile', platform: 'android', architecture: 'arm64',
    formats: ['aab'], runner: 'ubuntu-24.04', outputGlobs: ['build/app/outputs/bundle/release/*.aab'],
  })],
  'flutter-ios': [TARGET({
    id: 'ios-universal-standalone-mobile-ipa',
    profileBinding: 'fixed', deploymentProfile: 'standalone',
    runtimeTarget: 'flutter-ios', targetPlatform: 'ios', clientArchitecture: 'flutter',
    profile: 'mobile', platform: 'ios', architecture: 'universal',
    formats: ['ipa'], runner: 'macos-14', outputGlobs: ['build/ios/ipa/*.ipa'],
  })],
  'flutter-android': [TARGET({
    id: 'android-arm64-standalone-mobile-aab',
    profileBinding: 'fixed', deploymentProfile: 'standalone',
    runtimeTarget: 'flutter-android', targetPlatform: 'android', clientArchitecture: 'flutter',
    profile: 'mobile', platform: 'android', architecture: 'arm64',
    formats: ['aab'], runner: 'ubuntu-24.04', outputGlobs: ['build/app/outputs/bundle/release/*.aab'],
  })],
  'android-native': [TARGET({
    id: 'android-arm64-standalone-mobile-aab',
    profileBinding: 'fixed', deploymentProfile: 'standalone',
    runtimeTarget: 'android-native', targetPlatform: 'android', clientArchitecture: 'android-native',
    profile: 'mobile', platform: 'android', architecture: 'arm64',
    formats: ['aab'], runner: 'ubuntu-24.04', outputGlobs: ['build/app/outputs/bundle/release/*.aab'],
  })],
  'ios-native': [TARGET({
    id: 'ios-universal-standalone-mobile-ipa',
    profileBinding: 'fixed', deploymentProfile: 'standalone',
    runtimeTarget: 'ios-native', targetPlatform: 'ios', clientArchitecture: 'ios-native',
    profile: 'mobile', platform: 'ios', architecture: 'universal',
    formats: ['ipa'], runner: 'macos-14', outputGlobs: ['build/ios/ipa/*.ipa'],
  })],
  'harmony-native': [TARGET({
    id: 'harmony-arm64-standalone-mobile-hap',
    profileBinding: 'fixed', deploymentProfile: 'standalone',
    runtimeTarget: 'harmony-native', targetPlatform: 'harmony', clientArchitecture: 'harmony-native',
    profile: 'mobile', platform: 'harmony', architecture: 'arm64',
    formats: ['hap'], runner: 'macos-14', outputGlobs: ['entry/build/default/outputs/default/*.hap'],
  })],
  'mini-program': [TARGET({
    id: 'mp-weixin-universal-cloud-mini-program-mini-program-package',
    profileBinding: 'fixed', deploymentProfile: 'cloud',
    runtimeTarget: 'mini-program', targetPlatform: 'mp-weixin', clientArchitecture: 'mini-program',
    profile: 'mini-program', platform: 'mp-weixin', architecture: 'universal',
    formats: ['mini-program-package'], runner: 'ubuntu-24.04', outputGlobs: ['dist/mini-program/**'],
  })],
  server: [TARGET({
    id: 'linux-x64-standalone-server-tar-gz',
    profileBinding: 'fixed', deploymentProfile: 'standalone',
    runtimeTarget: 'server',
    profile: 'server', platform: 'linux', architecture: 'x64',
    formats: ['tar.gz'], runner: 'ubuntu-24.04', outputGlobs: ['dist/server/*.tar.gz'],
  })],
  container: [TARGET({
    id: 'container-x64-cloud-container-oci',
    profileBinding: 'fixed', deploymentProfile: 'cloud',
    runtimeTarget: 'container',
    profile: 'container', platform: 'container', architecture: 'x64',
    formats: ['oci'], runner: 'ubuntu-24.04', outputGlobs: ['dist/container/*.tar'],
  })],
  'test-runner': [TARGET({
    id: 'test-noarch-test-test-zip',
    profileBinding: 'non-deployable',
    runtimeTarget: 'test-runner',
    profile: 'test', platform: 'test', architecture: 'noarch',
    formats: ['zip'], runner: 'ubuntu-24.04', outputGlobs: ['dist/test/*.zip'],
  })],
});

/** Runtime targets whose starter needs each extra toolchain beyond node/pnpm. */
const TOOLCHAIN_RUNTIME_TARGETS = Object.freeze({
  java: ['capacitor-android', 'flutter-android', 'android-native', 'tablet-android'],
  android: ['capacitor-android', 'flutter-android', 'android-native', 'tablet-android'],
  xcode: ['capacitor-ios', 'flutter-ios', 'ios-native', 'tablet-ipados'],
  flutter: ['flutter-ios', 'flutter-android'],
});

/**
 * Render the starter targets for the requested application modes.
 * @param {string[]} runtimeTargets - Runtime targets to enrol.
 * @returns {object[]} Canonical starter targets.
 * @throws If a runtime target has no starter.
 */
export function defaultTargetsForRuntimeTargets(runtimeTargets) {
  return runtimeTargets.flatMap((runtimeTarget) => {
    const starters = RUNTIME_TARGET_STARTERS[runtimeTarget];
    if (starters === undefined) throw new Error(`Unsupported runtime target: ${runtimeTarget}`);
    return starters.map((target) => TARGET(target));
  });
}

/**
 * Render the toolchains the requested application modes need.
 * @param {string[]} runtimeTargets - Runtime targets to enrol.
 * @returns {Record<string, string|boolean>} Declared toolchains.
 */
export function defaultToolchainsForRuntimeTargets(runtimeTargets) {
  const toolchains = { node: '22', pnpm: '10.33.0' };
  for (const [toolchain, targets] of Object.entries(TOOLCHAIN_RUNTIME_TARGETS)) {
    if (!runtimeTargets.some((runtimeTarget) => targets.includes(runtimeTarget))) continue;
    toolchains[toolchain] = toolchain === 'java' ? '21' : toolchain === 'flutter' ? 'stable' : true;
  }
  if (runtimeTargets.includes('server')) toolchains.python = '3.12';
  return toolchains;
}

/**
 * List the runtime targets this module can scaffold.
 * @returns {string[]} Supported runtime targets.
 */
export function supportedRuntimeTargets() {
  return Object.keys(RUNTIME_TARGET_STARTERS);
}
