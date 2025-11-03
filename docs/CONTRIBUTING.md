# Contributing to Mark

Welcome! This guide will help you start contributing to Mark quickly and effectively.

---

## Quick Start

1. **Install prerequisites** - See [Prerequisites](#prerequisites)
2. **Set up environment** - See [Environment Setup](#environment-setup)
3. **Run the project** - See [Running Mark Locally](#running-mark-locally)
4. **Pick an issue** - Browse the [project board](https://github.com/orgs/ibm-skills-network/projects/9)
5. **Follow conventions** - Read [Commit & PR Guidelines](#commit--pr-guidelines)
6. **Submit PR** - Follow the [PR Process](#pull-request-process)

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Environment Setup](#environment-setup)
- [Running Mark Locally](#running-mark-locally)
- [Pull Request Process](#pull-request-process)
- [Commit & PR Guidelines](#commit--pr-guidelines)
- [Reporting Bugs](#reporting-bugs)
- [Suggesting Features](#suggesting-features)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

Install the following tools before getting started:

### Required Tools

```bash
# Docker Desktop (includes Docker Compose)
# Download from: https://www.docker.com/products/docker-desktop

# Python and pip (for detect-secrets)
python3 --version
pip3 --version

# IBM's detect-secrets fork
pip install --upgrade "git+https://github.com/ibm/detect-secrets.git@master#egg=detect-secrets"

# Hadolint (Docker linting)
brew install hadolint

# Shellcheck (shell script linting)
brew install shellcheck

# asdf (version manager)
# See: https://asdf-vm.com/guide/getting-started.html

# Node.js and Yarn via asdf
asdf plugin add nodejs
asdf plugin add yarn
asdf install
```

<details>
<summary><strong>Installing Python & pip on macOS/Linux/Windows</strong></summary>

### macOS / Linux

```bash
# Check Python 3
python3 --version

# Install pip
curl -sS https://bootstrap.pypa.io/get-pip.py -o get-pip.py
python3 get-pip.py

# Verify
pip3 --version
```

### Windows

1. Download Python from [python.org](https://www.python.org/downloads/)
2. **Check "Add Python to PATH"** during installation
3. Install pip:
   ```powershell
   python -m ensurepip --upgrade
   ```
4. Verify:
   ```powershell
   pip --version
   ```

</details>

---

## Environment Setup

### 1. Clone and Install Dependencies

```bash
git clone https://github.com/ibm-skills-network/mark.git
cd mark
yarn install  # This also installs Husky pre-commit hooks
```

### 2. Configure Environment Files

You need to create `dev.env` files in multiple locations:

```bash
# Root
cp .env.template dev.env

# Web app
cp apps/web/.env.template apps/web/.env.local

# API service
cp apps/api/.env.template apps/api/dev.env

# API Gateway
cp apps/api-gateway/.env.template apps/api-gateway/dev.env
```

### 3. Fill in Required Values

<details>
<summary><strong>Environment Variables Reference</strong></summary>

**Note:** If you're an IBM Skills Network developer, request the 1Password files from a full-timer to skip this step.

| Variable(s) | Where | How to Obtain |
|------------|-------|---------------|
| `POSTGRES_PASSWORD` | Root | Choose a strong password (e.g., `openssl rand -base64 32`) |
| `OPENAI_API_KEY` | API, Web | [OpenAI Dashboard](https://platform.openai.com/api-keys) → Create new key |
| `SECRET` (JWT) | API Gateway | Generate: `openssl rand -hex 32` |
| `NATS_USERNAME`, `NATS_PASSWORD`, `NATS_URL` | API, Gateway | Self-hosted NATS config or [Synadia NGS](https://www.synadia.com/ngs) |
| `DATABASE_URL`, `DATABASE_URL_DIRECT` | API | Format: `postgresql://user:password@host:port/db` |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | API | [GitHub OAuth Apps](https://github.com/settings/developers) |
| `WATSONX_AI_API_KEY`, `WATSONX_PROJECT_ID` | API | IBM Cloud → watsonx.ai → Create credential |
| `LTI_CREDENTIAL_MANAGER_USERNAME`, `LTI_CREDENTIAL_MANAGER_PASSWORD` | Gateway | Ask team or create service account |

</details>

### 4. Verify `.gitignore`

Ensure environment files are ignored:

```bash
# Should be in .gitignore
*.env
dev.env
.env.local
```

**IMPORTANT:** Never commit `.env` files. Use secure tools (1Password, Vault) for secrets.

---

## Running Mark Locally

> **📖 For detailed setup instructions with troubleshooting, see [SETUP.md](../SETUP.md)**

### Quick Start

```bash
yarn start  # Runs db + setup + seed + dev in one command
```

### Step-by-Step

### Start the Database

```bash
yarn db  # Starts PostgreSQL in Docker
```

### Run Migrations and Seed Data

```bash
yarn setup  # Runs Prisma migrations
yarn seed   # (Optional) Seeds test data
```

### Start Development Server

```bash
yarn dev    # Starts all services in parallel
```

### Access the Application

1. **Swagger API Docs**: [http://localhost:4222/api](http://localhost:4222/api)
2. **Web Interface**:
   - Author view: `http://localhost:3010/author/{assignmentId}`
   - Learner view: `http://localhost:3010/learner/{assignmentId}`

### Switch User Roles

Edit `apps/api-gateway/src/auth/jwt/cookie-based/mock.jwt.cookie.auth.guard.ts`:

```typescript
// For author view
role: UserRole.AUTHOR

// For learner view
role: UserRole.LEARNER
```

### Useful Commands

```bash
yarn build              # Build all apps
yarn test               # Run tests
yarn lint               # Lint and fix code
yarn prisma:studio      # Open database GUI
```

---

## Pull Request Process

### Workflow

1. **Pick an issue** from the [project board](https://github.com/orgs/ibm-skills-network/projects/9)
2. **Create a branch** using semantic naming:
   - `feat/issue-123-add-grading-rubric`
   - `fix/issue-456-file-upload-bug`
   - `docs/issue-789-update-readme`
3. **Make focused changes** - Break large features into multiple PRs
4. **Use stacked PRs** for related changes ([guide](https://blog.logrocket.com/using-stacked-pull-requests-in-github/))
5. **Ensure tests pass** - Pre-commit hooks will run automatically
6. **Submit PR** - Use Conventional Commits format for title
7. **Address feedback** - Respond to review comments
8. **Merge** - Once approved and CI passes

### PR Checklist

- [ ] PR title follows Conventional Commits format
- [ ] All commits follow Conventional Commits format
- [ ] Tests added/updated and passing
- [ ] Code follows project style (linting passes)
- [ ] No secrets committed (pre-commit hook checks)
- [ ] Documentation updated if needed
- [ ] CI checks pass

---

## Commit & PR Guidelines

We enforce **[Conventional Commits](https://www.conventionalcommits.org/)** for all commits and PR titles.

### Format

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### Types

- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation only
- `refactor` - Code refactoring
- `test` - Adding/updating tests
- `chore` - Maintenance tasks
- `build` - Build system changes
- `ci` - CI/CD changes
- `perf` - Performance improvements

### Scopes (optional)

- `api` - Backend API service
- `web` - Frontend application
- `docs` - Documentation
- `deps` - Dependencies
- `ci` - CI configuration

### Examples

**Good:**
```
feat(api): add JWT refresh token rotation
fix(web): prevent race condition in file uploads
docs: update environment setup guide
refactor(api): simplify grading service logic
```

**Bad:**
```
Update code
Fixed bugs
WIP testing
```

### Enforcement

**Local (Husky):** Pre-commit hooks run on every commit:
- Secrets scanning
- Code formatting (Prettier)
- Linting (ESLint)
- Tests (Jest)
- Build validation

**CI (GitHub Actions):**
- `commit-messages.yml` - Validates all commit messages
- `pr-title.yml` - Validates PR title

**Configuration files:**
- `commitlint.config.js` - Commit message rules
- `.husky/pre-commit` - Pre-commit hook
- `.lintstagedrc.json` - Staged file checks

### Troubleshooting

**Commit rejected?**
- Follow format: `type(scope): description`
- Keep header under 72 characters
- Use allowed types and scopes

**PR title failing?**
- Edit PR title to match Conventional Commits format
- Be specific (not "Update" or "Fix bugs")

**Husky hooks not running?**
```bash
yarn install  # Reinstalls hooks
```

---

## Reporting Bugs

1. Go to the [Issues](https://github.com/ibm-skills-network/mark/issues) tab
2. Click **New Issue**
3. Include:
   - Clear title
   - Steps to reproduce
   - Expected vs actual behavior
   - Logs or screenshots
   - Environment details

---

## Suggesting Features

1. Open the [roadmap board](https://github.com/orgs/ibm-skills-network/projects/9)
2. Add your idea to the **TODO** column
3. Assign to a team member for review

---

## Troubleshooting

### Can't Connect to localhost

**Problem:** Services not accessible at localhost URLs

**Solutions:**
- Ensure database is running: `yarn db`
- Check environment variables are set correctly
- Verify ports 3010, 4222 are not in use
- Check logs: `yarn dev` output

### Database Connection Errors

**Problem:** Prisma can't connect to database

**Solutions:**
```bash
# Restart database
yarn db

# Check connection string in dev.env
echo $DATABASE_URL

# Reset database
yarn prisma:reset

# Re-run migrations
yarn setup
```

### Pre-commit Hooks Failing

**Problem:** Husky blocks commits

**Solutions:**
- Fix linting errors: `yarn lint`
- Fix formatting: `yarn format`
- Fix tests: `yarn test`
- Check for secrets: `yarn secrets:check`
- Ensure build works: `yarn build`

### Node/Yarn Version Issues

**Problem:** Version mismatch errors

**Solutions:**
```bash
# Install correct versions
asdf install

# Verify versions
node --version
yarn --version
```

---

## Additional Resources

- **Semantic Versioning**: [geeksforgeeks.org/introduction-semantic-versioning](https://www.geeksforgeeks.org/introduction-semantic-versioning/)
- **React Style Guide**: [developer.dynatrace.com/develop/react-style-guide](https://developer.dynatrace.com/develop/react-style-guide/)
- **Stacked PRs**: [blog.logrocket.com/using-stacked-pull-requests-in-github](https://blog.logrocket.com/using-stacked-pull-requests-in-github/)
- **NestJS Docs**: [docs.nestjs.com](https://docs.nestjs.com)
- **Next.js Docs**: [nextjs.org/docs](https://nextjs.org/docs)
- **Prisma Docs**: [prisma.io/docs](https://www.prisma.io/docs)
- **Zustand Docs**: [zustand.docs.pmnd.rs](https://zustand.docs.pmnd.rs/getting-started/introduction)
- **Langchain Docs**: [js.langchain.com/docs](https://js.langchain.com/docs/introduction/)

---

**Questions?** Ask in the team chat or open a [discussion](https://github.com/ibm-skills-network/mark/discussions).
