# Contributing to Capture

Thanks for helping improve Capture. Bug reports, documentation improvements, UI refinements, and new features are welcome.

## Before opening an issue

Search [existing issues](https://github.com/jonnie/capture/issues). Report your Python version, OS and architecture, the relevant `settings.yaml` values (with any secrets or personal content redacted), the exact command you ran, and a minimal reproduction. Report vulnerabilities using [SECURITY.md](SECURITY.md), not public issues.

## Development setup

Python 3.10+ is required.

```sh
python3 -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -e '.[dev]'
cp example.settings.yaml settings.yaml   # create a local config from the example

# run the checks
.venv/bin/python -m unittest discover -s tests -v
.venv/bin/python -m ruff check .
.venv/bin/python -m ruff format --check .
```

The checks run offline: the smoke test disables LLM auto-tagging and uses a throwaway SQLite file, so no model endpoint or network access is needed.

## Running it locally

```sh
.venv/bin/capture            # or: .venv/bin/python -m capture
```

Then open <http://localhost:8000>. Point `llm.url`/`llm.model` in `settings.yaml` at any OpenAI-compatible endpoint to enable auto-tagging; set `llm.enabled: no` to tag everything `inbox`.

## Changes and pull requests

- Keep changes focused and describe their user-visible impact and how you validated them.
- Add or extend the smoke test in `tests/test_smoke.py` for API changes.
- Update [README.md](README.md) and [CHANGELOG.md](CHANGELOG.md) for user-visible changes.
- Preserve the local-first guarantees: a capture is saved even when the LLM is unavailable, everything lives in a single local SQLite file, and personal `settings.yaml` is never committed.
- Do not commit `settings.yaml`, `data/`, virtual environments, or any personal configuration.
- By contributing, you agree to license your contribution under the project's MIT license and confirm you have the right to contribute it. Third-party code must have a compatible license and appropriate attribution.
