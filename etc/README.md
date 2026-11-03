# SDKWork GitHub Workflow Source Configuration

Entrypoint: `etc/sdkwork.deployment.config.json`.

- `topology/` owns inherited topology layers and the resolved profile env files.
- `templates/` owns safe, non-secret templates.

Validate:

```bash
node ../sdkwork-specs/tools/check-source-config-standard.mjs --root .
node ../sdkwork-specs/tools/materialize-topology-env.mjs --root . --check
```
