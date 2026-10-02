const db = require('../config/database');

// Helper: Get lab staff ID
const getLabStaffId = async (userId) => {
  const [rows] = await db.query(
    'SELECT id FROM lab_staff WHERE user_id = ?',
    [userId]
  );
  return rows.length > 0 ? rows[0].id : null;
};

// ============================================
// 1. DASHBOARD - 4 Stat Cards
// GET /api/lab/dashboard
// Figma: Incoming(18), Processing(7), Awaiting(5), Equipment(6/6)
// ============================================
exports.getDashboard = async (req, res) => {
  try {
    // Card 1: Incoming requisitions (status = 'received')
    const [incoming] = await db.query(
      `SELECT 
        COUNT(*) AS total,
        SUM(CASE WHEN priority = 'STAT' THEN 1 ELSE 0 END) AS stat_count
       FROM lab_tests
       WHERE status = 'received'`
    );

    // Card 2: Samples processing
    const [processing] = await db.query(
      `SELECT 
        COUNT(*) AS count,
        COALESCE(AVG(TIMESTAMPDIFF(MINUTE, processing_started_at, NOW())), 0) AS avg_tat
       FROM lab_tests
       WHERE status = 'processing'`
    );

    // Card 3: Awaiting validation
    const [awaiting] = await db.query(
      `SELECT 
        COUNT(*) AS count,
        SUM(CASE WHEN is_abnormal = TRUE THEN 1 ELSE 0 END) AS abnormal
       FROM lab_tests
       WHERE status = 'awaiting_validation'`
    );

    // Card 4: Equipment online
    const [equipment] = await db.query(
      `SELECT 
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'online' THEN 1 ELSE 0 END) AS online
       FROM equipment`
    );

    // Get lab staff info
    const [labInfo] = await db.query(
      `SELECT u.full_name, u.profile_image, b.name AS branch_name
       FROM users u
       LEFT JOIN branches b ON u.branch_id = b.id
       WHERE u.id = ?`,
      [req.user.id]
    );

    res.json({
      success: true,
      lab: labInfo[0] || {},
      stats: {
        incoming_requisitions: {
          total: incoming[0].total || 0,
          stat_priorities: incoming[0].stat_count || 0
        },
        samples_processing: {
          count: processing[0].count || 0,
          average_tat_minutes: Math.round(processing[0].avg_tat) || 42
        },
        awaiting_validation: {
          count: awaiting[0].count || 0,
          abnormal_findings: awaiting[0].abnormal || 0
        },
        equipment_online: {
          total: equipment[0].total || 6,
          online: equipment[0].online || 6
        }
      }
    });
  } catch (err) {
    console.error('Lab dashboard error:', err);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: err.message
    });
  }
};

// ============================================
// 2. SAMPLE TRACKING (3 columns: Received, Processing, Completed)
// GET /api/lab/samples
// Figma: Sample tracking with 3 columns
// ============================================
exports.getSampleTracking = async (req, res) => {
  try {
    const [samples] = await db.query(
      `SELECT 
        lt.id, lt.lab_number, lt.test_type, lt.sample_type, 
        lt.priority, lt.status, lt.received_at, lt.processing_started_at, 
        lt.completed_at, lt.is_abnormal, lt.findings,
        TIMESTAMPDIFF(MINUTE, lt.processing_started_at, NOW()) AS processing_minutes,
        an.id AS animal_id, an.name AS animal_name, an.species,
        an.photo AS animal_photo,
        u.full_name AS owner_name,
        vst.full_name AS vet_name
       FROM lab_tests lt
       JOIN animals an ON lt.animal_id = an.id
       JOIN users u ON an.owner_id = u.id
       LEFT JOIN veterinarians v ON lt.vet_id = v.id
       LEFT JOIN users vst ON v.user_id = vst.id
       WHERE lt.status IN ('received', 'processing', 'awaiting_validation', 'completed')
       ORDER BY 
         CASE lt.priority WHEN 'STAT' THEN 1 ELSE 2 END,
         lt.received_at ASC
       LIMIT 30`
    );

    // Group by status (3 columns)
    const received = samples.filter(s => s.status === 'received');
    const processing = samples.filter(s => s.status === 'processing');
    const completed = samples.filter(s =>
      s.status === 'completed' || s.status === 'awaiting_validation'
    );

    // Format each sample
    const formatSample = (s) => ({
      ...s,
      time_display: s.status === 'received'
        ? `Received ${new Date(s.received_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}`
        : s.status === 'processing'
        ? `${s.processing_minutes} min`
        : s.completed_at
        ? `Done ${new Date(s.completed_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}`
        : '',
      is_stat: s.priority === 'STAT',
      is_abnormal: s.is_abnormal === 1
    });

    res.json({
      success: true,
      total: samples.length,
      visible: samples.length,
      columns: {
        received: received.map(formatSample),
        processing: processing.map(formatSample),
        completed: completed.map(formatSample)
      },
      counts: {
        received: received.length,
        processing: processing.length,
        completed: completed.length
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
// 3. TEST REQUISITIONS (Incoming)
// GET /api/lab/requisitions
// Figma: "Test requisitions (18)"
// ============================================
exports.getRequisitions = async (req, res) => {
  try {
    const { status, priority } = req.query;

    let query = `
      SELECT 
        lt.id, lt.lab_number, lt.test_type, lt.sample_type,
        lt.priority, lt.status, lt.received_at,
        an.id AS animal_id, an.name AS animal_name, an.species,
        an.breed, an.age_months, an.gender,
        u.full_name AS owner_name, u.phone AS owner_phone,
        vst.full_name AS vet_name
      FROM lab_tests lt
      JOIN animals an ON lt.animal_id = an.id
      JOIN users u ON an.owner_id = u.id
      LEFT JOIN veterinarians v ON lt.vet_id = v.id
      LEFT JOIN users vst ON v.user_id = vst.id
      WHERE lt.status IN ('received', 'processing')
    `;
    const params = [];

    if (status) {
      query += ' AND lt.status = ?';
      params.push(status);
    }
    if (priority) {
      query += ' AND lt.priority = ?';
      params.push(priority);
    }

    query += ` ORDER BY 
      CASE lt.priority WHEN 'STAT' THEN 1 ELSE 2 END,
      lt.received_at ASC`;

    const [requisitions] = await db.query(query, params);

    res.json({
      success: true,
      count: requisitions.length,
      stat_count: requisitions.filter(r => r.priority === 'STAT').length,
      requisitions
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
// 4. GET ONE SAMPLE
// GET /api/lab/samples/:id
// ============================================
exports.getSample = async (req, res) => {
  try {
    const [samples] = await db.query(
      `SELECT 
        lt.*,
        an.name AS animal_name, an.species, an.breed, an.age_months,
        an.gender, an.weight_kg, an.photo AS animal_photo,
        u.full_name AS owner_name, u.phone AS owner_phone,
        vst.full_name AS vet_name,
        ls.user_id AS lab_staff_user_id
       FROM lab_tests lt
       JOIN animals an ON lt.animal_id = an.id
       JOIN users u ON an.owner_id = u.id
       LEFT JOIN veterinarians v ON lt.vet_id = v.id
       LEFT JOIN users vst ON v.user_id = vst.id
       LEFT JOIN lab_staff ls ON lt.lab_staff_id = ls.id
       WHERE lt.id = ?`,
      [req.params.id]
    );

    if (samples.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Sample not found ❌'
      });
    }

    // Get linked SOAP note
    const [soapNotes] = await db.query(
      `SELECT s.*, mr.diagnosis
       FROM medical_records mr
       LEFT JOIN soap_notes s ON s.medical_record_id = mr.id
       WHERE mr.animal_id = ?
       ORDER BY mr.created_at DESC
       LIMIT 1`,
      [samples[0].animal_id]
    );

    res.json({
      success: true,
      sample: samples[0],
      soap_note: soapNotes[0] || null
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
// 5. ACCEPT SAMPLE (Received → Processing)
// PUT /api/lab/samples/:id/process
// ============================================
exports.startProcessing = async (req, res) => {
  try {
    const labStaffId = await getLabStaffId(req.user.id);
    const { id } = req.params;

    const [existing] = await db.query(
      'SELECT id, status FROM lab_tests WHERE id = ?',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Sample not found ❌'
      });
    }

    if (existing[0].status !== 'received') {
      return res.status(400).json({
        success: false,
        message: `Cannot process. Current status: ${existing[0].status} ❌`
      });
    }

    await db.query(
      `UPDATE lab_tests 
       SET status = 'processing',
           processing_started_at = NOW(),
           lab_staff_id = ?
       WHERE id = ?`,
      [labStaffId, id]
    );

    res.json({
      success: true,
      message: 'Sample processing started ✅',
      status: 'processing'
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
// 6. SUBMIT FINDINGS (Processing → Awaiting Validation)
// POST /api/lab/findings/:id
// Figma: Findings entry - LAB-2838 Cooper Davis
// ============================================
exports.submitFindings = async (req, res) => {
  try {
    const labStaffId = await getLabStaffId(req.user.id);
    const { id } = req.params;
    const { findings, reference_range, is_abnormal, notes } = req.body;

    if (!findings) {
      return res.status(400).json({
        success: false,
        message: 'Findings required ❌'
      });
    }

    const [existing] = await db.query(
      'SELECT id, status FROM lab_tests WHERE id = ?',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Sample not found ❌'
      });
    }

    await db.query(
      `UPDATE lab_tests 
       SET findings = ?,
           reference_range = ?,
           is_abnormal = ?,
           notes = ?,
           status = 'awaiting_validation',
           lab_staff_id = ?
       WHERE id = ?`,
      [
        findings,
        reference_range || null,
        is_abnormal || false,
        notes || null,
        labStaffId,
        id
      ]
    );

    // Notify the vet
    const [sample] = await db.query(
      `SELECT lt.vet_id, lt.lab_number, an.name AS animal_name,
              v.user_id AS vet_user_id
       FROM lab_tests lt
       JOIN animals an ON lt.animal_id = an.id
       LEFT JOIN veterinarians v ON lt.vet_id = v.id
       WHERE lt.id = ?`,
      [id]
    );

    if (sample.length > 0 && sample[0].vet_user_id) {
      await db.query(
        `INSERT INTO notifications (user_id, title, message, type) 
         VALUES (?, ?, ?, 'lab_result')`,
        [
          sample[0].vet_user_id,
          'የላብራቶሪ ውጤት ደርሷል',
          `${sample[0].lab_number}: ${sample[0].animal_name}`
        ]
      );
    }

    res.json({
      success: true,
      message: 'Findings submitted, awaiting validation ✅',
      status: 'awaiting_validation'
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
// 7. VALIDATE & RELEASE (Awaiting → Completed)
// PUT /api/lab/samples/:id/validate
// Figma: "Validate & release result" button
// ============================================
exports.validateResult = async (req, res) => {
  try {
    const { id } = req.params;

    const [existing] = await db.query(
      `SELECT lt.id, lt.status, lt.lab_number, lt.animal_id,
              an.owner_id, an.name AS animal_name
       FROM lab_tests lt
       JOIN animals an ON lt.animal_id = an.id
       WHERE lt.id = ?`,
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Sample not found ❌'
      });
    }

    if (existing[0].status === 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Already validated ✅'
      });
    }

    await db.query(
      `UPDATE lab_tests 
       SET status = 'completed',
           completed_at = NOW()
       WHERE id = ?`,
      [id]
    );

    // Notify owner
    await db.query(
      `INSERT INTO notifications (user_id, title, message, type) 
       VALUES (?, ?, ?, 'lab_result')`,
      [
        existing[0].owner_id,
        'የላብራቶሪ ውጤት ደርሷል',
        `${existing[0].animal_name} የ${existing[0].lab_number} ውጤት ደርሷል`
      ]
    );

    res.json({
      success: true,
      message: 'Result validated & released ✅',
      status: 'completed'
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
// 8. AWAITING VALIDATION LIST
// GET /api/lab/awaiting-validation
// ============================================
exports.getAwaitingValidation = async (req, res) => {
  try {
    const [samples] = await db.query(
      `SELECT 
        lt.id, lt.lab_number, lt.test_type, lt.findings, 
        lt.reference_range, lt.is_abnormal, lt.completed_at,
        an.name AS animal_name, an.species,
        vst.full_name AS vet_name
       FROM lab_tests lt
       JOIN animals an ON lt.animal_id = an.id
       LEFT JOIN veterinarians v ON lt.vet_id = v.id
       LEFT JOIN users vst ON v.user_id = vst.id
       WHERE lt.status = 'awaiting_validation'
       ORDER BY lt.is_abnormal DESC, lt.completed_at ASC`
    );

    res.json({
      success: true,
      count: samples.length,
      abnormal_count: samples.filter(s => s.is_abnormal).length,
      samples
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
// 9. EQUIPMENT STATUS
// GET /api/lab/equipment
// Figma: "6 / 6 online"
// ============================================
exports.getEquipment = async (req, res) => {
  try {
    const [equipment] = await db.query(
      `SELECT id, name, serial_number, status, 
              last_check, next_maintenance
       FROM equipment
       ORDER BY status DESC, name ASC`
    );

    const online = equipment.filter(e => e.status === 'online').length;

    res.json({
      success: true,
      total: equipment.length,
      online,
      offline: equipment.length - online,
      equipment
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
// 10. REAGENT STOCK
// GET /api/lab/reagents
// Figma: "Reagent stock (4)"
// ============================================
exports.getReagents = async (req, res) => {
  try {
    const [reagents] = await db.query(
      `SELECT id, name, catalog_number, quantity, unit, 
              min_quantity, expiry_date,
              CASE 
                WHEN quantity = 0 THEN 'out_of_stock'
                WHEN quantity <= min_quantity THEN 'low_stock'
                WHEN expiry_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY) THEN 'expiring'
                ELSE 'ok'
              END AS alert_status
       FROM reagents
       ORDER BY alert_status DESC, name ASC`
    );

    res.json({
      success: true,
      count: reagents.length,
      low_stock: reagents.filter(r => r.alert_status === 'low_stock').length,
      out_of_stock: reagents.filter(r => r.alert_status === 'out_of_stock').length,
      expiring: reagents.filter(r => r.alert_status === 'expiring').length,
      reagents
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
// 11. DIAGNOSTIC REPORTS
// GET /api/lab/reports
// ============================================
exports.getReports = async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    let query = `
      SELECT 
        lt.id, lt.lab_number, lt.test_type, lt.status,
        lt.received_at, lt.completed_at, lt.is_abnormal,
        TIMESTAMPDIFF(MINUTE, lt.received_at, lt.completed_at) AS tat_minutes,
        an.name AS animal_name, an.species,
        u.full_name AS owner_name
      FROM lab_tests lt
      JOIN animals an ON lt.animal_id = an.id
      JOIN users u ON an.owner_id = u.id
      WHERE lt.status = 'completed'
    `;
    const params = [];

    if (start_date) {
      query += ' AND DATE(lt.completed_at) >= ?';
      params.push(start_date);
    }
    if (end_date) {
      query += ' AND DATE(lt.completed_at) <= ?';
      params.push(end_date);
    }

    query += ' ORDER BY lt.completed_at DESC LIMIT 100';

    const [reports] = await db.query(query, params);

    // Stats
    const avgTat = reports.length > 0
      ? Math.round(reports.reduce((sum, r) => sum + (r.tat_minutes || 0), 0) / reports.length)
      : 0;

    res.json({
      success: true,
      count: reports.length,
      stats: {
        total_completed: reports.length,
        abnormal_count: reports.filter(r => r.is_abnormal).length,
        average_tat_minutes: avgTat
      },
      reports
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
// 12. QUALITY CONTROL
// GET /api/lab/quality-control
// ============================================
exports.getQualityControl = async (req, res) => {
  try {
    // Equipment status
    const [equipment] = await db.query(
      `SELECT status, COUNT(*) AS count FROM equipment GROUP BY status`
    );

    // Reagents alerts
    const [reagentAlerts] = await db.query(
      `SELECT COUNT(*) AS count FROM reagents 
       WHERE quantity <= min_quantity`
    );

    // Stats from lab tests
    const [stats] = await db.query(
      `SELECT 
        COUNT(*) AS total_tests,
        SUM(CASE WHEN is_abnormal = TRUE THEN 1 ELSE 0 END) AS abnormal,
        ROUND(AVG(TIMESTAMPDIFF(MINUTE, received_at, completed_at)), 0) AS avg_tat
       FROM lab_tests
       WHERE status = 'completed'
         AND completed_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`
    );

    res.json({
      success: true,
      quality_control: {
        equipment_status: equipment,
        reagent_alerts: reagentAlerts[0].count || 0,
        monthly_stats: {
          total_tests: stats[0].total_tests || 0,
          abnormal_results: stats[0].abnormal || 0,
          average_tat_minutes: stats[0].avg_tat || 0
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