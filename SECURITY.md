# Security policy

## Supported versions

Vetryn is pre-alpha and has no supported production release yet. Once packages are published, this table
will list the maintained release lines.

| Version           | Supported        |
| ----------------- | ---------------- |
| Unreleased `main` | Development only |

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability.

Use GitHub's private vulnerability reporting for this repository:

<https://github.com/Clyra-AI/vetryn/security/advisories/new>

Include:

- the affected component and version or commit;
- reproduction steps or a proof of concept;
- the expected impact;
- any known mitigations; and
- whether disclosure is time-sensitive.

Maintainers will acknowledge a complete report as soon as reasonably possible, coordinate validation and
remediation privately, and credit reporters who want attribution. Please allow maintainers a reasonable
opportunity to ship a fix before public disclosure.

## Security principles

- Vetryn does not store or proxy provider credentials.
- Model output and catalog data are treated as untrusted input.
- Evaluation and mutation workflows are separated.
- GitHub workflows using model credentials run only trusted default-branch code.
- Automated patches are rejected when source identity or evidence is stale.
- Raw prompts and outputs are excluded from public reports by default.
