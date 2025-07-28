const { Client } = require("pg");

let connectionString = process.env.DATABASE_URL;
// Extract the database name from the connection string
const targetDatabase = connectionString.match(/\/([^\/?]+)(?=\?|$)/)[1];
// Replace target database with 'postgres'
connectionString = connectionString.replace(/(\/)[^\/?]+(\?)?$/, "/postgres$2");

const client = new Client({
  connectionString: connectionString,
});

client
  .connect()
  .then(() => {
    return client.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [
      targetDatabase,
    ]);
  })
  .then((result) => {
    if (result.rows.length === 0) {
      console.log(`Database "${targetDatabase}" does not exist. Creating...`);
      return client.query(`CREATE DATABASE ${targetDatabase}`);
    } else {
      console.log(`Database "${targetDatabase}" already exists.`);
    }
  })
  .then(() => {
    console.log("Operation completed successfully!");
    client.end();
  })
  .catch((err) => {
    console.error("Operation failed:", err);
    client.end();
  });
