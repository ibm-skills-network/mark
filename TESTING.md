# Testing Guide

This guide covers end-to-end testing with Playwright for the Mark platform.

## Quick Start

Install Playwright browser binaries the first time:

```bash
yarn playwright:install
```

Prepare the Playwright setup state:

```bash
yarn test:setup
```

Run the local default suite:

```bash
yarn test:e2e
```

Useful variants:

```bash
# Full browser matrix
yarn test:e2e:all

# Role-focused suites across the full matrix
yarn playwright:author
yarn playwright:learner

# Raw Playwright still uses the full project matrix from playwright.config.ts
yarn playwright test
```

## Startup Model

Playwright owns the local E2E startup path through the `webServer` block in [playwright.config.ts](./playwright.config.ts).

On a cold start, `yarn start:e2e` does the following:

- Runs shared preflight checks for dependencies, Docker/Postgres, Prisma generation, env validation, and port availability
- Builds the web app with merged `dev.env` and `apps/web/.env.local`
- Starts the API, API gateway, and web app in non-watch mode
- Waits for the API and gateway readiness endpoints before handing control back to Playwright
- Lets Playwright perform the final web URL availability check

On a warm local rerun, Playwright reuses an existing server when `http://localhost:3010` is already available.

## Setup Project

The `setup` Playwright project is responsible for preparing test state. It:

- Creates or validates the cached learner and author assignments
- Writes assignment metadata to `playwright/.cache/assignments.json`
- Writes storage state files to `playwright/.auth/learner.json` and `playwright/.auth/author.json`

`yarn test:setup` and every suite that depends on the `setup` project use the same startup path. You do not need to run `yarn dev` first.

## Project Layout

Playwright projects are defined in [playwright.config.ts](./playwright.config.ts):

- `setup`
- `author-chromium`, `author-firefox`, `author-webkit`
- `learner-chromium`, `learner-firefox`, `learner-webkit`

The local default command intentionally runs only:

- `author-chromium`
- `learner-chromium`

The setup dependency is still included automatically.

## Writing Tests

Tests should use the shared fixture from [tests/helpers/e2e-test.ts](./tests/helpers/e2e-test.ts). That fixture exposes cached assignment IDs and uses the per-project storage state prepared by the setup project.

Example:

```typescript
import { test, expect } from "../helpers/e2e-test";

test.describe("Learner - Assignment Homepage", () => {
  test.beforeEach(async ({ page, assignmentIds }) => {
    await page.goto(`/learner/${assignmentIds.learner.id}?lang=en`);
  });

  test("shows the assignment title", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "Playwright Assignment" }),
    ).toBeVisible();
  });
});
```

Keep tests organized under:

- `tests/author/`
- `tests/learner/`
- `tests/setup/`

## Useful Commands

```bash
# Show which projects/tests will run
yarn test:e2e --list
yarn test:e2e:all --list

# Headed or debug runs through raw Playwright
yarn playwright test --project=author-chromium --headed
yarn playwright test --project=learner-chromium --debug

# Single-file run
yarn playwright test tests/learner/learner-homepage.spec.ts

# Open the HTML report
yarn playwright:report
```

## Generated State

Playwright-generated local state lives under:

```text
playwright/.cache/assignments.json
playwright/.auth/author.json
playwright/.auth/learner.json
```

To force a clean setup run:

```bash
rm -rf playwright/.cache playwright/.auth
yarn test:setup
```

## Troubleshooting

If browser binaries are missing:

```bash
yarn playwright:install
```

If startup fails before tests begin:

- Check `dev.env` and `apps/web/.env.local`
- Make sure Docker/Postgres is running
- Make sure the configured ports are free

If setup state looks stale:

```bash
rm -rf playwright/.cache playwright/.auth
yarn test:setup
```

If you want to inspect readiness manually:

```bash
curl http://localhost:4222/health/readiness
curl http://localhost:8000/health/readiness
```

## CI

GitHub Actions runs the explicit full-matrix suite:

```bash
yarn test:e2e:all
```

## Additional Resources

- [Playwright Documentation](https://playwright.dev/)
- [SETUP.md](./SETUP.md)
