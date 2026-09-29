<!--
Thank you for contributing! Please read CONTRIBUTING.md first. You can write in English or Turkish.
Tick only what is true; leave an item unticked and explain it below when it does not apply.
-->

## What and why

<!-- What does this change, and why? Link the issue, e.g. "Fixes #123". -->

## How it was tested

<!--
The exact commands you ran and the summary lines of their output, for example:
  npm test -> Test Files 40 passed (40), Tests 406 passed (406)
Say what you did NOT test. "Should work" is not a test result. Microsoft Office is not used for tests: do not
claim Office compatibility you could not check.
-->

## Screenshots

<!-- For UI changes: screenshots or a short recording of the real application, Turkish and English UI, no personal
data or confidential documents on screen. Delete this section otherwise. -->

## Checklist

- [ ] `npm run lint`, `npm run typecheck` and `npm test` pass locally
- [ ] Engine-related changes: `npm run test:engine` passes (or I explain above why it could not run)
- [ ] New behaviour is covered by tests; a bug fix comes with a test that fails without the fix
- [ ] User-facing text is added in **both** Turkish and English (`src/renderer/i18n/locales/{tr,en}`), and in the
      main-process strings where applicable
- [ ] No untested claims: code comments, documentation and this description say only what was actually tested
- [ ] UI changes: screenshots attached; keyboard access, focus order and accessible names checked
- [ ] New `.uno:` commands exist in the engine's command registry and are listed in `src/shared/commands.ts`
- [ ] New dependencies: the license is allowed (see ADR 0006) and `npm run notices` was run
- [ ] No telemetry, no network access at run time, no document content in logs
- [ ] Sample documents are my own or permissively licensed, contain no personal data, and are documented as
      described in docs/TESTING.md
- [ ] Documentation updated where behaviour changed (`docs/COMPATIBILITY.md`, `docs/KNOWN_LIMITATIONS.md`,
      `CHANGELOG.md` under "Unreleased")
