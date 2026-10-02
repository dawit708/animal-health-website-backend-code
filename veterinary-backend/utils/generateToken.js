const jwt = require('jsonwebtoken');
require('dotenv').config();

const generateToken = (user) => {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      branch_id: user.branch_id
    },
    process.env.JWT_SECRET || 'vet_secret_key_2026',
    {
      expiresIn: process.env.JWT_EXPIRES || '7d'
    }
  );
};

module.exports = generateToken;