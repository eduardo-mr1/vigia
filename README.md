# Vigía

**A GitHub Action that flags tests which pass without verifying anything.**

A green suite is not the same as a tested codebase. Vigía reads the tests changed in a pull request, finds the ones that can never fail, and comments on the exact lines — before the branch merges and the false confidence becomes permanent.

<!-- TODO: badges. Replace OWNER/REPO and remove the ones you don't use.
[![CI](https://github.com/eduardo-mr1/vigia/actions/workflows/ci.yml/badge.svg)](https://github.com/eduardo-mr1/vigia/actions)
[![Marketplace](https://img.shields.io/badge/marketplace-vig%C3%ADa-blue?logo=github)](https://github.com/marketplace/actions/vigia)
![License](https://img.shields.io/badge/license-MIT-green)
-->

---

## The problem

Every team has this test:

```js
it('creates the order', async () => {
  const order = await createOrder(payload)
  // ...and nothing else
})
```

It runs. It passes. It goes green on every commit for two years. It verifies nothing.

Coverage tools won't catch it — the line *was* executed. Code review won't catch it either, because reviewers read the diff for what it says, not for what it forgot to say. So the suite grows, the number goes up, and the confidence it buys is partly fictional.

Vigía is the check for that specific blind spot.

---

## Demo

<!-- TODO: record a 10-15s GIF of Vigía commenting on a real PR and drop it here.
     Suggested capture: open a PR that adds an assertion-free test → the Action runs →
     the comment appears inline on the offending line. Nothing else in frame.
     Tools: macOS screen recording + gifski, or Kap. Keep it under 3 MB or GitHub lazy-loads it.
     Put the file in docs/demo.gif -->

![Vigía commenting on a pull request](docs/demo.gif)

---

## What it detects

<!-- TODO: trim this list to what Vigía actually implements today. Delete the rest —
     an honest short list reads better than an aspirational long one. -->

| Pattern | Example |
|---|---|
| **No assertion at all** | A test body that never calls an assertion |
| **Tautological assertion** | `expect(true).toBe(true)`, `assert(1 === 1)` |
| **Unawaited async assertion** | `expect(promise).resolves.toBe(x)` with no `await` — resolves after the test ends |
| **Empty body** | `it('does the thing', () => {})` |
| **Permanently skipped** | `it.skip` / `xit` left behind past its TODO |

---

## Usage

Add one step to your workflow:

```yaml
# .github/workflows/vigia.yml
name: Vigía
on: pull_request

jobs:
  check:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write   # required to post the review comments
    steps:
      - uses: actions/checkout@v4
      - uses: eduardo-mr1/vigia@v1
```

That's the whole setup. Vigía only reads the test files touched by the PR, so it stays fast on large repos and never floods an existing codebase with legacy findings.

### Options

<!-- TODO: replace with your real inputs from action.yml -->

```yaml
      - uses: eduardo-mr1/vigia@v1
        with:
          paths: 'src/**/*.test.ts'   # glob for test files (default: common test globs)
          fail-on-find: false         # true to fail the check instead of only commenting
          ignore: 'legacy/**'         # globs to skip
```

| Input | Default | Description |
|---|---|---|
| `paths` | common test globs | Which files to analyse |
| `fail-on-find` | `false` | Fail the job when something is found |
| `ignore` | — | Globs to exclude |

---

## How it works

Vigía parses each changed test file into an AST rather than matching text, so it survives formatting, comments and unusual assertion styles. For every test block it walks the body looking for a call that can actually fail; if it doesn't find one, the block is reported with its line number.

<!-- TODO: one or two sentences on the specifics — which parser (ts-morph? @babel/parser?
     typescript compiler API?), how you identify a "test block", how you recognise an
     assertion call. This is the paragraph a technical reviewer reads closest. -->

Written in TypeScript. No runtime dependency on your test framework — Vigía never executes your tests, it only reads them.

---

## Vigía tests itself

The tooling that polices assertions is not exempt from them. The suite covers every detection rule with both a positive and a negative fixture, and Vigía runs against its own test files on every pull request.

<!-- TODO: put the real number here once you check: "N tests, M fixtures" -->

```bash
npm test
```

---

## Limitations

Worth stating plainly, because a linter you can't trust is worse than none:

- **It reasons about structure, not meaning.** A test with one weak assertion passes Vigía and still proves little. Vigía raises the floor; it does not measure quality.
- **Custom assertion helpers** need to be declared, or they read as absent. <!-- TODO: adjust if you auto-detect them -->
- **Only JavaScript and TypeScript** today. <!-- TODO: drop or update -->

---

## Why I built it

I lead QA for a mobile product where a passing suite is the gate before release. A test that verifies nothing doesn't just fail to catch a bug — it actively hides that the case was never covered, which is worse than having no test at all. Reviewers miss them consistently, and no existing tool was looking. So I wrote the one that does.

---

## License

MIT — see [LICENSE](LICENSE).
