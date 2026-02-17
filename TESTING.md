# Testing Guide

This guide covers end-to-end testing with Playwright for the Mark platform.

---

## Quick Start

### 1. Install Playwright Browsers

First time only, install Playwright browser binaries:

```bash
yarn playwright:install
```

This downloads Chromium, Firefox, and WebKit browsers (~300MB). Only needs to be run once.

### 2. Setup Test Environment

Before running tests for the first time, create test assignments:

```bash
yarn test:setup
```

This will:

- Wait for the API server to be ready (must already be running via `yarn dev`)
- Create two test assignments:
  - **Learner Assignment** (ID cached) - Pre-populated with questions for learner tests
  - **Author Assignment** (ID cached) - Empty assignment for authoring workflow tests
- Cache assignment IDs in `tests/playwright/.cache/assignments.json`

The cache file ensures tests use consistent assignment IDs across runs.

### 3. Run Tests

Run tests by role:

```bash
# Run only learner tests
yarn playwright:learner

# Run only author tests
yarn playwright:author

# Run all tests (both learner and author)
yarn playwright
```

---

## Test Architecture

### Role-Based Testing

Tests are organized by user role:

- **Learner Tests** (`tests/learner/`) - Test learner-facing features (taking assignments, viewing grades)
- **Author Tests** (`tests/author/`) - Test author-facing features (creating assignments, configuring settings)

Each test file includes role-based skipping to ensure tests only run for their intended role:

```typescript
test.beforeEach(async ({ page }) => {
  skipIfNotRole("learner"); // Skip if TEST_ROLE is set to "author"
  await setAuthCookie(page, "learner");
});
```

### Authentication System

Tests use cookie-based authentication:

1. **Test Helper**: `setAuthCookie(page, role)` sets an authentication cookie with the correct assignment ID for the role
2. **Assignment IDs**: Automatically loaded from cache file (`tests/playwright/.cache/assignments.json`)
3. **Mock Guard**: For local development, the mock guard in `apps/api-gateway/src/auth/jwt/cookie-based/mock.jwt.cookie.auth.guard.ts` is hard-coded with default values. Update the `assignmentId` in the mock guard to match either the learner or author assignment ID from the cache file.

This approach allows:

- Tests to authenticate with different roles and assignments via cookies
- Normal local development to work with a hard-coded assignment ID
- Role-based test isolation via `TEST_ROLE` environment variable

---

## Cache File

The cache file is located at:

```
tests/playwright/.cache/assignments.json
```

Format:

```json
{
  "learner": {
    "id": 2309,
    "name": "Playwright Assignment (Learner)",
    "type": "AI_GRADED",
    "groupId": "pw-group"
  },
  "author": {
    "id": 2310,
    "name": "Playwright Assignment (Author)",
    "type": "AI_GRADED",
    "groupId": "pw-group"
  }
}
```

The cache file persists between test runs. To reset:

```bash
# Delete cache and re-run setup
rm tests/playwright/.cache/assignments.json
yarn test:setup
```

---

## Running Tests

### Basic Commands

```bash
# Run all tests
yarn playwright

# Run only learner tests
yarn playwright:learner

# Run only author tests
yarn playwright:author

# Run tests in headed mode (see browser)
yarn playwright --headed

# Run tests in debug mode
yarn playwright --debug

# Run specific test file
yarn playwright tests/learner/learner-homepage.spec.ts

# Run tests matching pattern
yarn playwright --grep "assignment settings"
```

### Environment Variables

Control which tests run using `TEST_ROLE`:

```bash
# Run only learner tests
TEST_ROLE=learner yarn playwright

# Run only author tests
TEST_ROLE=author yarn playwright
```

### Browser Selection

Run tests on specific browsers:

```bash
# Chrome only
yarn playwright --project=chromium

# Firefox only
yarn playwright --project=firefox

# WebKit only
yarn playwright --project=webkit

# Multiple browsers
yarn playwright --project=chromium --project=firefox
```

---

## Test Reports

### Viewing Reports

After test runs, view HTML report:

```bash
yarn playwright show-report
```

The report includes:

- Test results by browser
- Screenshots on failure
- Videos of test execution
- Detailed error traces

### Reports Location

Reports are saved in `playwright-report/` (gitignored).

---

## Writing Tests

### Test Structure

All tests follow this pattern:

```typescript
import { test, expect } from "@playwright/test";
import { getLearnerAssignmentId } from "../helpers/assignment-helpers";
import { skipIfNotRole, setAuthCookie } from "../helpers/role-helpers";

test.describe("Feature Name", () => {
  test.beforeEach(async ({ page }) => {
    skipIfNotRole("learner"); // or "author"
    await setAuthCookie(page, "learner"); // or "author"

    const assignmentId = getLearnerAssignmentId(); // or getAuthorAssignmentId()
    await page.goto(`/learner/${assignmentId}`);
  });

  test("should do something", async ({ page }) => {
    // Test assertions
  });
});
```

### Helper Functions

#### `skipIfNotRole(role)`

Skips test if `TEST_ROLE` environment variable doesn't match:

```typescript
skipIfNotRole("learner"); // Skip if TEST_ROLE=author
skipIfNotRole("author"); // Skip if TEST_ROLE=learner
```

#### `setAuthCookie(page, role, options?)`

Sets authentication cookie for the specified role:

```typescript
// Basic usage
await setAuthCookie(page, "learner");
await setAuthCookie(page, "author");

// With custom options
await setAuthCookie(page, "learner", {
  userId: "custom@email.com",
  groupId: "custom-group",
});
```

#### `getLearnerAssignmentId()` / `getAuthorAssignmentId()`

Returns assignment ID from cache:

```typescript
const assignmentId = getLearnerAssignmentId(); // 2309
const authorAssignmentId = getAuthorAssignmentId(); // 2310
```

### Best Practices

1. **Wait for Network**: Add waits for auto-save and network requests

   ```typescript
   await page.waitForTimeout(300); // After form changes
   await page.waitForLoadState("networkidle"); // Before assertions
   ```

2. **Use Role-Based Helpers**: Always use `skipIfNotRole()` and `setAuthCookie()`

   ```typescript
   test.beforeEach(async ({ page }) => {
     skipIfNotRole("learner");
     await setAuthCookie(page, "learner");
   });
   ```

3. **Handle Dialogs**: Check for confirmation dialogs

   ```typescript
   const confirmButton = page.getByRole("button", { name: "Confirm" });
   if (await confirmButton.isVisible()) {
     await confirmButton.click();
   }
   ```

4. **Use Semantic Selectors**: Prefer role-based selectors

   ```typescript
   // Good
   await page.getByRole("button", { name: "Save" }).click();
   await page.getByRole("heading", { name: "Title" }).isVisible();

   // Avoid
   await page.locator("#save-btn").click();
   await page.locator("h1.title").isVisible();
   ```

---

## Recording Tests

Generate test code from browser interactions:

```bash
# Record new test
npx playwright codegen http://localhost:3010/learner/2309

# Record and save to file
npx playwright codegen http://localhost:3010/author/2310 \
  --output=tests/author/new-test.spec.ts
```

After recording:

1. Add `skipIfNotRole()` and `setAuthCookie()` to `beforeEach`
2. Replace hardcoded IDs with `getLearnerAssignmentId()` / `getAuthorAssignmentId()`
3. Add appropriate waits for network requests
4. Update selectors to use semantic roles

---

## Troubleshooting

### Tests Failing with "Element not visible"

**Cause**: Race conditions - page loading or auto-save in progress

**Solution**: Add waits before assertions

```typescript
await page.waitForLoadState("networkidle");
await expect(element).toBeVisible();
```

### Tests Running for Wrong Role

**Cause**: Missing `skipIfNotRole()` or `setAuthCookie()`

**Solution**: Ensure both are in `beforeEach`:

```typescript
test.beforeEach(async ({ page }) => {
  skipIfNotRole("learner");
  await setAuthCookie(page, "learner");
});
```

### Tests Failing After Setup

**Cause**: Cache file missing or corrupted

**Solution**: Re-run setup

```bash
rm tests/playwright/.cache/assignments.json
yarn test:setup
```

### Server Not Starting

**Cause**: API server not running or health endpoint failing

**Solution**: Check server logs and ensure `/health/readiness` returns 200:

```bash
curl http://localhost:4222/health/readiness
```

### Inconsistent Test Results

**Cause**: Tests running too fast for auto-save

**Solution**: Add strategic waits after form changes:

```typescript
await page.getByPlaceholder("Enter value").fill("45");
await page.waitForTimeout(300); // Wait for auto-save
```

---

## Configuration

Playwright configuration is in `playwright.config.ts`:

- **Base URL**: `http://localhost:3010`
- **API Health Check**: `http://localhost:4222/health/readiness`
- **Test Directory**: `tests/`
- **Browsers**: Chromium, Firefox, WebKit
- **Reports**: HTML, JSON
- **Timeout**: 30s per test

To modify configuration, edit `playwright.config.ts`.

---

## CI/CD Integration

Tests run automatically on pull requests via GitHub Actions.

### CI Environment Variables

The following variables are set in CI:

- `CI=true` - Disables server reuse
- `TEST_ROLE` - Controls which tests run (if role-specific workflow)

### Running Tests in CI

Tests run in headless mode by default. CI workflow:

1. Start database
2. Run migrations
3. Seed database
4. Run `yarn test:setup`
5. Run `yarn playwright`
6. Upload test reports as artifacts

---

## Additional Resources

- [Playwright Documentation](https://playwright.dev/)
- [SETUP.md](./SETUP.md) - Local development setup
- [CONTRIBUTING.md](./docs/CONTRIBUTING.md) - Contribution guidelines
