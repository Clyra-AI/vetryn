# Releasing

Vetryn has not published a production package yet. This document defines the intended release discipline.

## Versioning

Publishable packages use Semantic Versioning. During `0.x`, minor releases may contain intentional public
contract changes when they are documented with migration guidance.

## Preparing a release

1. Confirm all user-visible changes contain a changeset.
2. Run `pnpm check` on the release commit.
3. Run `pnpm version-packages` on a dedicated release branch.
4. Review generated changelogs, package contents, and dependency versions.
5. Open and merge the release pull request.
6. Publish from a protected GitHub environment using npm trusted publishing and provenance.
7. Create signed GitHub release notes and attach generated SBOMs when the publishing workflow lands.

Maintainers must not publish packages from an unreviewed local working tree. The automated release workflow
will be added only after package namespace ownership and trusted publishing are configured.
