const db = require('../config/database');
const bcrypt = require('bcryptjs');

// ============================================
// 1. DASHBOARD - 4 Stat Cards
// GET /api/receptionist/dashboard
// Figma: Appointments(27), Checked in(6), Unpaid(4), New reg(5)
// ============================================
exports.getDashboard = async (req, res) => {
  try {
    // Card 1: Today's appointments
    const [todayAppts] = await db.query(
      `SELECT 
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN status IN ('cancelled', 'no_show') THEN 1 ELSE 0 END) AS changes
       FROM appointments
       WHERE DATE(appointment_date) = CURDATE()`
    );

    // Card 2: Checked in
    const [checkedIn] = await db.query(
      `SELECT 
        COUNT(*) AS count,
        COALESCE(AVG(TIMESTAMPDIFF(MINUTE, check_in_time, NOW())), 0) AS avg_wait
       FROM appointments
       WHERE status = 'checked_in'
         AND DATE(appointment_date) = CURDATE()`
    );

    // Card 3: Unpaid invoices
    const [unpaid] = await db.query(
      `SELECT 
        COUNT(*) AS count,
        COALESCE(SUM(total), 0) AS outstanding
       FROM invoices
       WHERE status IN ('unpaid', 'partial')`
    );

    // Card 4: New registrations today
    const [newRegs] = await db.query(
      `SELECT 
        COUNT(*) AS count
       FROM users
       WHERE role = 'owner'
         AND DATE(created_at) = CURDATE()`
    );

    // Awaiting consultation count (Figma: "2 awaiting cons...")
    const [awaiting] = await db.query(
      `SELECT COUNT(*) AS count
       FROM appointments
       WHERE status = 'checked_in'
         AND DATE(appointment_date) = CURDATE()`
    );

    // Get receptionist info
    const [receptionist] = await db.query(
      `SELECT u.full_name, u.profile_image, b.name AS branch_name
       FROM users u
       LEFT JOIN branches b ON u.branch_id = b.id
       WHERE u.id = ?`,
      [req.user.id]
    );

    res.json({
      success: true,
      receptionist: receptionist[0] || {},
      stats: {
        appointments_today: {
          total: todayAppts[0].total || 0,
          completed: todayAppts[0].completed || 0,
          changes: todayAppts[0].changes || 0
        },
        checked_in: {
          count: checkedIn[0].count || 0,
          average_wait_minutes: Math.round(checkedIn[0].avg_wait) || 0
        },
        unpaid_invoices: {
          count: unpaid[0].count || 0,
          outstanding_amount: parseFloat(unpaid[0].outstanding) || 0
        },
        new_registrations: {
          count: newRegs[0].count || 0,
          awaiting_consultation: awaiting[0].count || 0
        }
      }
    });
  } catch (err) {
    console.error('Receptionist dashboard error:', err);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: err.message
    });
  }
};

// ============================================
// 2. CHECK-IN QUEUE
// GET /api/receptionist/check-in-queue?filter=all
// Figma: Check-in queue with filters (All 6, Waiting 3, etc.)
// ============================================
exports.getCheckInQueue = async (req, res) => {
  try {
    const { filter } = req.query; // all | waiting | with_clinician | expected

    let statusFilter = '';
    if (filter === 'waiting') {
      statusFilter = "AND a.status = 'checked_in'";
    } else if (filter === 'with_clinician') {
      statusFilter = "AND a.status = 'in_consultation'";
    } else if (filter === 'expected') {
      statusFilter = "AND a.status IN ('pending', 'confirmed')";
    }

    const [queue] = await db.query(
      `SELECT 
        a.id AS appointment_id,
        a.appointment_date, a.reason, a.status, a.check_in_time,
        TIMESTAMPDIFF(MINUTE, a.check_in_time, NOW()) AS wait_minutes,
        an.id AS animal_id, an.name AS animal_name, an.species,
        an.breed, an.photo AS animal_photo,
        u.id AS owner_id, u.full_name AS owner_name, u.phone AS owner_phone,
        CONCAT(
          SUBSTRING(u.full_name, 1, 1),
          SUBSTRING(SUBSTRING_INDEX(u.full_name, ' ', -1), 1, 1)
        ) AS owner_initials,
        s.name AS service_name,
        vst.full_name AS vet_name,
        CASE
          WHEN a.status = 'in_consultation' THEN 'with_clinician'
          WHEN a.status = 'checked_in' 
            AND TIMESTAMPDIFF(MINUTE, a.check_in_time, NOW()) > 30 THEN 'triage_now'
          WHEN a.status = 'checked_in' THEN 'checked_in'
          WHEN a.status IN ('pending', 'confirmed') THEN 'expected'
          ELSE a.status
        END AS display_status
       FROM appointments a
       JOIN animals an ON a.animal_id = an.id
       JOIN users u ON a.owner_id = u.id
       LEFT JOIN services s ON a.service_id = s.id
       LEFT JOIN veterinarians v ON a.vet_id = v.id
       LEFT JOIN users vst ON v.user_id = vst.id
       WHERE DATE(a.appointment_date) = CURDATE()
         AND a.status NOT IN ('completed', 'cancelled', 'no_show')
         ${statusFilter}
       ORDER BY 
         CASE a.status
           WHEN 'in_consultation' THEN 1
           WHEN 'checked_in' THEN 2
           WHEN 'confirmed' THEN 3
           WHEN 'pending' THEN 4
           ELSE 5
         END,
         a.check_in_time ASC`,
      []
    );

    // Counts for filter tabs
    const [counts] = await db.query(
      `SELECT 
        COUNT(*) AS all_count,
        SUM(CASE WHEN status = 'checked_in' THEN 1 ELSE 0 END) AS waiting,
        SUM(CASE WHEN status = 'in_consultation' THEN 1 ELSE 0 END) AS with_clinician,
        SUM(CASE WHEN status IN ('pending', 'confirmed') THEN 1 ELSE 0 END) AS expected
       FROM appointments
       WHERE DATE(appointment_date) = CURDATE()
         AND status NOT IN ('completed', 'cancelled', 'no_show')`
    );

    res.json({
      success: true,
      count: queue.length,
      filter_counts: {
        all: counts[0].all_count || 0,
        waiting: counts[0].waiting || 0,
        with_clinician: counts[0].with_clinician || 0,
        expected: counts[0].expected || 0
      },
      queue
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
// 3. CHECK-IN PATIENT
// PUT /api/receptionist/check-in/:id
// Figma: "Check in patient" button
// ============================================
exports.checkInPatient = async (req, res) => {
  try {
    const { id } = req.params;

    const [existing] = await db.query(
      'SELECT id, status FROM appointments WHERE id = ?',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found ❌'
      });
    }

    if (existing[0].status === 'checked_in') {
      return res.status(400).json({
        success: false,
        message: 'Already checked in ❌'
      });
    }

    await db.query(
      `UPDATE appointments 
       SET status = 'checked_in', check_in_time = NOW() 
       WHERE id = ?`,
      [id]
    );

    res.json({
      success: true,
      message: 'Patient checked in successfully ✅',
      check_in_time: new Date().toISOString()
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
// 4. TODAY'S APPOINTMENTS (All)
// GET /api/receptionist/appointments
// Figma: "Appointments (27)"
// ============================================
exports.getAllAppointments = async (req, res) => {
  try {
    const { status, date } = req.query;
    const filterDate = date || new Date().toISOString().split('T')[0];

    let query = `
      SELECT 
        a.*,
        an.name AS animal_name, an.species, an.photo AS animal_photo,
        u.full_name AS owner_name, u.phone AS owner_phone,
        vst.full_name AS vet_name,
        s.name AS service_name, s.price AS service_price
      FROM appointments a
      JOIN animals an ON a.animal_id = an.id
      JOIN users u ON a.owner_id = u.id
      LEFT JOIN veterinarians v ON a.vet_id = v.id
      LEFT JOIN users vst ON v.user_id = vst.id
      LEFT JOIN services s ON a.service_id = s.id
      WHERE DATE(a.appointment_date) = ?
    `;
    const params = [filterDate];

    if (status) {
      query += ' AND a.status = ?';
      params.push(status);
    }

    query += ' ORDER BY a.appointment_date ASC';

    const [appointments] = await db.query(query, params);

    res.json({
      success: true,
      date: filterDate,
      count: appointments.length,
      appointments
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
// 5. REGISTER OWNER & ANIMAL (Figma right panel)
// POST /api/receptionist/register
// ============================================
exports.registerOwnerAndAnimal = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const {
      // Owner data
      owner_full_name, owner_email, owner_phone, owner_address, owner_password,
      // Animal data
      animal_name, animal_species, animal_breed, animal_age_months,
      animal_gender, animal_color, animal_weight_kg, animal_microchip_id
    } = req.body;

    // Validation
    if (!owner_full_name || !owner_phone) {
      return res.status(400).json({
        success: false,
        message: 'Owner name and phone required ❌'
      });
    }

    if (!animal_name || !animal_species || !animal_gender) {
      return res.status(400).json({
        success: false,
        message: 'Animal name, species, gender required ❌'
      });
    }

    // Check if owner exists
    let ownerId;
    const [existingOwner] = await connection.query(
      'SELECT id FROM users WHERE phone = ? OR (email IS NOT NULL AND email = ?)',
      [owner_phone, owner_email || '']
    );

    if (existingOwner.length > 0) {
      ownerId = existingOwner[0].id;
    } else {
      // Create new owner
      const password = owner_password || 'pass123';
      const hashedPassword = await bcrypt.hash(password, 10);

      const [result] = await connection.query(
        `INSERT INTO users 
         (full_name, email, phone, password, role, address) 
         VALUES (?, ?, ?, ?, 'owner', ?)`,
        [
          owner_full_name,
          owner_email || null,
          owner_phone,
          hashedPassword,
          owner_address || null
        ]
      );
      ownerId = result.insertId;
    }

    // Create animal
    const [animalResult] = await connection.query(
      `INSERT INTO animals 
       (owner_id, name, species, breed, age_months, gender, 
        color, weight_kg, microchip_id) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ownerId, animal_name, animal_species, animal_breed || null,
        animal_age_months || null, animal_gender, animal_color || null,
        animal_weight_kg || null, animal_microchip_id || null
      ]
    );

    await connection.commit();

    res.status(201).json({
      success: true,
      message: 'Owner and animal registered successfully ✅',
      owner: {
        id: ownerId,
        full_name: owner_full_name,
        phone: owner_phone
      },
      animal: {
        id: animalResult.insertId,
        name: animal_name,
        species: animal_species
      }
    });
  } catch (err) {
    await connection.rollback();
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: err.message
    });
  } finally {
    connection.release();
  }
};

// ============================================
// 6. SEARCH OWNER (Figma: "Maya Hernandez" search)
// GET /api/receptionist/search-owner?q=maya
// ============================================
exports.searchOwner = async (req, res) => {
  try {
    const { q } = req.query;

    if (!q) {
      return res.status(400).json({
        success: false,
        message: 'Search query required ❌'
      });
    }

    const [owners] = await db.query(
      `SELECT 
        u.id, u.full_name, u.email, u.phone, u.address,
        (SELECT COUNT(*) FROM animals WHERE owner_id = u.id) AS animal_count
       FROM users u
       WHERE u.role = 'owner'
         AND (u.full_name LIKE ? OR u.phone LIKE ? OR u.email LIKE ?)
       LIMIT 10`,
      [`%${q}%`, `%${q}%`, `%${q}%`]
    );

    res.json({
      success: true,
      count: owners.length,
      owners
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
// 7. GET OWNER & ANIMALS
// GET /api/receptionist/owners/:id
// ============================================
exports.getOwnerDetail = async (req, res) => {
  try {
    const [owners] = await db.query(
      `SELECT id, full_name, email, phone, address, created_at
       FROM users WHERE id = ? AND role = 'owner'`,
      [req.params.id]
    );

    if (owners.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Owner not found ❌'
      });
    }

    const [animals] = await db.query(
      `SELECT * FROM animals WHERE owner_id = ? ORDER BY created_at DESC`,
      [req.params.id]
    );

    const [invoices] = await db.query(
      `SELECT * FROM invoices WHERE owner_id = ? ORDER BY created_at DESC LIMIT 10`,
      [req.params.id]
    );

    res.json({
      success: true,
      owner: owners[0],
      animals,
      invoices
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
// 8. UNPAID INVOICES
// GET /api/receptionist/unpaid-invoices
// Figma: "4 unpaid, $486.50 outstanding"
// ============================================
exports.getUnpaidInvoices = async (req, res) => {
  try {
    const [invoices] = await db.query(
      `SELECT 
        i.id, i.invoice_number, i.total, i.status, 
        i.due_date, i.created_at,
        u.id AS owner_id, u.full_name AS owner_name, u.phone AS owner_phone,
        an.name AS animal_name, an.species
       FROM invoices i
       JOIN users u ON i.owner_id = u.id
       LEFT JOIN animals an ON i.animal_id = an.id
       WHERE i.status IN ('unpaid', 'partial')
       ORDER BY i.created_at DESC`
    );

    const totalOutstanding = invoices.reduce(
      (sum, inv) => sum + parseFloat(inv.total), 0
    );

    res.json({
      success: true,
      count: invoices.length,
      total_outstanding: parseFloat(totalOutstanding.toFixed(2)),
      invoices
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
// 9. CREATE INVOICE (Figma: INV-10984)
// POST /api/receptionist/invoices
// ============================================
exports.createInvoice = async (req, res) => {
  try {
    const {
      owner_id, animal_id, appointment_id,
      items, tax, discount, notes
    } = req.body;

    if (!owner_id || !items || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Owner ID and items required ❌'
      });
    }

    // Calculate totals
    const subtotal = items.reduce((sum, item) => {
      return sum + (parseFloat(item.unit_price) * parseInt(item.quantity));
    }, 0);

    const taxAmount = tax ? parseFloat(tax) : subtotal * 0.15;
    const discountAmount = discount ? parseFloat(discount) : 0;
    const total = subtotal + taxAmount - discountAmount;

    // Generate invoice number
    const [count] = await db.query('SELECT COUNT(*) AS total FROM invoices');
    const invoiceNumber = `INV-${10984 + count[0].total + 1}`;

    // Insert invoice
    const [result] = await db.query(
      `INSERT INTO invoices 
       (invoice_number, owner_id, animal_id, appointment_id,
        subtotal, tax, discount, total, status, notes, created_by) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unpaid', ?, ?)`,
      [
        invoiceNumber, owner_id, animal_id || null, appointment_id || null,
        subtotal, taxAmount, discountAmount, total,
        notes || null, req.user.id
      ]
    );

    res.status(201).json({
      success: true,
      message: 'Invoice created ✅',
      invoice: {
        id: result.insertId,
        invoice_number: invoiceNumber,
        subtotal,
        tax: taxAmount,
        discount: discountAmount,
        total,
        status: 'unpaid'
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
// 10. PROCESS PAYMENT
// POST /api/receptionist/payments
// ============================================
exports.processPayment = async (req, res) => {
  try {
    const {
      invoice_id, amount, payment_method, transaction_id
    } = req.body;

    if (!invoice_id || !amount) {
      return res.status(400).json({
        success: false,
        message: 'invoice_id and amount required ❌'
      });
    }

    // Check invoice
    const [invoices] = await db.query(
      'SELECT id, total, status FROM invoices WHERE id = ?',
      [invoice_id]
    );

    if (invoices.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found ❌'
      });
    }

    // Record payment
    const [result] = await db.query(
      `INSERT INTO payments 
       (invoice_id, amount, payment_method, payment_status, 
        transaction_id, paid_at, received_by) 
       VALUES (?, ?, ?, 'paid', ?, NOW(), ?)`,
      [
        invoice_id, amount, payment_method || 'cash',
        transaction_id || null, req.user.id
      ]
    );

    // Update invoice status
    const newStatus = parseFloat(amount) >= parseFloat(invoices[0].total)
      ? 'paid' : 'partial';

    await db.query(
      'UPDATE invoices SET status = ? WHERE id = ?',
      [newStatus, invoice_id]
    );

    // Notify owner
    const [owner] = await db.query(
      `SELECT u.id FROM invoices i 
       JOIN users u ON i.owner_id = u.id 
       WHERE i.id = ?`,
      [invoice_id]
    );

    if (owner.length > 0) {
      await db.query(
        `INSERT INTO notifications (user_id, title, message, type) 
         VALUES (?, ?, ?, 'payment')`,
        [
          owner[0].id,
          'ክፍያ ተቀብሏል',
          `ክፍያዎ በተሳካ ሁኔታ ተቀብሏል (${amount} ብር)`
        ]
      );
    }

    res.status(201).json({
      success: true,
      message: 'Payment processed ✅',
      payment_id: result.insertId,
      invoice_status: newStatus
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
// 11. GET INVOICE DETAIL (Figma right panel)
// GET /api/receptionist/invoices/:id
// ============================================
exports.getInvoiceDetail = async (req, res) => {
  try {
    const [invoices] = await db.query(
      `SELECT 
        i.*,
        u.id AS owner_id, u.full_name AS owner_name, u.phone AS owner_phone,
        an.name AS animal_name, an.species, an.breed
       FROM invoices i
       JOIN users u ON i.owner_id = u.id
       LEFT JOIN animals an ON i.animal_id = an.id
       WHERE i.id = ?`,
      [req.params.id]
    );

    if (invoices.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found ❌'
      });
    }

    const [payments] = await db.query(
      `SELECT * FROM payments WHERE invoice_id = ? ORDER BY created_at DESC`,
      [req.params.id]
    );

    res.json({
      success: true,
      invoice: invoices[0],
      payments
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
// 12. NEW REGISTRATIONS
// GET /api/receptionist/new-registrations
// Figma: "5 New registrations"
// ============================================
exports.getNewRegistrations = async (req, res) => {
  try {
    const [registrations] = await db.query(
      `SELECT 
        u.id, u.full_name, u.email, u.phone, u.address, u.created_at,
        (SELECT COUNT(*) FROM animals WHERE owner_id = u.id) AS animal_count,
        (SELECT COUNT(*) FROM appointments WHERE owner_id = u.id AND status = 'checked_in') AS awaiting_consultation
       FROM users u
       WHERE u.role = 'owner'
         AND DATE(u.created_at) >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
       ORDER BY u.created_at DESC
       LIMIT 20`
    );

    res.json({
      success: true,
      count: registrations.length,
      today_count: registrations.filter(
        r => new Date(r.created_at).toDateString() === new Date().toDateString()
      ).length,
      registrations
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
// 13. RESCHEDULE APPOINTMENT
// PUT /api/receptionist/reschedule/:id
// Figma: "Reschedule" button
// ============================================
exports.rescheduleAppointment = async (req, res) => {
  try {
    const { id } = req.params;
    const { new_date, new_vet_id, reason } = req.body;

    if (!new_date) {
      return res.status(400).json({
        success: false,
        message: 'new_date required ❌'
      });
    }

    const [existing] = await db.query(
      'SELECT id FROM appointments WHERE id = ?',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found ❌'
      });
    }

    await db.query(
      `UPDATE appointments 
       SET appointment_date = ?,
           vet_id = COALESCE(?, vet_id),
           reason = COALESCE(?, reason),
           status = 'confirmed',
           check_in_time = NULL
       WHERE id = ?`,
      [new_date, new_vet_id || null, reason || null, id]
    );

    res.json({
      success: true,
      message: 'Appointment rescheduled ✅',
      new_date
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
// 14. CREATE WALK-IN APPOINTMENT
// POST /api/receptionist/walk-in
// Figma: "Urgent walk-in"
// ============================================
exports.createWalkIn = async (req, res) => {
  try {
    const {
      owner_id, animal_id, vet_id, reason, service_id, priority
    } = req.body;

    if (!owner_id || !animal_id || !vet_id) {
      return res.status(400).json({
        success: false,
        message: 'owner_id, animal_id, vet_id required ❌'
      });
    }

    const [result] = await db.query(
      `INSERT INTO appointments 
       (owner_id, animal_id, vet_id, service_id, appointment_date, 
        reason, status, check_in_time) 
       VALUES (?, ?, ?, ?, NOW(), ?, 'checked_in', NOW())`,
      [
        owner_id, animal_id, vet_id, service_id || null,
        reason || 'Walk-in'
      ]
    );

    res.status(201).json({
      success: true,
      message: 'Walk-in appointment created ✅',
      appointment_id: result.insertId
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: err.message
    });
  }
};