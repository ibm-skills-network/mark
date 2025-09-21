# CONTRIBUTING GUIDE
## Table of Contents

- [CONTRIBUTING GUIDE](#contributing-guide)
  - [Table of Contents](#table-of-contents)
  - [Reporting Bugs](#reporting-bugs)
  - [Suggesting New Features](#suggesting-new-features)
  - [Pull Request Process](#pull-request-pr-process)
  - [Prerequisites](#prerequisites)
  - [Environment Setup Guide](#environment-setup-guide)
    - [Step 1: Locate the `.env.template` Files](#step-1-locate-the-envtemplate-files)
    - [Step 2: Create Your Own `dev.env` Files](#step-2-create-your-own-devenv-files)
    - [Step 3: Acquire and Fill in Environment-Specific Values](#step-3-acquire-and-fill-in-environment-specific-values)
    - [Step 4: Verify `.gitignore`](#step-4-verify-gitignore)
    - [Important Notes](#important-notes)
  - [Secrets Management](#secrets-management)
  - [Development Setup](#development-setup)
    - [Dependencies](#dependencies)
    - [Local Database](#local-database)
    - [Accessing Mark Locally](#accessing-mark-locally)
    - [Useful Resources](#useful-resources)
  - [Troubleshooting](#troubleshooting)

## Reporting Bugs

To report a bug:

1. **Navigate** to the **Issues** tab.
2. **Click** **New Issue**.
3. **Describe** your bug with:

   * A clear **title**
   * **Steps to reproduce**
   * **Expected vs. actual behavior**
   * Relevant **logs** or **screenshots**

Our team reviews new issues **daily** and will respond **as soon as possible**.

---

## Suggesting New Features

To propose a new feature:

1. **Open** the roadmap board:
   [https://github.com/orgs/ibm-skills-network/projects/9](https://github.com/orgs/ibm-skills-network/projects/9)
2. **Add** your idea to the **TODO** column.
3. **Assign** it to a team member for initial review.

---

## Pull Request (PR) Process

We follow **semantic conventions** for branches, versions, and PRs:

### A. Conventions & Resources

* **Branch Naming**
  [https://gist.github.com/seunggabi/87f8c722d35cd07deb3f649d45a31082](https://gist.github.com/seunggabi/87f8c722d35cd07deb3f649d45a31082)
* **Semantic Versioning**
  [https://www.geeksforgeeks.org/introduction-semantic-versioning/](https://www.geeksforgeeks.org/introduction-semantic-versioning/)
* **React Code Style**
  [https://developer.dynatrace.com/develop/react-style-guide/](https://developer.dynatrace.com/develop/react-style-guide/)
* **Stacked PRs**
  [https://blog.logrocket.com/using-stacked-pull-requests-in-github/](https://blog.logrocket.com/using-stacked-pull-requests-in-github/)

### B. Workflow

1. **Pick up** an issue.
2. **Create** a branch named per our conventions (e.g., `feature/ISSUE-123-description`).
3. **Break down** large issues into multiple, focused PRs.
4. **Stack** related PRs under a main branch if needed.
5. **Submit** each PR for review.
6. **Merge** once approved.
7. **Release** a new version if the change is client-facing.

## Prerequisites

Before contributing to this project, ensure the following tools and dependencies are installed:
Thought for 4 seconds

 **IBM's detect-secrets fork**:

   ```bash
   pip install --upgrade "git+https://github.com/ibm/detect-secrets.git@master#egg=detect-secrets"
   ```

### 📦 Install `pip` (and Python) on macOS / Linux & Windows

---

#### 🐧 macOS / Linux

1. **Check if Python 3 is already installed**

   ```bash
   python3 --version
   ```

2. **Install `pip` (if it isn’t there yet)**

   ```bash
   curl -sS https://bootstrap.pypa.io/get-pip.py -o get-pip.py
   python3 get-pip.py
   ```

3. **Confirm that `pip` works**

   ```bash
   pip3 --version
   ```

---

#### 🪟 Windows

1. **Install Python**

   - Grab the installer from [https://www.python.org/downloads/](https://www.python.org/downloads/).
   - During setup, **check “Add Python to PATH.”**

2. **Install (or upgrade) `pip`**

   ```powershell
   python -m ensurepip --upgrade
   ```

3. **Verify `pip`**

   ```powershell
   pip --version
   ```

---

> **🔧 PATH tip (macOS / Linux):**
> If `pip3` isn’t found after installation, add this to your shell config (e.g. `~/.zshrc`, `~/.bashrc`) and reload:
>
> ```bash
> export PATH="$HOME/Library/Python/3.9/bin:$PATH"
> ```
>
> _(Adjust the Python version/directory to match your system.)_

1. **Hadolint**:  
   [Installation Guide for Hadolint](https://github.com/hadolint/hadolint#install)

   ```bash
   brew install hadolint
   ```

2. **Shellcheck**:  
   [Installation Guide for Shellcheck](https://github.com/koalaman/shellcheck#installing)

   ```bash
   brew install shellcheck
   ```

3. **asdf (version manager)**:  
   See [asdf's installation instructions here](https://asdf-vm.com/guide/getting-started.html).

4. **Node.js and Yarn via asdf**:
   ```bash
   asdf plugin add nodejs
   asdf plugin add yarn
   asdf install
   ```

---

## Environment Setup Guide

This project requires three environment files (`dev.env`) for different components. Follow the steps below to configure your environment.

---

### Step 1: Locate the `.env.template` Files

Each component has its own `.env.template` file. These files are located in the following directories:

1. **Root Directory**  
   Template: `/.env.template`
2. **Web Directory**
   Template: `/apps/web/.env.tempalte`
3. **API Service**  
   Template: `/apps/api/.env.template`
4. **API Gateway**  
   Template: `/apps/api-gateway/.env.template`

---

### Step 2: Create Your Own `dev.env` Files

For each component, copy the corresponding `.env.template` file to create a `dev.env` file.

Run the following commands:

```bash
# Root environment file
cp ./.env.template dev.env

# Web environment file
cp apps/web/.env.template apps/web/.env.local

# API environment file
cp apps/api/.env.template apps/api/dev.env

# API Gateway environment file
cp apps/api-gateway/.env.template apps/api-gateway/dev.env
```

---

### Step 3: Acquire and Fill in Environment-Specific Values

P.S. If you are a skills-network developer, ask full timer to give you op files for mark, so you dont have to go through this step

Each `dev.env` file requires specific environment variables. Below are the details on how to acquire these values:
| # | Variable(s) | Found in template(s) | Where you obtain the value |
| ----- | -------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A** | `POSTGRES_PASSWORD` | _root of the project_ | Choose a strong password (e.g. `openssl rand -base64 32`) when you create the local Postgres container/user. |
| **B** | `OPENAI_API_KEY`, `OPENAI_API_SPEECH_TEXT_KEY` | _api_, _web_ | OpenAI dashboard → API Keys → **Create new secret key** (same key works for both chat & speech). |
| **C** | `SECRET` (JWT signing) | _api-gateway_ | Generate 32+ random bytes (`openssl rand -hex 32`). Needed only if `AUTH_DISABLED=false`. |
| **D** | `NATS_USERNAME`, `NATS_PASSWORD`, `NATS_URL` | _api-gateway_, _api_ | _Self-hosted_: set in your `nats-server.conf` and reuse here. <br>_Synadia NGS cloud_: create a **User** in the NGS console, copy the user/pass & server URL. |
| **E** | `DATABASE_URL`, `DATABASE_URL_DIRECT` | _api_ | Compose: `postgresql://<user>:<password>@<host>:<port>/<db>` using the password from **A**. |
| **F** | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | _api_ | GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App**. |
| **G** | `GITHUB_CLIENT_ID_LOCAL`, `GITHUB_CLIENT_SECRET_LOCAL` | _api_ | Same as **F**, but create a second OAuth App whose callback URL points to `localhost` (for local dev). |
| **H** | `GITHUB_APP_TOKEN` | _api_ | If you use a GitHub App: GitHub → **Settings → Apps → Your App → Generate token**. |
| **I** | `WATSONX_AI_API_KEY`, `WATSONX_PROJECT_ID` | _api_ | IBM Cloud → Resource list → **watsonx.ai** instance → Create service credential. |
| **J** | `LTI_CREDENTIAL_MANAGER_USERNAME`, `LTI_CREDENTIAL_MANAGER_PASSWORD` | _api-gateway_ | Ask the team running the LTI Credential Manager for a service account or create one yourself. |

---

### Step 4: Verify `.gitignore`

Ensure `.env` files are excluded from version control to avoid accidental exposure of sensitive data. Verify that `.gitignore` contains the following lines:

```bash
# Ignore all environment files
*.env
```

---

### Important Notes

1. **DO NOT COMMIT `dev.env` FILES**  
   Ensure that your `.env` files are never committed to version control.

2. **Keep Secrets Secure**  
   Use secure tools (e.g., 1Password, Vault) for sensitive values in your `dev.env` files.

3. **Use `.env.template` for Updates**  
   Always update `.env.template` files if new environment variables are required. This ensures other developers have a clear reference.

---

## Secrets Management

To integrate with a staging environment during local development, ensure secrets are stored securely using a secrets manager. Export references to the secrets in your `dev.env` files.

Example:

```bash
export MY_SECRET=<secure-reference>
```

---

## Development Setup

### Dependencies

Install project dependencies:

```bash
yarn
```

### Tools

install `sqlelectorn` as it helps you during development to see the database and run sql queries.
You can download the GUI from [here](https://github.com/sqlectron/sqlectron-gui/releases/tag/v1.38.0)
After installing it, here is how to configure it to mark's db:

1. Click add
2. Add these configurations:
   ![Mark sqldb config](image.png)

### Local Database

1. **Running Mark**

   - Start (or restart) Postgres database locally:

     ```bash
     yarn db
     ```

   - Run one-time setup operations like Prisma migrations to create the database schema:
     Make sure you enable `integrate with 1Password CLI` if you are using op version

     ```bash
     yarn setup
     ```

   - Seed the database with test data (optional) (For the first time, you will need to run yarn setup before yarn seed, then later you can do seed first)

     ```bash
     yarn seed
     ```

   - Run the application:

     ```bash
     yarn dev
     ```

     OR

     ```bash
     yarn start
     ```

2. **Create Assignments Using Swagger, skip this step if you already ran yarn seed command**:

   - Open a browser and navigate to the Swagger documentation at [http://localhost:4222/api](http://localhost:4222/api).
   - Locate the `# Admin` section in the Swagger UI.
   - Under `AdminController_createAssignment`, click on the `Try it out` button.
   - Fill in the required fields in the provided JSON body. For example:

     ```json
     {
       "name": "Assignment 1",
       "groupId": "test-group-id",
       "type": "AI_GRADED"
     }
     ```

   - Click "Execute" to create the assignment.  
     Swagger will return the `assignmentId`, which can be used to access the assignment.

3. **Access the Website**:

   Open a browser and navigate to:

   ```
   http://localhost:3010/author/${assignmentid}
   ```

---

### Accessing Mark Locally

Switch between views by modifying roles:

1. Open the `mock.jwt.cookie.auth.guard.ts` file.
2. Change the role:
   ```typescript
   role: UserRole.AUTHOR, // to switch to author
   ```
   OR
   ```typescript
   role: UserRole.LEARNER, // to switch to learner
   ```

Update the URL as follows:

- For author view: `http://localhost:3010/author/${assignmentid}`
- For learner view: `http://localhost:3010/learner/${assignmentid}`

---

### Useful Resources

- **Swagger Documentation**: Accessible at [http://localhost:4222/api](http://localhost:4222/api).
- **React Documentation**: [https://reactjs.org/docs/getting-started.html](https://reactjs.org/docs/getting-started.html)
- **Next.js Documentation**: [https://nextjs.org/docs](https://nextjs.org/docs)
- **Nest.js Documentation**: [https://docs.nestjs.com](https://docs.nestjs.com)
- **Zustand Documentation**:https://zustand.docs.pmnd.rs/getting-started/introduction
- **Langchain Documentation**:https://js.langchain.com/docs/introduction/

---

---

## 🚢 Contributing to Helm Charts

Mark includes comprehensive Helm charts for Kubernetes deployment. Contributing to charts follows additional guidelines beyond application code.

### Helm Chart Prerequisites

- **Helm**: 3.4+ for chart development
- **Kubernetes**: Access to a cluster for testing (local or remote)
- **kubectl**: Configured to access your test cluster

### Chart Development Setup

1. **Install Helm** (if not already installed):
   ```bash
   # macOS
   brew install helm

   # Or download from https://helm.sh/docs/intro/install/
   ```

2. **Set up chart dependencies**:
   ```bash
   cd helm-chart/mark
   helm dependency update
   ```

3. **Test chart locally**:
   ```bash
   helm lint .
   helm template test-release . --debug
   ```

### Chart Standards and Best Practices

- **Helm Best Practices**: Follow [official Helm chart best practices](https://helm.sh/docs/chart_best_practices/)
- **Semantic Versioning**: Charts follow SemVer for versioning
- **Documentation**: All values must be documented in both `values.yaml` and `README.md`
- **Testing**: Charts must pass linting and template testing
- **Examples**: Provide realistic configuration examples

### Chart File Structure

```
helm-chart/
├── mark/                    # Main chart
│   ├── Chart.yaml          # Chart metadata (version, dependencies)
│   ├── values.yaml         # Default configuration values
│   ├── templates/          # Kubernetes resource templates
│   │   ├── deployment.yaml
│   │   ├── service.yaml
│   │   ├── ingress.yaml
│   │   └── ...
│   └── README.md           # Chart-specific documentation
├── examples/               # Example configurations
│   ├── minimal.yaml        # Development setup
│   ├── production.yaml     # Production-ready config
│   └── with-database.yaml  # External database config
└── docs/                   # Additional documentation
    └── VERSIONING.md       # Versioning strategy
```

### Making Chart Changes

#### 1. Version Management

Update `Chart.yaml` following semantic versioning:

| Change Type | Version Bump | Example |
|-------------|--------------|---------|
| Breaking changes to templates or values | MAJOR | 1.4.0 → 2.0.0 |
| New features, backwards compatible | MINOR | 1.4.0 → 1.5.0 |
| Bug fixes, security patches | PATCH | 1.4.0 → 1.4.1 |

#### 2. Template Best Practices

When modifying templates:
- Use proper indentation (2 spaces)
- Include resource limits and requests
- Add proper labels and annotations using `_helpers.tpl`
- Use conditional rendering: `{{- if .Values.feature.enabled }}`
- Include security contexts and non-root users
- Add health checks (liveness/readiness probes)

Example template structure:
```yaml
{{- if .Values.apiGateway.enabled }}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "mark.fullname" . }}-api-gateway
  labels:
    {{- include "mark.labels" . | nindent 4 }}
    app.kubernetes.io/component: api-gateway
spec:
  replicas: {{ .Values.apiGateway.replicaCount }}
  # ... rest of template
{{- end }}
```

#### 3. Values Configuration

When adding new configuration options:
- Group related values logically
- Provide sensible defaults
- Document each value with inline comments
- Use consistent naming conventions

Example values structure:
```yaml
# API Gateway configuration
apiGateway:
  enabled: true
  replicaCount: 3
  image:
    repository: ghcr.io/ibm-skills-network/mark/mark-api-gateway
    tag: ""  # Defaults to appVersion
    pullPolicy: IfNotPresent
  resources:
    requests:
      memory: "256Mi"
      cpu: "100m"
    limits:
      memory: "512Mi"
      cpu: "500m"
```

#### 4. Documentation Updates

Always update documentation when making changes:
- **Chart README.md**: Parameter reference and examples
- **Main README.md**: Update if new major features added
- **CHANGELOG.md**: Document all changes
- **Examples**: Add or update example configurations

### Testing Helm Charts

#### Lint Testing
```bash
cd helm-chart/mark

# Basic linting
helm lint .

# Lint with specific values
helm lint . -f ../examples/production.yaml
```

#### Template Testing
```bash
# Test template rendering
helm template test-release . --debug

# Test with different values
helm template test-release . -f ../examples/production.yaml --debug

# Test specific templates
helm template test-release . --show-only templates/deployment.yaml
```

#### Installation Testing
```bash
# Dry-run installation
helm install test-release . --dry-run --debug

# Actual installation (requires cluster)
helm install test-release . --create-namespace --namespace mark-test

# Test upgrade
helm upgrade test-release . --dry-run --debug
```

### Chart Pull Request Process

#### Before Submitting

1. **Test thoroughly**:
   ```bash
   # Run all chart tests
   helm lint helm-chart/mark/
   helm template test-release helm-chart/mark/ --debug
   helm install test-release helm-chart/mark/ --dry-run
   ```

2. **Update documentation**:
   - Chart README.md with new parameters
   - Examples if new features added
   - CHANGELOG.md with version changes

3. **Version appropriately**:
   - Bump chart version in `Chart.yaml`
   - Update `appVersion` if application changed

#### Chart PR Checklist

- [ ] Chart version bumped appropriately
- [ ] Templates follow Helm best practices
- [ ] All values documented
- [ ] Examples updated if needed
- [ ] Tests pass (lint + template)
- [ ] CHANGELOG.md updated
- [ ] Breaking changes documented
- [ ] Installation tested (if possible)

### Chart Release Process

Charts are automatically released when:
1. Changes are merged to master branch
2. Chart version is bumped in `Chart.yaml`
3. The `chart-releaser` GitHub Action creates a release

The process:
1. **Packages** the chart into a `.tgz` file
2. **Creates** a GitHub release with the chart package
3. **Updates** the `gh-pages` branch with chart index
4. **Publishes** to GitHub Pages for public access

### Helm Chart Documentation

For complete Helm chart documentation, see:
- **📚 [Helm Chart README](../helm-chart/README.md)** - Complete usage guide
- **⚙️ [Chart Parameters](../helm-chart/mark/README.md)** - Detailed parameter reference
- **📋 [Versioning Guide](../helm-chart/docs/VERSIONING.md)** - Versioning strategy
- **🔧 [Examples](../helm-chart/examples/)** - Ready-to-use configurations

---

## Troubleshooting

### Unable to Reach Localhost:

Ensure your local database and API are running correctly. Verify your `.env` configuration and that required ports are not blocked.

### Helm Chart Issues:

#### Chart Won't Install
- Check Kubernetes cluster connectivity: `kubectl cluster-info`
- Verify chart syntax: `helm lint helm-chart/mark/`
- Test template rendering: `helm template test helm-chart/mark/ --debug`

#### Template Errors
- Use `--debug` flag for detailed error messages
- Check value references and template syntax
- Validate YAML indentation (2 spaces)

#### Version Conflicts
- Ensure chart version is unique
- Check for dependency version conflicts
- Use `helm dependency update` to refresh dependencies
