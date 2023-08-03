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

```
docker run --name my_postgres -e POSTGRES_PASSWORD=mysecretpassword -e POSTGRES_USER=myuser -e POSTGRES_DB=mydatabase -p 5432:5432 -d postgres # pragma: allowlist secret
```

## Install Dependencies

```bash
yarn
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

With the application running, you can view API documentation by visiting [localhost:3000](http://localhost:3000)

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
