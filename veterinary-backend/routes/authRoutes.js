const express = require('express');
const router = express.Router();

const {
  register,
  login,
  getMe,
  changePassword
} = require('../controllers/authController');

const authMiddleware = require('../middleware/authMiddleware');

// Public routes
router.post('/register', register);
router.post('/login', login);

// Protected routes (need token)
router.get('/me', authMiddleware, getMe);
router.put('/password', authMiddleware, changePassword);

module.exports = router;