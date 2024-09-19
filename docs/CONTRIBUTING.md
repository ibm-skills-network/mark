# CONTRIBUTING GUIDE

You can watch a video going through how to set up the project for local development [here](https://ibm.box.com/s/7rzbsidqv2pvghol68vjugo92c92m3kn).

## Table of Contents

- [CONTRIBUTING GUIDE](#contributing-guide)
  - [Table of Contents](#table-of-contents)
  - [Prerequisites](#prerequisites)
  - [Secrets Management](#secrets-management)
  - [Development Setup](#development-setup)
    - [NestJS Framework](#nestjs-framework)
      - [Local Database](#local-database)
      - [Dependencies](#dependencies)
      - [Build and Test](#build-and-test)
    - [Useful Resources](#useful-resources)
  - [Local Development: Mark Only](#local-development-mark-only)
    - [Enable Mock Mode](#enable-mock-mode)
    - [Example: Adding Assignments](#example-adding-assignments-then-accessing-learner-view)
  - [Local End-to-End Development: Author Workbench](#local-end-to-end-development-author-workbench)
    - [Setup Mark:](#setup-mark)
      - [Author Workbench Setup](#author-workbench-setup)
      - [LTI Gateway Setup](#lti-gateway-setup)
      - [LTI Creditial Manager Setup](#lti-creditial-manager-setup)
    - [Coursera Setup](#coursera-setup)
      - [Pre-requisities](#pre-requisities)
      - [Setup Assignment](#setup-assignment)
    - [EdX Setup](#edx-setup)
  - [Deployment](#deployment)
  - [Troubleshooting](#troubleshooting)
    - [Unable to reach local host with ngrok:](#unable-to-reach-local-host-with-ngrok)

## Prerequisites

Before contributing to this project, ensure the following tools and dependencies are installed:

1. **IBM's detect-secrets fork**:

   ```bash
   pip install --upgrade "git+https://github.com/ibm/detect-secrets.git@master#egg=detect-secrets"
   ```

2. **Hadolint**:
   [Installation Guide for Hadolint](https://github.com/hadolint/hadolint#install)

   ```bash
   brew install hadolint
   ```

3. **Shellcheck**:
   [Installation Guide for Shellcheck](https://github.com/koalaman/shellcheck#installing)

   ```bash
   brew install shellcheck
   ```

4. **asdf (version manager)**:
   See [asdf's installation instructions here](https://asdf-vm.com/guide/getting-started.html).

5. **Node.js and Yarn via asdf**:
   ```bash
   asdf plugin add nodejs
   asdf plugin add yarn
   asdf install
   ```

## Secrets Management

To integrate with a staging environment during local development:

1. Store the secret in the "Skills Network" 1password vault.
2. Export a reference to the secret in [dev.env](../dev.env), e.g.:
   ```bash
   export MY_SECRET=op://3vjfhk4mi7jyrqx7ycf62anltm/ < op_item_id > /path/to/secret/field
   ```

## Development Setup

### NestJS Framework

This project uses [NestJS](https://docs.nestjs.com/) on the backend ([api](../apps/api/) and [api-gateway](../apps/api-gateway/)) and [NextJS](https://nextjs.org/docs) on the frontend ([web](../apps/web/)). Familiarize yourself with them if making significant changes.

_hint: When adding new components you should utilize the nest cli generator by running `npx nest g ...`_

#### Dependencies

Install project dependencies:

```bash
yarn
```

#### Local Database

1. **Running Mark**

- Start (or restart) Postgres database locally:

```bash
yarn db
```
- Seed the database with test data (optional, it will create an assignment with 5 questions):

```bash
yarn seed
```

- Run one-time setup operations like Prisma migrations to create the database schema:

```bash
yarn setup
```
- Run the Application:

```bash
yarn dev

```
OR
- You can run only one command:

```bash
yarn start
```

2. **Create Assignment with Insomnia App**:

   - Open the Insomnia app.
   - Find the "Create Assignment" request on the left side. if you dont have it create one by pressing the + symbol on top left then make a post request to url `http://localhost:8000/api/v1/admin/assignments` with a dummy json body

   ```json
   {
     "name": "Assignment 1",
     "groupId": "test-group-id",
     "type": "AI_GRADED"
   }
   ```

   - Press "Send" on the top right to create an assignment.

   *It should return assignment id which you would use in the URL to route to the assignment*

3. **Access the Website**:
   Open a browser and navigate to `http://localhost:3010/author/${assignmentid}` to access the website.

### Extra Steps

4. **Switching to Learner View**:

   - Open the file `mock.jwt.cookie.auth.guard.ts`.
   - Change the line:
     ```typescript
     role: UserRole.AUTHOR,
     ```
     to
     ```typescript
     role: UserRole.LEARNER,
     ```

5. **Change URL for Learner View**:

   - In the URL, replace "author" with "learner".
   - For example, change `http://localhost:3010/author/${assignmentid}` to `http://localhost:3010/learner/${assignmentid}`.

6. **Accessing Different Assignments**:
   - To access a different assignment, change the number after "author" or "learner" in the URL.
   - For example, to access the second assignment, change the URL to `http://localhost:3010/author/2`.
   - Remember to create a new assignment if it doesn't exist using the Insomnia app.

P.S. If you need to use mark's production data in the local environment, ask full timer to give you a .sql backup data of mark's db and add it to the root directory then run the app either by using `yarn start` if you want to restart, or run `yarn seed`. One issue is that it wouldn't be `seeded` but it will be `restored`, which would cause issues with migration if you made any, make sure to run `yarn setup` after the `yarn seed` to mitigate it.


### Useful Resources

- **API Documentation**: Accessible at [http://localhost:4222/api](http://localhost:4222/api) while the application is running.
- **Postman Collection**: Import the [Postman Collection](https://psycho-baller.postman.co/workspace/Mark~2fc561a8-6a26-4528-9a86-a8fbc86424c0/collection/23796705-d29338fc-95d8-407f-bfbd-d8395c3e72bd?action=share&creator=23796705) to test the API.

## Local Development: Mark Only

### Enable Mock Mode

To enable mock mode, set `AUTH_DISABLED=true` in [apps/api-gateway/dev.env](../apps/api-gateway/dev.env#L17-L18).

### Example: Adding Assignments then Accessing Learner View

Add blank assignment: `http://localhost:8000/api/v1/admin/assignments`
To access author view, visit: `http://localhost:3010/author/{:id}`

To become a learner, first change the `AUTHOR` role to `LEARNER` in [here](../apps/api-gateway/src/auth/jwt/cookie-based/mock.jwt.cookie.auth.guard.ts#L27)
Then visit: `http://localhost:3010/learner/{:id}`

## Local End-to-End Development: Author Workbench

### Setup Mark:

#### Author Workbench Setup

Set `AUTH_DISABLED=false` in `apps/api-gateway/dev.env` before running `mark`

1. Update `config/settings/development.local.yml`:

   ```yaml
   mark_service:
   client:
     private_token: <mark staging value> # mark's api-gateway staging value
     url: http://localhost:3010/api # mark's frontend, in dev.env
   lti:
     launch_url: http://localhost:4010/lti/1.1/launch # lti-gateway's port
   ```

   _hint: Make sure remove other clean up custom settings as appropriate e.g.: Atlas configs should be removed if not running Atlas locally._

2. Launch Author Workbench locally: See `author-workbench/README.md`

#### LTI Gateway Setup

1. Update `dev.env`

   ```
   SN_FACULTY_MARK_URL=http://localhost:3010    # Mark client
   LTI_CREDENTIAL_SOURCE=api                    # TODO: What is it doing?
   JWT_CREDENTIAL_SOURCE=file
   ```

2. Launch LTI Gateway locally: `lti-gateway/README.md`

#### LTI Creditial Manager Setup

Run the following commands in the terminal

```bash
ibmcloud ks cluster config --cluster apps-faculty-staging-us-east
kubectl port-forward deployments.apps/mark-lti-credentials-manager XXXX -n mark # usually 8080
```

_note: `XXXX` must be the same as `lti-gateways`'s `dev.env`: `LTI_CREDENTIALS_API` variable AND `mark`'s `apps/api-gateway/dev.env`: `LTI_CREDENTIAL_MANAGER_ENDPOINT` variable_

### Coursera Setup

#### Pre-requisities

- Install ngrok run:
  ```bash
  brew install ngrok
  ```
- Sign up for free ngrok account and get your auth token [here](https://ngrok.com/)
- Add your auth token run:
  ```bash
   ngrok config add-authtoken <TOKEN>
  ```
- Run HTTP Forwarding
  ```bash
  ngrok http XXXX
  ```
  where XXXX is the localhost port you are using for Author Workbench

#### Setup Assignment

- Visit [Coursera LTI Test Course](https://www.coursera.org/learn/cognitive-class-lti-test-course/home/)
- Click `Edit Course`
- Select or Create `App Item`

  _Note: App Item describes that this is an embedded item from Author Workbench (Lab, Assignment, etc)_

- Click the `Embed Button` and copy the `Coursera` Assignment Launch URL e.g. `<ngrok URL>/courses/4/assignments/2`
- Copy `Consumer Key` e.g. `autogen-faculty-v1-coursera-course-v1-IND-AU0101DE-v1`
- Copy the `Secret` e.g. `password-from-embed-settings`
- Add the above to the `App Item`
- Launch the `App Item` from `View as Learner`

### EdX Setup

TODO Later

## Deployment

Deployments are managed to `faculty-apps-staging`. The build triggers images for API, API-Gateway, and UI with the same image tag.

This plain text version is formatted for easy insertion into a Markdown file, keeping the intended structure and links operational. Copy and paste this content into your README.md file to update it with the new structure.

## Troubleshooting

### Unable to reach local host with ngrok:

Add ngrok to Author Workbench whitelist in `config/environments/development.rb`
e.g.

```
config.hosts << /.*\.ngrok-free\.app/
```
