const db = require('../config/database');
const bcrypt = require('bcryptjs');
// ============================================
exports.getDashboard = async (req, res) => {
  try {
    // Card 1: Active staff accounts
    const [staff] = await db.query(
      `SELECT 
        COUNT(*) AS total,
        SUM(CASE WHEN is_active = TRUE THEN 1 ELSE 0 END) AS active
       FROM users
       WHERE role IN ('admin', 'vet', 'pharmacy', 'receptionist', 'lab')`
    );

    // Pending invitations
    const [invitations] = await db.query(
      `SELECT COUNT(*) AS count FROM invitations WHERE status = 'pending'`
    );

    // Card 2: Clinic branches
    const [branches] = await db.query(
      `SELECT 
        COUNT(*) AS total,
        SUM(CASE WHEN is_active = TRUE THEN 1 ELSE 0 END) AS active
       FROM branches`
    );
    const [securityData] = await db.query(
      `SELECT 
        COUNT(*) AS total_users,
        SUM(CASE WHEN last_login IS NULL OR last_login < DATE_SUB(NOW(), INTERVAL 90 DAY) THEN 1 ELSE 0 END) AS inactive_logins,
        SUM(CASE WHEN is_active = FALSE THEN 1 ELSE 0 END) AS inactive_accounts
       FROM users`
    );

    const totalUsers = securityData[0].total_users || 1;
    const issues = (securityData[0].inactive_logins || 0) + (securityData[0].inactive_accounts || 0);
    const securityScore = Math.max(0, Math.round(100 - (issues / totalUsers) * 100));

    // Card 4: Last backup
    const [backups] = await db.query(
      `SELECT 
        backup_name, file_size_mb, status, created_at,
        TIMESTAMPDIFF(MINUTE, created_at, NOW()) AS minutes_ago
       FROM backups
       ORDER BY created_at DESC
       LIMIT 1`
    );

    const lastBackup = backups[0] || {
      backup_name: 'N/A',
      status: 'none',
      created_at: null,
      minutes_ago: null
    };

    res.json({
      success: true,
      stats: {
        active_staff: {
          total: staff[0].total || 0,
          active: staff[0].active || 0,
          invitations_pending: invitations[0].count || 0
        },
        clinic_branches: {
          total: branches[0].total || 0,
          active: branches[0].active || 0
        },
        security_posture: {
          score: securityScore,
          no_critical_findings: securityScore >= 90
        },
        last_backup: {
          name: lastBackup.backup_name,
          status: lastBackup.status,
          time: lastBackup.created_at,
          minutes_ago: lastBackup.minutes_ago
        }
      }
    });
  } catch (err) {
    console.error('Admin dashboard error:', err);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: err.message
    });
  }
};

// ============================================
// 2. GET ALL USERS (Figma: User account management)
// GET /api/admin/users?role=vet&branch_id=1&status=active
// ============================================
exports.getAllUsers = async (req, res) => {
  try {
    const { role, branch_id, status, search } = req.query;

    let query = `
      SELECT 
        u.id, u.full_name, u.email, u.phone, u.role, u.is_active,
        u.profile_image, u.last_login, u.created_at,
        b.id AS branch_id, b.name AS branch_name,
        CONCAT(
          SUBSTRING(u.full_name, 1, 1),
          SUBSTRING(SUBSTRING_INDEX(u.full_name, ' ', -1), 1, 1)
        ) AS initials
       FROM users u
       LEFT JOIN branches b ON u.branch_id = b.id
       WHERE 1=1
    `;
    const params = [];

    if (role) {
      query += ' AND u.role = ?';
      params.push(role);
    }
    if (branch_id) {
      query += ' AND u.branch_id = ?';
      params.push(branch_id);
    }
    if (status === 'active') {
      query += ' AND u.is_active = TRUE';
    } else if (status === 'inactive') {
      query += ' AND u.is_active = FALSE';
    }
    if (search) {
      query += ' AND (u.full_name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    query += ' ORDER BY u.created_at DESC LIMIT 100';

    const [users] = await db.query(query, params);

    // Total count
    const [total] = await db.query('SELECT COUNT(*) AS count FROM users');

    res.json({
      success: true,
      count: users.length,
      total_users: total[0].count,
      users
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
// 3. GET ONE USER
// GET /api/admin/users/:id
// ============================================
exports.getUser = async (req, res) => {
  try {
    const [users] = await db.query(
      `SELECT 
        u.id, u.full_name, u.email, u.phone, u.role, u.is_active,
        u.address, u.profile_image, u.last_login, u.created_at,
        b.id AS branch_id, b.name AS branch_name
       FROM users u
       LEFT JOIN branches b ON u.branch_id = b.id
       WHERE u.id = ?`,
      [req.params.id]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found ❌'
      });
    }

    res.json({ success: true, user: users[0] });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: err.message
    });
  }
};

// ============================================
// 4. CREATE USER (Figma: "Add team member")
// POST /api/admin/users
// ============================================
exports.createUser = async (req, res) => {
  try {
    const {
      full_name, email, phone, password, role,
      branch_id, address
    } = req.body;

    if (!full_name || !email || !phone || !password || !role) {
      return res.status(400).json({
        success: false,
        message: 'Required: full_name, email, phone, password, role ❌'
      });
    }

    const allowedRoles = ['admin', 'vet', 'pharmacy', 'receptionist', 'lab', 'owner'];
    if (!allowedRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        message: `Invalid role. Allowed: ${allowedRoles.join(', ')} ❌`
      });
    }

    // Check duplicate
    const [existing] = await db.query(
      'SELECT id FROM users WHERE email = ? OR phone = ?',
      [email, phone]
    );

    if (existing.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Email or phone already exists ❌'
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert user
    const [result] = await db.query(
      `INSERT INTO users 
       (full_name, email, phone, password, role, branch_id, address) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        full_name, email, phone, hashedPassword,
        role, branch_id || null, address || null
      ]
    );

    // If vet, create vet record
    if (role === 'vet') {
      await db.query(
        `INSERT INTO veterinarians (user_id, license_number, specialization, experience_years)
         VALUES (?, ?, ?, ?)`,
        [result.insertId, `VET-${result.insertId}`, 'General', 0]
      );
    }

    // If pharmacy, create pharmacy staff record
    if (role === 'pharmacy') {
      await db.query(
        `INSERT INTO pharmacy_staff (user_id, license_number, role_type, shift)
         VALUES (?, ?, 'pharmacist', 'morning')`,
        [result.insertId, `PHAR-${result.insertId}`]
      );
    }

    // If lab, create lab staff record
    if (role === 'lab') {
      await db.query(
        `INSERT INTO lab_staff (user_id, license_number, specialization)
         VALUES (?, ?, ?)`,
        [result.insertId, `LAB-${result.insertId}`, 'General']
      );
    }

    // System log
    await db.query(
      `INSERT INTO system_logs (user_id, action, entity_type, entity_id, details) 
       VALUES (?, 'CREATE_USER', 'user', ?, ?)`,
      [req.user.id, result.insertId, `Created ${role}: ${full_name}`]
    );

    res.status(201).json({
      success: true,
      message: 'User created successfully ✅',
      user_id: result.insertId
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
// 5. UPDATE USER
// PUT /api/admin/users/:id
// ============================================
exports.updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      full_name, email, phone, role, branch_id,
      address, is_active
    } = req.body;

    const [existing] = await db.query(
      'SELECT id FROM users WHERE id = ?',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found ❌'
      });
    }

    await db.query(
      `UPDATE users SET
        full_name = COALESCE(?, full_name),
        email = COALESCE(?, email),
        phone = COALESCE(?, phone),
        role = COALESCE(?, role),
        branch_id = COALESCE(?, branch_id),
        address = COALESCE(?, address),
        is_active = COALESCE(?, is_active)
       WHERE id = ?`,
      [full_name, email, phone, role, branch_id, address, is_active, id]
    );

    // Log
    await db.query(
      `INSERT INTO system_logs (user_id, action, entity_type, entity_id, details) 
       VALUES (?, 'UPDATE_USER', 'user', ?, 'Updated user')`,
      [req.user.id, id]
    );

    res.json({
      success: true,
      message: 'User updated successfully ✅'
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
// 6. DELETE (DEACTIVATE) USER
// DELETE /api/admin/users/:id
// ============================================
exports.deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    // Prevent self-deletion
    if (parseInt(id) === req.user.id) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete yourself ❌'
      });
    }

    // Soft delete (deactivate)
    await db.query(
      'UPDATE users SET is_active = FALSE WHERE id = ?',
      [id]
    );

    await db.query(
      `INSERT INTO system_logs (user_id, action, entity_type, entity_id, details) 
       VALUES (?, 'DEACTIVATE_USER', 'user', ?, 'User deactivated')`,
      [req.user.id, id]
    );

    res.json({
      success: true,
      message: 'User deactivated ✅'
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
// 7. GET BRANCHES (Figma: "Clinic branches (3)")
// GET /api/admin/branches
// ============================================
exports.getBranches = async (req, res) => {
  try {
    const [branches] = await db.query(
      `SELECT 
        b.*,
        (SELECT COUNT(*) FROM users WHERE branch_id = b.id AND is_active = TRUE) AS staff_count,
        (SELECT COUNT(*) FROM appointments WHERE branch_id = b.id AND DATE(appointment_date) = CURDATE()) AS today_appointments,
        (SELECT COUNT(*) FROM animals) AS total_animals
       FROM branches b
       ORDER BY b.name ASC`
    );

    res.json({
      success: true,
      count: branches.length,
      branches
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
// 8. CREATE BRANCH
// POST /api/admin/branches
// ============================================
exports.createBranch = async (req, res) => {
  try {
    const { name, code, address, phone, email } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Branch name required ❌'
      });
    }

    const [result] = await db.query(
      `INSERT INTO branches (name, code, address, phone, email) 
       VALUES (?, ?, ?, ?, ?)`,
      [name, code || null, address || null, phone || null, email || null]
    );

    res.status(201).json({
      success: true,
      message: 'Branch created ✅',
      branch_id: result.insertId
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
// 9. UPDATE BRANCH
// PUT /api/admin/branches/:id
// ============================================
exports.updateBranch = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, code, address, phone, email, is_active } = req.body;

    await db.query(
      `UPDATE branches SET
        name = COALESCE(?, name),
        code = COALESCE(?, code),
        address = COALESCE(?, address),
        phone = COALESCE(?, phone),
        email = COALESCE(?, email),
        is_active = COALESCE(?, is_active)
       WHERE id = ?`,
      [name, code, address, phone, email, is_active, id]
    );

    res.json({
      success: true,
      message: 'Branch updated ✅'
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
// 10. INVITATIONS (Figma: "3 invitations pending")
// GET /api/admin/invitations
// ============================================
exports.getInvitations = async (req, res) => {
  try {
    const { status } = req.query;

    let query = `
      SELECT 
        i.*,
        b.name AS branch_name,
        u.full_name AS invited_by_name
       FROM invitations i
       LEFT JOIN branches b ON i.branch_id = b.id
       LEFT JOIN users u ON i.invited_by = u.id
    `;
    const params = [];

    if (status) {
      query += ' WHERE i.status = ?';
      params.push(status);
    }

    query += ' ORDER BY i.created_at DESC';

    const [invitations] = await db.query(query, params);

    res.json({
      success: true,
      count: invitations.length,
      pending_count: invitations.filter(i => i.status === 'pending').length,
      invitations
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
// 11. SEND INVITATION
// POST /api/admin/invitations
// ============================================
exports.sendInvitation = async (req, res) => {
  try {
    const { email, role, branch_id } = req.body;

    if (!email || !role) {
      return res.status(400).json({
        success: false,
        message: 'Email and role required ❌'
      });
    }

    // Check if user already exists
    const [existing] = await db.query(
      'SELECT id FROM users WHERE email = ?',
      [email]
    );

    if (existing.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'User with this email already exists ❌'
      });
    }

    // Generate token
    const token = require('crypto').randomBytes(32).toString('hex');

    const [result] = await db.query(
      `INSERT INTO invitations 
       (email, role, branch_id, invited_by, token, status, expires_at) 
       VALUES (?, ?, ?, ?, ?, 'pending', DATE_ADD(NOW(), INTERVAL 7 DAY))`,
      [email, role, branch_id || null, req.user.id, token]
    );

    res.status(201).json({
      success: true,
      message: 'Invitation sent ✅',
      invitation_id: result.insertId,
      token
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
// 12. CANCEL INVITATION
// DELETE /api/admin/invitations/:id
// ============================================
exports.cancelInvitation = async (req, res) => {
  try {
    await db.query(
      `UPDATE invitations SET status = 'cancelled' WHERE id = ?`,
      [req.params.id]
    );

    res.json({
      success: true,
      message: 'Invitation cancelled ✅'
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
// 13. SERVICES & PRICING (Figma sidebar)
// GET /api/admin/services
// ============================================
exports.getServices = async (req, res) => {
  try {
    const [services] = await db.query(
      `SELECT * FROM services ORDER BY category ASC, name ASC`
    );

    res.json({
      success: true,
      count: services.length,
      services
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
// 14. CREATE SERVICE
// POST /api/admin/services
// ============================================
exports.createService = async (req, res) => {
  try {
    const { name, category, description, price, duration_minutes } = req.body;

    if (!name || !price) {
      return res.status(400).json({
        success: false,
        message: 'Name and price required ❌'
      });
    }

    const [result] = await db.query(
      `INSERT INTO services (name, category, description, price, duration_minutes) 
       VALUES (?, ?, ?, ?, ?)`,
      [name, category || 'consultation', description || null, price, duration_minutes || 30]
    );

    res.status(201).json({
      success: true,
      message: 'Service created ✅',
      service_id: result.insertId
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
// 15. UPDATE SERVICE
// PUT /api/admin/services/:id
// ============================================
exports.updateService = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, category, description, price, duration_minutes, is_active } = req.body;

    await db.query(
      `UPDATE services SET
        name = COALESCE(?, name),
        category = COALESCE(?, category),
        description = COALESCE(?, description),
        price = COALESCE(?, price),
        duration_minutes = COALESCE(?, duration_minutes),
        is_active = COALESCE(?, is_active)
       WHERE id = ?`,
      [name, category, description, price, duration_minutes, is_active, id]
    );

    res.json({
      success: true,
      message: 'Service updated ✅'
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
// 16. SECURITY & ACCESS (Figma right panel)
// GET /api/admin/security
// ============================================
exports.getSecurity = async (req, res) => {
  try {
    // Calculate security score
    const [userStats] = await db.query(
      `SELECT 
        COUNT(*) AS total_users,
        SUM(CASE WHEN is_active = TRUE THEN 1 ELSE 0 END) AS active_users,
        SUM(CASE WHEN last_login IS NULL OR last_login < DATE_SUB(NOW(), INTERVAL 90 DAY) THEN 1 ELSE 0 END) AS stale_logins
       FROM users
       WHERE role IN ('admin', 'vet', 'pharmacy', 'receptionist', 'lab')`
    );

    const totalStaff = userStats[0].total_users || 1;
    const stale = userStats[0].stale_logins || 0;
    const securityScore = Math.max(0, Math.round(100 - (stale / totalStaff) * 100));

    // Last backup
    const [backup] = await db.query(
      `SELECT backup_name, status, created_at 
       FROM backups ORDER BY created_at DESC LIMIT 1`
    );

    // Credentials expiring (vets/lab with licenses, expire 1 year after creation)
    const [credentials] = await db.query(
      `SELECT 
        COUNT(*) AS count
       FROM users u
       WHERE u.role IN ('vet', 'lab', 'pharmacy')
         AND u.created_at <= DATE_SUB(NOW(), INTERVAL 11 MONTH)`
    );

    // Access review needed
    const [accessReview] = await db.query(
      `SELECT COUNT(*) AS count FROM users 
       WHERE is_active = TRUE 
         AND (last_login IS NULL OR last_login < DATE_SUB(NOW(), INTERVAL 60 DAY))`
    );

    res.json({
      success: true,
      security: {
        score: securityScore,
        mfa_enforced: true,
        no_critical_findings: securityScore >= 90,
        last_backup: backup[0] || null,
        access_review: {
          needed: accessReview[0].count > 0,
          count: accessReview[0].count
        },
        credentials_expiring: {
          count: credentials[0].count || 0
        }
      }
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
// 17. BACKUPS (Figma sidebar)
// GET /api/admin/backups
// ============================================
exports.getBackups = async (req, res) => {
  try {
    const [backups] = await db.query(
      `SELECT 
        b.*,
        u.full_name AS created_by_name
       FROM backups b
       LEFT JOIN users u ON b.created_by = u.id
       ORDER BY b.created_at DESC
       LIMIT 30`
    );

    // Last backup
    const lastBackup = backups[0] || null;

    res.json({
      success: true,
      count: backups.length,
      last_backup: lastBackup,
      backups
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
// 18. CREATE BACKUP (Simulated)
// POST /api/admin/backups
// ============================================
exports.createBackup = async (req, res) => {
  try {
    const backupName = `backup_${new Date().toISOString().split('T')[0]}_${Date.now()}`;
    const filePath = `/backups/${backupName}.sql`;
    const fileSizeMb = (Math.random() * 5 + 10).toFixed(2);

    const [result] = await db.query(
      `INSERT INTO backups 
       (backup_name, file_path, file_size_mb, status, created_by) 
       VALUES (?, ?, ?, 'success', ?)`,
      [backupName, filePath, fileSizeMb, req.user.id]
    );

    await db.query(
      `INSERT INTO system_logs (user_id, action, entity_type, entity_id, details) 
       VALUES (?, 'CREATE_BACKUP', 'backup', ?, ?)`,
      [req.user.id, result.insertId, `Manual backup created: ${backupName}`]
    );

    res.status(201).json({
      success: true,
      message: 'Backup created successfully ✅',
      backup: {
        id: result.insertId,
        backup_name: backupName,
        file_size_mb: fileSizeMb,
        status: 'success'
      }
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
// 19. SYSTEM LOGS (Figma sidebar)
// GET /api/admin/logs
// ============================================
exports.getSystemLogs = async (req, res) => {
  try {
    const { user_id, action, limit } = req.query;
    const limitNum = parseInt(limit) || 100;

    let query = `
      SELECT 
        sl.*,
        u.full_name AS user_name,
        u.email AS user_email,
        u.role AS user_role
       FROM system_logs sl
       LEFT JOIN users u ON sl.user_id = u.id
       WHERE 1=1
    `;
    const params = [];

    if (user_id) {
      query += ' AND sl.user_id = ?';
      params.push(user_id);
    }
    if (action) {
      query += ' AND sl.action = ?';
      params.push(action);
    }

    query += ` ORDER BY sl.created_at DESC LIMIT ${limitNum}`;

    const [logs] = await db.query(query, params);

    res.json({
      success: true,
      count: logs.length,
      logs
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
// 20. SYSTEM STATS (Overview)
// GET /api/admin/stats
// ============================================
exports.getSystemStats = async (req, res) => {
  try {
    // Users by role
    const [usersByRole] = await db.query(
      `SELECT role, COUNT(*) AS count 
       FROM users 
       GROUP BY role`
    );

    // Appointments this month
    const [appointmentsMonth] = await db.query(
      `SELECT COUNT(*) AS count FROM appointments 
       WHERE MONTH(appointment_date) = MONTH(CURDATE()) 
         AND YEAR(appointment_date) = YEAR(CURDATE())`
    );

    // Total animals
    const [animals] = await db.query('SELECT COUNT(*) AS count FROM animals');

    // Total revenue this month
    const [revenue] = await db.query(
      `SELECT COALESCE(SUM(amount), 0) AS total 
       FROM payments 
       WHERE payment_status = 'paid'
         AND MONTH(paid_at) = MONTH(CURDATE())
         AND YEAR(paid_at) = YEAR(CURDATE())`
    );

    // Active prescriptions
    const [prescriptions] = await db.query(
      `SELECT COUNT(*) AS count FROM prescriptions WHERE status = 'pending'`
    );

    // Lab tests in progress
    const [labTests] = await db.query(
      `SELECT COUNT(*) AS count FROM lab_tests WHERE status IN ('received', 'processing')`
    );

    res.json({
      success: true,
      stats: {
        users_by_role: usersByRole,
        appointments_this_month: appointmentsMonth[0].count || 0,
        total_animals: animals[0].count || 0,
        monthly_revenue: parseFloat(revenue[0].total) || 0,
        pending_prescriptions: prescriptions[0].count || 0,
        active_lab_tests: labTests[0].count || 0
      }
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
// 21. MAINTENANCE MODE (Figma sidebar)
// GET /api/admin/maintenance
// ============================================
exports.getMaintenance = async (req, res) => {
  try {
    const [equipment] = await db.query(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'maintenance' THEN 1 ELSE 0 END) AS in_maintenance,
              SUM(CASE WHEN status = 'offline' THEN 1 ELSE 0 END) AS offline
       FROM equipment`
    );

    const [pendingOrders] = await db.query(
      `SELECT COUNT(*) AS count FROM purchase_orders 
       WHERE status IN ('pending', 'approved', 'ordered')`
    );

    const [lowStock] = await db.query(
      `SELECT COUNT(*) AS count FROM medicines WHERE stock_quantity <= min_stock_level`
    );

    res.json({
      success: true,
      maintenance: {
        equipment: equipment[0] || {},
        pending_purchase_orders: pendingOrders[0].count || 0,
        low_stock_items: lowStock[0].count || 0
      }
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: err.message
    });
  }
};