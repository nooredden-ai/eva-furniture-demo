require('dotenv').config();
const pool = require('./config/db');

(async () => {
  try {
    const res = await pool.query('SELECT NOW()');
    console.log('✅ Database connection successful. Time:', res.rows[0].now);
    process.exit(0);
  } catch (err) {
    console.error('❌ Database connection failed:', err.message);
    process.exit(1);
  }
})();
