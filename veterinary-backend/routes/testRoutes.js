const express = require('express');
const router = express.Router();
const db = require('../config/database');
router.get('/hello', (req, res) => {
  res.json({ message: 'Hello from Vet API! 🐾' });
});
router.get('/db-test', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT COUNT(*) AS total FROM users');
    res.json({
      success: true,
      message: 'Database works! ✅',
      totalUsers: rows[0].total
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Database error ❌',
      error: err.message
    });
  }
});

router.get('/users', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, full_name, email, role FROM users'
    );
    res.json({ success: true, count: rows.length, users: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;