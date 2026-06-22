const sql = require("mssql");

const dbConfig = {
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: {
    trustServerCertificate: true,
    enableArithAbort: true,
  },
};

async function query(text, params = {}) {
  const pool = await sql.connect(dbConfig);
  const request = pool.request();
  for (const [key, value] of Object.entries(params)) {
    request.input(key, value);
  }
  return request.query(text);
}

module.exports = { query };
