# ADR-0006 Knowledge vault lives in the Git repo
Context: no pre-configured external Obsidian vault directory exists in the
build environment, and dev containers are ephemeral.
Decision: GrovBase-Vault/ at repo root — a plain Obsidian-openable folder,
versioned and backed up with the code, referencing commits instead of
copying sources.
Alternatives: external vault (not reachable/durable from CI), wiki (splits
history). Consequence: docs ride PRs; vault must never contain secrets
(repo is the same trust domain as code). Reversal: trivial (move folder).
