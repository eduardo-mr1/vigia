# Vigía

**A GitHub Action that flags tests which pass without verifying anything.**

A green suite is not the same as a tested codebase. Vigía reads the test files touched by a pull request, finds the ones that can never fail, and comments on the exact line — before the branch merges and the false confidence becomes permanent.

[![CI](https://github.com/eduardo-mr1/vigia/actions/workflows/ci.yml/badge.svg)](https://github.com/eduardo-mr1/vigia/actions)
![License](https://img.shields.io/badge/license-MIT-green)

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

## What it detects

Seven checks, all built on the same idea: a test that can't fail is worse than no test, because it occupies the place of one that would.

| Rule | Severity | Example |
|---|---|---|
| **No assertion** | P1 | A test body that never calls an assertion |
| **`expect()` without a matcher** | P1 | `expect(result)` with no `.toBe(...)` chained after it |
| **Tautology** | P1 | `expect(true).toBe(true)`, comparing a literal to itself |
| **Missing `await`** | P1 | `expect(promise).rejects.toThrow()` with no `await` — the test ends before the promise settles |
| **Focused test (`.only`)** | P1 | `it.only(...)` silently skips the rest of the suite in CI |
| **Skipped test** | P3 | `it.skip` / `xit` left behind past its reason for existing |
| **Orphan negative assertion** | P1 / P2 | `queryByTestId('x')` expected to be null/absent, but `"x"` never appears anywhere in the source — the assertion can't fail because the thing it denies doesn't exist |

The first six run on any Jest-style test file, with native support for Cypress (`.should()`, `.and()`), Chai (`assert.*`) and Playwright's async locator matchers (`toBeVisible`, `toHaveText`, etc. — every Playwright assertion is a promise, so a missing `await` is invisible on the page but silent in the suite). The seventh needs `--src` pointed at your source root, and also reads Maestro YAML flows for the same defect in E2E specs.

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
      pull-requests: write   # required to post the comment
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: eduardo-mr1/vigia@v1
```

By default it only analyzes the test files changed in the PR, so it stays fast and never floods an existing codebase with legacy findings.

### Inputs

| Input | Default | Description |
|---|---|---|
| `ruta` | `.` | Directory to analyze when not limited to the PR's changed files |
| `solo-cambios` | `true` | Analyze only the test files touched by the PR |
| `codigo-fuente` | — | Path to your source root. Set this to enable orphan-negative-assertion detection |
| `fallar-en-p1` | `true` | Fail the job when a P1 finding is present |
| `comentar` | `true` | Post the report as a sticky PR comment |

```yaml
      - uses: eduardo-mr1/vigia@v1
        with:
          codigo-fuente: 'src'
          fallar-en-p1: 'true'
```

You can also run it as a CLI, outside of CI:

```bash
npx vigia src/**/*.test.ts --src src --format markdown
```

---

## How it works

Vigía parses every test file with the TypeScript compiler API (`ts.createSourceFile`) instead of matching text — an `expect` inside a comment or a string literal isn't an assertion, and only the syntax tree can tell the difference. For every `it`/`test` block (including chained forms like `it.skip.each`), it walks the body looking for a call that can actually fail: `expect(...)`, `.should()`/`.and()` (Cypress), or `assert.*` (Chai).

The orphan-negative-assertion check works differently: it scans your **source** for every `testID` / `data-testid` literal and template prefix (`` testID={`gasto-${id}`} `` → prefix `gasto-`), then cross-references every negative assertion in your **tests** (`expect(queryByTestId('x')).toBeNull()`, or `assertNotVisible` in a Maestro flow) against that set. An identifier the source can never produce means the assertion passes by definition — it isn't testing absence, it's testing a typo.

Written in TypeScript. Vigía never executes your tests — it only reads them, so it stays fast even on large suites.

---

## Vigía tests itself

The tool that polices assertions isn't exempt from them: **129 tests across 4 suites**, every rule covered by both a positive and a negative fixture, and a dedicated `autoanálisis` CI job that runs Vigía against its own `src/` on every push.

```bash
npm test              # 129 tests
node dist/cli.js src  # Vigía, on Vigía
```

`ejemplo/carrito.test.ts` is a live fixture with all six static-analysis defects in one small file — a shopping-cart test suite that's fully green in Jest and verifies nothing:

```
$ node dist/cli.js ejemplo

ejemplo/carrito.test.ts:8:3   P1  sin-assercion       La prueba "calcula el total" no contiene ninguna aserción.
ejemplo/carrito.test.ts:14:5  P1  expect-sin-matcher  expect() sin matcher encadenado.
ejemplo/carrito.test.ts:18:5  P1  tautologia          expect(true) comparado consigo mismo.
ejemplo/carrito.test.ts:21:3  P3  prueba-omitida      "valida el cupón vencido" está omitida.
ejemplo/carrito.test.ts:25:3  P1  prueba-enfocada     "suma con impuestos" usa .only: el resto de la suite no se ejecuta.
ejemplo/carrito.test.ts:31:5  P1  await-faltante      expect(...).rejects sin await: la prueba termina antes de comprobar nada.

6 hallazgo(s): 5 P1, 0 P2, 1 P3
```

---

## Limitations

Worth stating plainly, because a linter you can't trust is worse than none:

- **It reasons about structure, not meaning.** A test with one weak assertion passes Vigía and still proves little. Vigía raises the floor; it doesn't measure quality.
- **Custom assertion helpers** that wrap `expect` internally aren't recognized unless they match a known pattern — they read as absent.
- **Only JavaScript and TypeScript**, plus Maestro YAML flows for the orphan-assertion check.
- **Not yet run against a real production PR stream.** It's fully built and fully tested against its own fixtures; the next milestone is piloting it on a live repository.

---

## Why I built it

I lead QA for a mobile product where a passing suite is the gate before release. The case that triggered this: an E2E flow asserted that an element was *not* visible — using an identifier the app never actually generates. The assertion passed on every run, for weeks, without checking anything. A test that verifies nothing doesn't just fail to catch a bug; it actively hides that the case was never covered, which is worse than having no test at all. Reviewers miss this pattern consistently, and no existing tool was looking for it. So I wrote the one that does.

---

## License

MIT — see [LICENSE](LICENSE).
