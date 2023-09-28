const { Client } = require("pg");
const url = require("url");

const DATABASE_URL = process.env.DATABASE_URL;

const parsedUrl = url.parse(DATABASE_URL);
const dbName = parsedUrl.pathname.slice(1); // Remove the leading '/'

const client = new Client({
  connectionString: DATABASE_URL,
});

async function ensureDbExists() {
  await client.connect();

  // Check if database exists
  const result = await client.query(
    "SELECT 1 FROM pg_database WHERE datname = $1",
    [dbName]
  );

  // If database doesn't exist, create it
  if (result.rowCount === 0) {
    await client.end();

    const masterClient = new Client({
      ...client.options,
      database: "postgres", // default database, change if needed
    });

    await masterClient.connect();
    await masterClient.query(`CREATE DATABASE ${dbName}`);
    await masterClient.end();
  } else {
    await client.end();
  }
}

ensureDbExists().catch((err) => {
  console.error("Failed to ensure database exists:", err);
  process.exit(1);
});
