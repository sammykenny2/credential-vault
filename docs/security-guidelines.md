# Security Guidelines

> Internal security policies and best practices for development.

## Overview

This document outlines security practices for developers and AI agents working on this project.

## Sensitive Data Handling

### Never Commit

- API keys and secrets
- Passwords and credentials
- Private keys and certificates
- Personal identifiable information (PII)

### Environment Variables

```bash
# CORRECT: Use .env (not committed)
DATABASE_URL=sqlite+aiosqlite:///data/credential_vault.db

# Provide template in .env.example (committed)
# DATABASE_URL=sqlite+aiosqlite:///data/credential_vault.db
```

### Pre-commit Check

Before committing, verify:
- [ ] No secrets in code
- [ ] No hardcoded credentials
- [ ] `.env` is in `.gitignore`

## Code Security

### Input Validation

- Validate all user inputs
- Sanitize data before database queries
- Use parameterized queries (prevent SQL injection)

### Authentication & Authorization

- Verify a vault public key against the public components derived from the
  KEK-protected private key before storing session keys or encrypting any data.
- Separate RSA-OAEP operations by purpose. The current proof protocol uses
  `credential-vault/vault-proof/v1`; its frontend and backend must be deployed
  together. A stale frontend must refresh, never retry with another label.
- Vault session private keys stay non-extractable. New backup passwords require
  at least 12 characters; the UI can generate a 32-character CSPRNG password.
  Older backups remain readable with their original password.
- Every credential value input uses `secretFieldProps`, regardless of template
  masking flags or field type. Masking is a display preference, not an encryption
  or cloud spell-check boundary.
- [ADR-004](decisions/004-vault-authenticity-and-key-trust.md) and
  [SPEC-004](specs/SPEC-004-structured-credentials-and-attachments.md) define the
  proposed signed data, padding, guarded streaming, quotas and durability rules.
  Those future requirements must not be described as already implemented.

### Dependencies

- Keep dependencies updated
- Review security advisories
- Use lockfiles (`package-lock.json`, `poetry.lock`)

## Agent-Specific Rules

AI agents MUST NOT:

- Execute destructive commands (`rm -rf /`, `DROP DATABASE`, etc.)
- Access files outside project directory without explicit permission
- Commit secrets or credentials
- Disable security features

AI agents SHOULD:

- Flag potential security issues when reviewing code
- Suggest security improvements
- Follow principle of least privilege

## Incident Response

If a security issue is discovered:

1. Do not commit the vulnerability
2. Report to project maintainer
3. Document in `docs/decisions/` after resolution

## Resources

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [CWE Top 25](https://cwe.mitre.org/top25/)

---

*Last updated: 2026-11-05*
