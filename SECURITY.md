# Security Policy

## Supported versions

Only the latest release is supported. WyrmStar is a desktop application with
no server component, so "upgrading" means installing the current build from
the [releases page](https://github.com/GeoffreyIanWard/wyrmscript/releases).

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Use GitHub's [private vulnerability
reporting](https://github.com/GeoffreyIanWard/wyrmscript/security/advisories/new),
which creates a draft advisory only the maintainer can see.

Please include what an attacker could achieve, the steps to reproduce it, and
the version and operating system you saw it on. You will get an
acknowledgement within a week.

## What counts as a vulnerability here

WyrmStar is local-first and account-less. It has no server, no telemetry, and
no user accounts, so the usual web attack surface does not apply. What matters
for this application is:

- **Anything that can lose or corrupt a manuscript.** The app's central promise
  is that nothing is ever lost. A path that silently drops a draft, corrupts a
  git object store, or writes a checkpoint that cannot be restored is treated
  as a security issue even though nobody attacked anything.
- **Code execution from a project file.** A `.wyrm` project is a folder of
  Markdown and JSON that a writer may receive from someone else. Anything in
  that data that can run code, read files outside the project, or reach the
  network is serious.
- **Credential exposure.** The GitHub sync feature stores an OAuth token. Any
  path that writes it somewhere readable, logs it, or sends it anywhere other
  than GitHub is serious.
- **Renderer sandbox escapes** — anything that lets manuscript content reach
  Node APIs through the preload bridge.

## What does not

- Vulnerabilities requiring an attacker who already has write access to the
  user's filesystem. At that point the manuscript is theirs anyway.
- Dependency advisories with no reachable path from this application. Please
  do still report them, but they are handled as ordinary maintenance.
- The unsigned builds. Releases are not code-signed or notarized yet, and both
  macOS and Windows warn on first launch. This is a known gap, not a report.
