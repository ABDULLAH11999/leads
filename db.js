require('dotenv').config();

const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.warn('[DB] DATABASE_URL is not set. Database queries will fail until it is configured.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function query(text, params) {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not configured.');
  }

  try {
    return await pool.query(text, params);
  } catch (error) {
    console.error('[DB] Query failed:', {
      message: error.message,
      query: text
    });
    throw error;
  }
}

module.exports = {
  isDatabaseConfigured: () => Boolean(process.env.DATABASE_URL),
  pool,
  query
};
