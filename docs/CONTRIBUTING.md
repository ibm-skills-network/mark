# CONTRIBUTING

## Install Pre-requisites

1. Install IBM's detect-secrets fork:

   ```bash
   pip install --upgrade "git+https://github.com/ibm/detect-secrets.git@master#egg=detect-secrets"
   ```

1. [Install Hadolint](https://github.com/hadolint/hadolint#install). On MacOS:
   ```bash
   brew install hadolint
   ```
1. [Install Shellcheck](https://github.com/koalaman/shellcheck#installing). On MacOS:

   ```bash
   brew install shellcheck
   ```

1. Install asdf if not already installed. See [asdf's installation instructions here](https://asdf-vm.com/guide/getting-started.html).

1. Install node and yarn using [asdf](https://asdf-vm.com/):
   ```bash
   asdf plugin add nodejs
   asdf plugin add yarn
   asdf install
   ```

## Start Postgress database locally for development

```bash
yarn db
```

## Install Dependencies

```bash
yarn
```

## Setup

Perform one-time setup (e.g. prisma migrations and generations) by running:

```bash
yarn setup
```

## Build

```bash
yarn build
```

## Run Tests

```bash
yarn test
```

## Run the Application

```bash
yarn dev
```

## View API Documentation

With the application running, you can view API documentation by visiting [localhost:3010/api](http://localhost:3010/api)

## Secrets

Ideally, no secrets are required for local development. However, it is sometimes useful to integrate with a staging environment (with authentication) instead of spending a lot of time mocking external functionality.
To make a secret available during development, follow these steps:

1. Ensure the secret is stored in our "Skills Network" 1password vault
1. Export a reference to the secret in [dev.env](../dev.env), e.g.:
   ```bash
   export MY_SECRET=op://3vjfhk4mi7jyrqx7ycf62anltm/ < op_item_id > /path/to/secret/field
   ```

## NestJS

This project uses [NestJS](https://docs.nestjs.com/). If you're making significant changes or additions to this project, you should familiarize yourself with NestJS before starting.

When adding new components you should utilize the nest cli generator by running `npx next g ...`


Steps after mark running with DB (be careful of conflicts)
0. Start mark:
Set the following
```dev.env
AUTH_DISABLED=false 
```

1. get AWB setup 

```config/settings/development.local.yml
mark_service:
    client:
        private_token: any-value
        url: http://localhost:3010/api # Update to the correct Mark Port
    lti:
        launch_url: http://localhost:4010/lti/1.1/launch # Update to the correct LTI Port
```

2. get LTI-gateway setup (follow readme)
in dev.env change:
```
LTI_CREDENTIAL_SOURCE=api
JWT_CREDENTIAL_SOURCE=file
```

3. get LTI-Creditial-Manager setup 
```
ibmcloud ks cluster config --cluster apps-faculty-staging-us-east
k port-forward deployments.apps/mark-lti-credentials-manager 8080 -n mark 
```


Turn on Mock:
set AUTH_DISABLED=true
add assignment: `http://localhost:8000/api/v1/admin/assignments`
visit: `http://localhost:3010/learner/{:id}`


_note: 8080 is determined by LTI-Gateway's dev.env LTI_CREDENTIALS_API AND Mark is dependent on this at dev.env LTI_CREDENTIAL_MANAGER_ENDPOINT_

Deployment:
