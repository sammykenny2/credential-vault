# ADR-002: Hash Sign-In Passwords with Argon2id (argon2-cffi) Instead of passlib/bcrypt

> Architecture Decision Record

## Status

Accepted (2026-10-25)

## Context

The server stores one kind of password hash: the optional sign-in password of an admin (`/admin/setup`, the Settings page, `ADMIN_PASSWORD`, `vault-cli create-admin`), checked by `POST /auth/login`. Vault passwords never reach the server; they are stretched with Argon2id in the browser.

Those hashes were made by passlib 1.7.4 with bcrypt. passlib has had no release since 2020 and does not work with bcrypt 4 or later, so `pyproject.toml` pinned `bcrypt<4.0.0`. Dependabot's first run proposed bcrypt 5.0.0, which broke the tests. bcrypt also reads only the first 72 bytes of a password, so the API refused longer passwords.

No credentials were stored yet, so a database reset was acceptable and no migration of existing hashes was needed.

## Decision

- Hash sign-in passwords with Argon2id through `argon2-cffi`'s `PasswordHasher`, using its defaults (the RFC 9106 low-memory profile: t=3, m=64 MiB, p=4). Remove passlib and bcrypt.
- `verify_password` returns `False` both for a wrong password and for anything that is not an Argon2 hash, such as a bcrypt hash from before the switch. It does the same Argon2 work in both cases, so timing does not tell them apart. An unknown address still verifies against a dummy hash.
- On a successful `POST /auth/login`, a hash made with weaker parameters is rehashed with the current ones (`check_needs_rehash`), so the parameters can be raised later without another reset.
- New passwords must be 8 to 1024 characters. Login and verify requests accept up to 1024 characters. There is no 72-byte limit any more; the upper bound only limits request size.

## Consequences

### Positive

- Argon2id is the first choice in OWASP's password storage guidance. It is memory-hard, unlike bcrypt.
- One maintained library replaces an unmaintained one together with its pinned dependency. Dependabot can update it like any other package.
- Long passphrases are accepted and used in full.

### Negative

- bcrypt hashes stored before the switch no longer verify: that admin cannot use password login until the database is reset or a new password is set. Google sign-in is unaffected.
- Each verification takes about 200 ms and 64 MiB of memory (measured on the development machine). It runs on the event loop, so other requests wait during a sign-in. In return only one runs at a time, which keeps the peak far below the backend's 512 MB limit. Rate limiting already bounds login attempts.

### Neutral

- The vault itself (browser-side Argon2id via hash-wasm, RSA-OAEP, AES-256-GCM) is unchanged.

## Alternatives Considered

### Alternative 1: Keep bcrypt, drop passlib

- **Pros**: Smallest change; the hash format stays the same.
- **Cons**: Keeps the 72-byte limit. bcrypt 5 raises an error for longer input, so the length check would have to move into our code.
- **Why rejected**: Argon2id is the stronger default, and with no stored data there was nothing to stay compatible with.

### Alternative 2: Move `verify` to a thread pool

- **Pros**: The event loop would not block for the ~200 ms a verification takes.
- **Cons**: Several 64 MiB hashes could run at once and approach the container memory limit.
- **Why rejected**: Sign-in is rare in a personal vault, and running one verification at a time keeps memory bounded.
