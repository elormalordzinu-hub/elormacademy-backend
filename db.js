// File: db.js | PostgreSQL Connection Pool
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    },
    min: 2,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000,
    statement_timeout: 30000,
    query_timeout: 30000,
    keepAlive: true
});

pool.on('error', (err, client) => {
    console.error('[PostgreSQL] Unexpected error on idle database client:', err.message);
});

pool.on('connect', () => {
    console.log('[PostgreSQL] Connected to database successfully!');
});

module.exports = pool;