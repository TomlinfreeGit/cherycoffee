// filepath: coffee-app/server/src/services/pickup.js
const { db } = require('../db');

function getTodayString() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

/**
 * Generate next pickup number for today in format YYYYMMDD-001
 * Atomically increments the daily counter and returns the new pickup number.
 */
function generatePickupNumber() {
  const today = getTodayString();

  // Upsert: insert with 1 or increment existing
  const upsert = db.prepare(`
    INSERT INTO daily_counter (date, last_number)
    VALUES (?, 1)
    ON CONFLICT(date) DO UPDATE SET last_number = last_number + 1
    RETURNING last_number
  `);

  const row = upsert.get(today);
  const seq = String(row.last_number).padStart(3, '0');
  return `${today}-${seq}`;
}

module.exports = { generatePickupNumber, getTodayString };
