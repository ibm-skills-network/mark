const { Client } = require("pg");
const url = require("url");

const DATABASE_URL = process.env.DATABASE_URL;

const parsedUrl = url.parse(DATABASE_URL);
const dbName = parsedUrl.pathname.slice(1); // Remove the leading '/'

const defaultClient = new Client({
  connectionString: DATABASE_URL,
  database: "postgres", // connecting to the default 'postgres' database
});

async function ensureDbExists() {
  await defaultClient.connect();

  // Check if database exists
  const result = await defaultClient.query(
    "SELECT 1 FROM pg_database WHERE datname = $1",
    [dbName]
  );

  // If database doesn't exist, create it
  if (result.rowCount === 0) {
    await defaultClient.query(`CREATE DATABASE ${dbName}`);
  }
  await defaultClient.end();
}

ensureDbExists().catch((err) => {
  console.error("Failed to ensure database exists:", err);
  process.exit(1);
});
