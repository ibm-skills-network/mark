# mark

![Build Status](https://github.com/ibm-skills-network/mark/actions/workflows/release.yml/badge.svg)

## Usage

### Start Postgress database locally for development

```
docker run --name my_postgres -e POSTGRES_PASSWORD=mysecretpassword -e POSTGRES_USER=myuser -e POSTGRES_DB=mydatabase -p 5432:5432 -d postgres //pragma: allowlist secret
```

## Contributing

Contributions are welcome.
Please see [docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md) to get started.
