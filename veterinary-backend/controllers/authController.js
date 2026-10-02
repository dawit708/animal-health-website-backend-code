const bcrypt = require('bcryptjs');
const db = require('../config/database');
const generateToken = require('../utils/generateToken');

// ============================================
// REGISTER - አዲስ ተጠቃሚ መመዝገብ
// POST /api/auth/register
// ============================================
exports.register = async (req, res) => {
  try {
    const { full_name, email, phone, password, role, address, branch_id } = req.body;

    // 1. Validation
    if (!full_name || !email || !phone || !password) {
      return res.status(400).json({
        success: false,
        message: 'All fields required: full_name, email, phone, password ❌'
      });
    }

    // 2. Check if user exists
    const [existing] = await db.query(
      'SELECT id FROM users WHERE email = ? OR phone = ?',
      [email, phone]
    );

    if (existing.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'User with this email or phone already exists ❌'
      });
    }

    // 3. Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // 4. Allowed roles
    const allowedRoles = ['admin', 'vet', 'pharmacy', 'receptionist', 'lab', 'owner'];
    const userRole = allowedRoles.includes(role) ? role : 'owner';

    // 5. Insert user
    const [result] = await db.query(
      `INSERT INTO users 
       (full_name, email, phone, password, role, address, branch_id) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [full_name, email, phone, hashedPassword, userRole, address || null, branch_id || null]
    );

    // 6. Get new user
    const [newUser] = await db.query(
      `SELECT id, full_name, email, phone, role, branch_id, created_at 
       FROM users WHERE id = ?`,
      [result.insertId]
    );

    // 7. Generate token
    const token = generateToken(newUser[0]);

    res.status(201).json({
      success: true,
      message: 'Registered successfully ✅',
      token,
      user: newUser[0]
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({
      success: false,
      message: 'Server error during registration',
      error: err.message
    });
  }
};

// ============================================
// LOGIN - መግቢያ
// POST /api/auth/login
// ============================================
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // 1. Validation
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password required ❌'
      });
    }

    // 2. Find user
    const [users] = await db.query(
      `SELECT u.*, b.name AS branch_name 
       FROM users u
       LEFT JOIN branches b ON u.branch_id = b.id
       WHERE u.email = ?`,
      [email]
    );

    if (users.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials ❌'
      });
    }

    const user = users[0];

    // 3. Check if active
    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        message: 'Account is deactivated ❌'
      });
    }

    // 4. Verify password
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials ❌'
      });
    }

    // 5. Update last login
    await db.query('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);

    // 6. Generate token
    const token = generateToken(user);

    // 7. Response
    res.json({
      success: true,
      message: 'Login successful ✅',
      token,
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        branch_id: user.branch_id,
        branch_name: user.branch_name,
        profile_image: user.profile_image,
        last_login: user.last_login
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({
      success: false,
      message: 'Server error during login',
      error: err.message
    });
  }
};

// ============================================
// GET ME - የአሁኑ ተጠቃሚ
// GET /api/auth/me
// ============================================
exports.getMe = async (req, res) => {
  try {
    const [users] = await db.query(
      `SELECT u.id, u.full_name, u.email, u.phone, u.role, u.branch_id, 
              u.address, u.profile_image, u.created_at,
              b.name AS branch_name
       FROM users u
       LEFT JOIN branches b ON u.branch_id = b.id
       WHERE u.id = ?`,
      [req.user.id]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found ❌'
      });
    }

    res.json({
      success: true,
      user: users[0]
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: err.message
    });
  }
};

// ============================================
// CHANGE PASSWORD
// PUT /api/auth/password
// ============================================
exports.changePassword = async (req, res) => {
  try {
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
      return res.status(400).json({
        success: false,
        message: 'Current and new password required ❌'
      });
    }

    if (new_password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters ❌'
      });
    }

    // Get current user
    const [users] = await db.query('SELECT password FROM users WHERE id = ?', [req.user.id]);

    if (users.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found ❌' });
    }

    // Verify current password
    const isMatch = await bcrypt.compare(current_password, users[0].password);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Current password is incorrect ❌'
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(new_password, 10);

    // Update
    await db.query('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, req.user.id]);

    res.json({
      success: true,
      message: 'Password changed successfully ✅'
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: err.message
    });
  }
};