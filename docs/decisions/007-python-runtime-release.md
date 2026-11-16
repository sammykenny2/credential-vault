# ADR-007: Use tested Python 3.15.2 for the container runtime

## Status

Accepted after independent review and passing CI, Docker builds and the unchanged
fixable High/Critical image vulnerability scan, 2026-11-16. Python 3.14 and 3.15
application jobs both passed; actual deployment health is recorded in PLAN-006.

## Context

The v0.5.0 release build passed all application tests and dependency audits, but
Grype blocked the pinned Python 3.14.10 runtime on CVE-2026-119170. The Python
Software Foundation states that this FIPS regression affects only 3.14.10.
Although the scanner lists 3.14.11 as a fix, that official Docker image is not
available. Returning to 3.14.9 would lose security fixes introduced by 3.14.10.
The project already supports Python 3.14+ and its universal lock includes 3.15.

## Decision

Use the available stable official `python:3.15.2-slim` image, pinned to its verified
multi-platform index digest:
`sha256:65a65fc7b30b06cb6df4930fd4650697cb23f4c2698ab81fc87e4b031bc36928`.
Builder and runtime stages use the same digest. Expand the application CI matrix
to Python 3.14 and 3.15, retaining the existing minimum supported development
version. Do not add CVE ignore rules, lower scan thresholds or bypass release
attestation. Keep the hashed dependency lock unchanged.

## Consequences

- The container avoids the affected 3.14.10 interpreter without dropping the
  security fixes it introduced. Application compatibility with 3.15 is explicitly
  tested before merge and deployment.
- Development on 3.14 remains supported. CI runs an additional backend test job.
- This changes the runtime minor version, so real image health and deployment
  version checks remain necessary; the usual pre-deploy backup is retained.

## Alternatives considered

- Wait for the unavailable 3.14.11 image: prevents completing this authorized
  deployment now.
- Return to 3.14.9: loses other 3.14.10 security fixes.
- Suppress the conditional FIPS finding: unnecessary when a supported, tested
  unaffected stable interpreter is available.

## Primary sources

Accessed 2026-11-16:

- [PSF security advisory](https://mail.python.org/archives/list/security-announce@python.org/thread/PXVTTOBPUMFJSSUXN6XCS7FC5DZOSZXK/)
- [Python 3.14.10 security changes](https://www.python.org/downloads/release/python-31410/)
- Official Docker registry metadata resolved with `docker buildx imagetools inspect
  python:3.15.2-slim`; image version is 3.15.2, base distribution Debian trixie.
- [Blocked release scan](https://github.com/sammykenny2/credential-vault/actions/runs/43823825593)
