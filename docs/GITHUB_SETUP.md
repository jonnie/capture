# GitHub repository setup

These are **owner/admin repository settings**, separate from files committed to Git. A key that can push commits does not by itself grant API access to change them. Never paste a personal access token into an issue, report, workflow, or this repository.

## Protect `main`

In [Settings → Rules → Rulesets](https://github.com/jonnie/capture/settings/rules), create an **active branch ruleset** targeting `refs/heads/main` with:

- Restrict deletions and block force pushes.
- Require a pull request before merging, with **zero required approvals** so a solo maintainer can merge after checks pass.
- Require conversations to be resolved.
- Require status checks, and require the branch to be up to date before merging:
  - `Smoke (ubuntu-latest, Python 3.10)`
  - `Smoke (ubuntu-latest, Python 3.13)`
  - `Smoke (macos-latest, Python 3.11)`
  - `Lint and typecheck`

The ready-to-import payload is [`.github/main-ruleset.json`](../.github/main-ruleset.json). Use **New ruleset → Import a ruleset** to upload it, then inspect and save it. The required checks are bound to the GitHub Actions app (integration ID `15368`) and match the job names in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml).

Alternatively, with the GitHub CLI authenticated and repository administration access, inspect existing rulesets and create this one **only if an equivalent one does not already exist**:

```sh
gh auth login --hostname github.com --web
gh api repos/jonnie/capture/rulesets
gh api --method POST repos/jonnie/capture/rulesets \
  --input .github/main-ruleset.json
```

For an existing equivalent ruleset, edit it in the UI rather than creating a duplicate. Verify it shows **Active** and covers `main`; keeping the JSON in Git does not itself apply protection.

Apply protection **after** the initial release-preparation commit has been pushed. Future changes should use branches and pull requests. An active ruleset applies to direct pushes too; a key is not an automatic bypass.

## Security and dependencies

In [Settings → Code security](https://github.com/jonnie/capture/settings/security_analysis), verify:

- Dependency graph is enabled (enabled automatically for public repositories).
- Dependabot alerts are enabled.
- Dependabot security updates are enabled. These open pull requests; they do not authorize automatic merging.
- Private vulnerability reporting is enabled, matching `SECURITY.md`.

[`.github/dependabot.yml`](../.github/dependabot.yml) schedules weekly Monday updates at 07:00 UTC for GitHub Actions and Python development dependencies, with a five-PR limit per ecosystem. Review each update through CI; do not combine automatic dependency updating with automatic merging or release publication.

With an authenticated CLI and appropriate permissions, alert/security-update settings can also be enabled explicitly:

```sh
gh api --method PUT repos/jonnie/capture/vulnerability-alerts
gh api --method PUT repos/jonnie/capture/automated-security-fixes
```

Account/organization policies may restrict these options. Inspect the resulting settings rather than assuming a configuration file enabled every server-side feature.

## Repository presentation

In [repository settings](https://github.com/jonnie/capture/settings), set:

- **Description:** `Capture anything the moment it occurs to you — a local-first web capture app with LLM auto-tagging and an MCP endpoint for agents.`
- **Topics:** `python`, `fastapi`, `mcp`, `llm`, `sqlite`, `notes`, `productivity`, `self-hosted`.
- **Website:** an optional landing page. The owner's public GitHub profile lists `https://jonnie.github.io`; confirm that is the intended destination before applying it.

The description and topics are also editable from the repository's **About** panel. Review the rendered README, license, and contributor/security links.

For an authenticated CLI, description and topics can be applied without choosing a website:

```sh
gh repo edit jonnie/capture \
  --description 'Capture anything the moment it occurs to you — a local-first web capture app with LLM auto-tagging and an MCP endpoint for agents.' \
  --add-topic python,fastapi,mcp,llm,sqlite,notes,productivity,self-hosted
```

## Release policy

The `Release` workflow publishes a GitHub release — the changelog entry for the version plus the built source and wheel distributions — for maintainer-pushed version tags (`vX.Y.Z`); it does not publish to PyPI or modify branch/security settings. Only the publication job receives `contents: write`; CI and dependency-update pull requests receive no write tokens or secrets.

Bump `version` in `pyproject.toml` and `__version__` in `src/capture/__init__.py` together, add a versioned `CHANGELOG.md` entry, then push the matching `vX.Y.Z` tag to publish.
