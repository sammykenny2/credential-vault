# Release dependency audit: 2026-11-16

PR #20's first CI run passed all 342 backend and 426 frontend tests, but its
Python dependency audit reported two existing locked dependencies with fixes:

| Package | Locked | Patched | Primary advisory |
|---------|--------|---------|------------------|
| dnspython | 2.9.0 | 2.9.2 | [CVE-2026-128089](https://github.com/rthalley/dnspython/security/advisories/GHSA-vvf4-9x63-8xvv) |
| opentelemetry-api | 1.45.1 | 1.45.2 | [CVE-2026-126360](https://github.com/open-telemetry/opentelemetry-python/security/advisories/GHSA-mf5v-w3w3-f6cg) |

Both advisories describe denial-of-service conditions under their documented input
paths. This record does not claim that those paths are exploitable in this app.
Update only these two locked packages with the project's pinned uv 0.12.24, then
rerun CI including the dependency audit before merging or deploying v0.5.0.

Sources accessed 2026-11-16. [First CI run](https://github.com/sammykenny2/credential-vault/actions/runs/43822554324).

The subsequent dependency audit passed. The main release image scan then blocked
Python 3.14.10 on CVE-2026-119170. The official 3.14.11 Docker image was unavailable;
[ADR-007](../decisions/007-python-runtime-release.md) records the tested 3.15.2
runtime replacement, without weakening or suppressing the release scan.
