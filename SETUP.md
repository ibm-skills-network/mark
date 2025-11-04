# Mark Project Setup Guide

This guide will help you set up the Mark project for local development.

## Prerequisites

- Node.js >= 20.9.0
- Yarn 1.22.22
- Docker Desktop (for PostgreSQL database)

## Quick Start

To start the entire project in one command:

```bash
yarn start
```

This will automatically:
1. Install dependencies
2. Start the database
3. Run migrations
4. Seed the database
5. Start development servers

## Step-by-Step Setup

If you prefer to run each step individually, **follow this exact order**:

### 1. Install Dependencies

```bash
yarn
```

**Troubleshooting:**
- Make sure you have Node.js >= 20.9.0 installed
- Ensure you're using Yarn 1.22.22

### 2. Start Database

```bash
yarn db
```

This will:
- Check if Docker and Docker Compose are installed and running
- Start a PostgreSQL container using docker-compose
- Wait for the database to be ready
- Persist data in a Docker volume (survives container restarts)

**Database Management:**
```bash
# Stop database (keeps data)
docker-compose stop

# Stop and remove container (keeps data)
docker-compose down

# Stop and remove all data (fresh start)
docker-compose down -v

# View database logs
docker-compose logs -f postgres

# Restart database
docker-compose restart postgres
```

**Troubleshooting:**
- If you get "Docker is not installed", install Docker Desktop from https://www.docker.com/products/docker-desktop
- If you get "Docker daemon is not running", start Docker Desktop and wait for it to fully start
- If you get "docker-compose is not installed", Docker Compose comes with Docker Desktop (or install docker-compose-plugin on Linux)

### 3. Run Migrations

```bash
yarn setup
```

This will:
- Validate critical environment variables
- Run Prisma migrations
- Generate Prisma client

**Troubleshooting:**
- If you get "Dependencies not installed", run `yarn` first
- If you get "Database container is not running", run `yarn db` first
- If you get "Missing critical environment variables", check the error message for which variables are missing and add them to `dev.env`

### 4. Seed Database

```bash
yarn seed
```

This will seed the database with initial data. The script intelligently handles two scenarios:

- **If `seed.sql` exists in root**: Uses `pg_restore` to restore from the SQL dump
- **If no `seed.sql` found**: Uses TypeScript seed file to create sample data

**Important:** You must run `yarn setup` before `yarn seed` to ensure Prisma client is generated and migrations are applied.

**Troubleshooting:**
- If you get "Prisma client not generated", run `yarn setup` first
- If you get "Database container is not running", run `yarn db` first
- If you get "node_modules not found", run `yarn` first

### 5. Start Development Servers

```bash
yarn dev
```

This will:
- Validate all requirements are met
- Start all development servers in parallel

**Troubleshooting:**
- Follow the error messages which will guide you through the required setup steps

## Environment Variables

### Critical Environment Variables

The following environment variables are required and validated before starting the application:

- `POSTGRES_PASSWORD` - Database password
- `POSTGRES_USER` - Database user
- `POSTGRES_DB` - Database name
- `POSTGRES_HOST` - Database host
- `POSTGRES_PORT` - Database port (internal, 5432)
- `POSTGRES_EXTERNAL_PORT` - External port for Docker (6001)
- `API_PORT` - API server port
- `API_GATEWAY_PORT` - API Gateway port
- `API_GATEWAY_HOST` - API Gateway host
- `PORT` - Frontend port

These are defined in `dev.env` in the project root.

**Note**: `DATABASE_URL` and `DATABASE_URL_DIRECT` are automatically constructed from the Postgres variables if not explicitly set.

### Validation

To manually validate your environment variables:

```bash
./scripts/validate-env.sh
```

## Development Workflow

### Normal Development

```bash
yarn dev
```

### Resetting Database

To reset the database with fresh data:

```bash
# Option 1: Keep container, re-run migrations and seed
yarn setup
yarn seed

# Option 2: Complete fresh start (removes all data)
docker-compose down -v
yarn db
yarn setup
yarn seed
```

### Viewing Database

```bash
yarn studio
```

This opens Prisma Studio to view and edit database records.

## Troubleshooting Common Issues

### "Docker is not installed or not in PATH"

**Solution:** Install Docker Desktop from https://www.docker.com/products/docker-desktop

### "Docker daemon is not running"

**Solution:** Start Docker Desktop and wait for it to fully start

### "Dependencies not installed"

**Solution:** Run `yarn` to install dependencies

### "Database container is not running"

**Solution:** Run `yarn db` to start the database

### "Prisma client not generated"

**Solution:** Run `yarn setup` to generate the Prisma client

### "Missing critical environment variables"

**Solution:**
1. Check the error message for which variables are missing
2. Open `dev.env` in your editor
3. Add the missing variables (refer to the error message for required variables)

### "Port is already in use"

**Problem:** Development or database port is occupied by another process

**Solution:**
1. Check which process is using the port (shown in the error message)
2. Stop that process
3. Or change the port in `dev.env`:
   - `POSTGRES_EXTERNAL_PORT` for database (default: 6001)
   - `PORT` for frontend (default: 3010)
   - `API_PORT` for API (default: 4222)
   - `API_GATEWAY_PORT` for API Gateway (default: 8000)

To kill a process using a specific port:
```bash
# Replace PORT_NUMBER with the actual port
kill -9 $(lsof -ti:PORT_NUMBER)
```

## Additional Scripts

### Database Management
- `yarn db` - Start database
- `yarn db:stop` - Stop database (keeps data)
- `yarn db:down` - Stop and remove container (keeps data)
- `yarn db:reset` - Stop, remove all data, and start fresh
- `yarn db:logs` - View database logs

### Development
- `yarn build` - Build all packages
- `yarn lint` - Lint all packages
- `yarn test` - Run all tests
- `yarn format` - Format all files

### Database Tools
- `yarn studio` - Open Prisma Studio
- `yarn prisma:studio` - Open Prisma Studio (alternative)
- `yarn prisma:migrate` - Create and run a new migration
- `yarn prisma:generate` - Generate Prisma client
- `yarn prisma:reset` - Reset database and re-run all migrations

## Project Structure

- `apps/api` - NestJS API server
- `apps/api-gateway` - API Gateway
- `apps/web` - Next.js frontend
- `packages/*` - Shared packages
- `scripts/*` - Build and development scripts
- `dev.env` - Development environment variables

## Getting Help

If you encounter issues not covered in this guide:

1. Check the error message - they're designed to be helpful and guide you to the solution
2. Ensure all prerequisites are installed
3. Ensure Docker Desktop is running
4. Try running the steps individually to isolate the issue
