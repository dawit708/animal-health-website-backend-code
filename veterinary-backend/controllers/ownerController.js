const db = require('../config/database');

// ============================================
// 1. DASHBOARD - Main Overview
// GET /api/owner/dashboard
// Figma: Welcome + Next Appointment + My Animals + Care checklist
// ============================================
exports.getDashboard = async (req, res) => {
  try {
    const ownerId = req.user.id;

    // Owner info
    const [owner] = await db.query(
      `SELECT u.id, u.full_name, u.email, u.phone, u.profile_image
       FROM users u
       WHERE u.id = ?`,
      [ownerId]
    );

    if (owner.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Owner not found ❌'
      });
    }

    // Next appointment (Figma: "Thursday, 15 October · 9:30 AM")
    const [nextAppt] = await db.query(
      `SELECT 
        a.id AS appointment_id,
        a.appointment_date, a.reason, a.status,
        s.name AS service_name, s.duration_minutes,
        an.id AS animal_id, an.name AS animal_name, an.species, an.photo AS animal_photo,
        u.full_name AS vet_name,
        b.name AS branch_name,
        DATE_FORMAT(a.appointment_date, '%W, %d %M · %h:%i %p') AS formatted_date
       FROM appointments a
       JOIN animals an ON a.animal_id = an.id
       JOIN veterinarians v ON a.vet_id = v.id
       JOIN users u ON v.user_id = u.id
       LEFT JOIN services s ON a.service_id = s.id
       LEFT JOIN branches b ON a.branch_id = b.id
       WHERE a.owner_id = ?
         AND a.appointment_date > NOW()
         AND a.status IN ('pending', 'confirmed')
       ORDER BY a.appointment_date ASC
       LIMIT 1`,
      [ownerId]
    );

    // My animals count
    const [animalCount] = await db.query(
      `SELECT COUNT(*) AS count FROM animals WHERE owner_id = ?`,
      [ownerId]
    );

    // Care checklist (next 30 days)
    const [careChecklist] = await db.query(
      `SELECT 
        'vaccination' AS type,
        v.vaccine_name AS title,
        CONCAT(an.name, ' · ', v.vaccine_name, ' due') AS description,
        v.next_due_date AS due_date,
        DATEDIFF(v.next_due_date, CURDATE()) AS days_until,
        an.id AS animal_id, an.name AS animal_name, an.photo AS animal_photo
       FROM vaccinations v
       JOIN animals an ON v.animal_id = an.id
       WHERE an.owner_id = ?
         AND v.next_due_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)
       ORDER BY v.next_due_date ASC
       LIMIT 5`,
      [ownerId]
    );

    // Pending prescriptions (care checklist: "Finish ear drops")
    const [pendingRx] = await db.query(
      `SELECT 
        'prescription' AS type,
        CONCAT('Finish ', p.medicine_name) AS title,
        CONCAT(an.name, ' · ', p.dosage, ' ', COALESCE(p.frequency, '')) AS description,
        DATE_ADD(p.created_at, INTERVAL COALESCE(p.duration_days, 7) DAY) AS due_date,
        an.id AS animal_id, an.name AS animal_name, an.photo AS animal_photo
       FROM prescriptions p
       JOIN animals an ON p.animal_id = an.id
       WHERE an.owner_id = ?
         AND p.status IN ('dispensed', 'ready')
         AND DATE_ADD(p.created_at, INTERVAL COALESCE(p.duration_days, 7) DAY) >= CURDATE()
       ORDER BY due_date ASC
       LIMIT 3`,
      [ownerId]
    );

    const careItems = [...pendingRx, ...careChecklist]
      .sort((a, b) => new Date(a.due_date) - new Date(b.due_date))
      .slice(0, 5);

    res.json({
      success: true,
      welcome: `Welcome back, ${owner[0].full_name.split(' ')[0]}`,
      owner: owner[0],
      next_appointment: nextAppt[0] || null,
      stats: {
        total_animals: animalCount[0].count || 0
      },
      care_checklist: careItems
    });
  } catch (err) {
    console.error('Owner dashboard error:', err);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: err.message
    });
  }
};

// ============================================
// 2. MY ANIMALS (Figma: My animals (2))
// GET /api/owner/animals
// ============================================
exports.getMyAnimals = async (req, res) => {
  try {
    const [animals] = await db.query(
      `SELECT 
        an.*,
        (SELECT COUNT(*) FROM appointments WHERE animal_id = an.id) AS total_visits,
        (SELECT COUNT(*) FROM vaccinations WHERE animal_id = an.id) AS total_vaccinations,
        (SELECT COUNT(*) FROM allergies WHERE animal_id = an.id) AS allergy_count,
        (SELECT COUNT(*) FROM chronic_conditions WHERE animal_id = an.id AND is_active = TRUE) AS condition_count,
        (SELECT MAX(vaccination_date) FROM vaccinations WHERE animal_id = an.id) AS last_vaccination,
        (SELECT MAX(next_due_date) FROM vaccinations WHERE animal_id = an.id) AS next_vaccination_due,
        (SELECT COUNT(*) FROM prescriptions WHERE animal_id = an.id AND status = 'ready') AS pending_prescriptions,
        CASE
          WHEN (SELECT COUNT(*) FROM vaccinations WHERE animal_id = an.id AND next_due_date < CURDATE()) > 0
            THEN 'booster_due'
          WHEN (SELECT COUNT(*) FROM allergies WHERE animal_id = an.id) > 0
            THEN 'care_plan_active'
          ELSE 'vaccines_current'
        END AS care_status,
        CONCAT(
          FLOOR(an.age_months / 12), ' years · ', 
          an.weight_kg, ' kg'
        ) AS display_summary
       FROM animals an
       WHERE an.owner_id = ?
       ORDER BY an.name ASC`,
      [req.user.id]
    );

    res.json({
      success: true,
      count: animals.length,
      animals
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
// 3. MY APPOINTMENTS (Figma sidebar)
// GET /api/owner/appointments?status=upcoming
// ============================================
exports.getMyAppointments = async (req, res) => {
  try {
    const { status } = req.query;

    let query = `
      SELECT 
        a.id AS appointment_id,
        a.appointment_date, a.reason, a.status, a.check_in_time, a.notes,
        s.name AS service_name, s.price AS service_price, s.duration_minutes,
        an.id AS animal_id, an.name AS animal_name, an.species, an.photo AS animal_photo,
        u.full_name AS vet_name, v.specialization,
        b.name AS branch_name,
        DATE_FORMAT(a.appointment_date, '%W, %d %M %Y · %h:%i %p') AS formatted_date
       FROM appointments a
       JOIN animals an ON a.animal_id = an.id
       JOIN veterinarians v ON a.vet_id = v.id
       JOIN users u ON v.user_id = u.id
       LEFT JOIN services s ON a.service_id = s.id
       LEFT JOIN branches b ON a.branch_id = b.id
       WHERE a.owner_id = ?
    `;
    const params = [req.user.id];

    if (status === 'upcoming') {
      query += ` AND a.appointment_date > NOW() AND a.status IN ('pending', 'confirmed')`;
    } else if (status === 'past') {
      query += ` AND (a.appointment_date < NOW() OR a.status IN ('completed', 'cancelled'))`;
    }

    query += ' ORDER BY a.appointment_date DESC LIMIT 50';

    const [appointments] = await db.query(query, params);

    res.json({
      success: true,
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
// 4. BOOK APPOINTMENT (Figma: Request an appointment)
// POST /api/owner/appointments
// ============================================
exports.bookAppointment = async (req, res) => {
  try {
    const { animal_id, vet_id, service_id, appointment_date, reason } = req.body;

    if (!animal_id || !vet_id || !appointment_date) {
      return res.status(400).json({
        success: false,
        message: 'Required: animal_id, vet_id, appointment_date ❌'
      });
    }

    // Check animal belongs to owner
    const [animals] = await db.query(
      'SELECT id, name FROM animals WHERE id = ? AND owner_id = ?',
      [animal_id, req.user.id]
    );

    if (animals.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Animal not found or not yours ❌'
      });
    }

    // Check slot availability
    const [existing] = await db.query(
      `SELECT id FROM appointments 
       WHERE vet_id = ? AND appointment_date = ?
         AND status IN ('pending', 'confirmed', 'checked_in', 'in_consultation')`,
      [vet_id, appointment_date]
    );

    if (existing.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Time slot already booked ❌'
      });
    }

    // Insert
    const [result] = await db.query(
      `INSERT INTO appointments 
       (owner_id, animal_id, vet_id, service_id, appointment_date, reason, status) 
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      [req.user.id, animal_id, vet_id, service_id || null, appointment_date, reason || null]
    );

    // Notify vet
    const [vetUser] = await db.query(
      'SELECT user_id FROM veterinarians WHERE id = ?',
      [vet_id]
    );

    if (vetUser.length > 0) {
      await db.query(
        `INSERT INTO notifications (user_id, title, message, type) 
         VALUES (?, ?, ?, 'appointment')`,
        [
          vetUser[0].user_id,
          'አዲስ ቀጠሮ ጥያቄ',
          `አዲስ ቀጠሮ ለ${animals[0].name}`
        ]
      );
    }

    res.status(201).json({
      success: true,
      message: 'Appointment booked ✅',
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

// ============================================
// 5. RESCHEDULE / CANCEL APPOINTMENT
// PUT /api/owner/appointments/:id
// ============================================
exports.updateAppointment = async (req, res) => {
  try {
    const { id } = req.params;
    const { appointment_date, reason, status } = req.body;

    const [existing] = await db.query(
      'SELECT id, owner_id FROM appointments WHERE id = ?',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found ❌'
      });
    }

    if (existing[0].owner_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied ❌'
      });
    }

    // Owner can only cancel or change date/reason
    if (status && status !== 'cancelled') {
      return res.status(403).json({
        success: false,
        message: 'Owners can only cancel ❌'
      });
    }

    await db.query(
      `UPDATE appointments SET
        appointment_date = COALESCE(?, appointment_date),
        reason = COALESCE(?, reason),
        status = COALESCE(?, status)
       WHERE id = ?`,
      [appointment_date || null, reason || null, status || null, id]
    );

    res.json({
      success: true,
      message: 'Appointment updated ✅'
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
// 6. VACCINATIONS (Figma sidebar)
// GET /api/owner/vaccinations
// ============================================
exports.getVaccinations = async (req, res) => {
  try {
    const { animal_id } = req.query;

    let query = `
      SELECT 
        v.*,
        an.id AS animal_id, an.name AS animal_name, an.species, an.photo AS animal_photo,
        u.full_name AS vet_name,
        DATEDIFF(v.next_due_date, CURDATE()) AS days_until_due,
        CASE
          WHEN v.next_due_date < CURDATE() THEN 'overdue'
          WHEN v.next_due_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY) THEN 'due_soon'
          ELSE 'ok'
        END AS status
       FROM vaccinations v
       JOIN animals an ON v.animal_id = an.id
       LEFT JOIN veterinarians vet ON v.vet_id = vet.id
       LEFT JOIN users u ON vet.user_id = u.id
       WHERE an.owner_id = ?
    `;
    const params = [req.user.id];

    if (animal_id) {
      query += ' AND v.animal_id = ?';
      params.push(animal_id);
    }

    query += ' ORDER BY v.vaccination_date DESC';

    const [vaccinations] = await db.query(query, params);

    res.json({
      success: true,
      count: vaccinations.length,
      vaccinations
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
// 7. MEDICAL RECORDS (Figma sidebar)
// GET /api/owner/medical-records?animal_id=1
// ============================================
exports.getMedicalRecords = async (req, res) => {
  try {
    const { animal_id } = req.query;

    let query = `
      SELECT 
        mr.*,
        an.id AS animal_id, an.name AS animal_name, an.species, an.photo AS animal_photo,
        vst.full_name AS vet_name,
        s.subjective, s.objective, s.assessment, s.plan,
        DATE_FORMAT(mr.created_at, '%d %M %Y') AS visit_date
       FROM medical_records mr
       JOIN animals an ON mr.animal_id = an.id
       JOIN veterinarians v ON mr.vet_id = v.id
       JOIN users vst ON v.user_id = vst.id
       LEFT JOIN soap_notes s ON s.medical_record_id = mr.id
       WHERE an.owner_id = ?
    `;
    const params = [req.user.id];

    if (animal_id) {
      query += ' AND mr.animal_id = ?';
      params.push(animal_id);
    }

    query += ' ORDER BY mr.created_at DESC';

    const [records] = await db.query(query, params);

    res.json({
      success: true,
      count: records.length,
      records
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
// 8. LAB REPORTS (Figma: Laboratory reports)
// GET /api/owner/lab-reports
// ============================================
exports.getLabReports = async (req, res) => {
  try {
    const [reports] = await db.query(
      `SELECT 
        lt.id, lt.lab_number, lt.test_type, lt.sample_type,
        lt.findings, lt.reference_range, lt.is_abnormal,
        lt.status, lt.received_at, lt.completed_at,
        an.id AS animal_id, an.name AS animal_name, an.species, an.photo AS animal_photo,
        DATE_FORMAT(lt.completed_at, '%d %b %Y') AS report_date
       FROM lab_tests lt
       JOIN animals an ON lt.animal_id = an.id
       WHERE an.owner_id = ?
         AND lt.status IN ('completed', 'awaiting_validation')
       ORDER BY lt.completed_at DESC`,
      [req.user.id]
    );

    res.json({
      success: true,
      count: reports.length,
      abnormal_count: reports.filter(r => r.is_abnormal).length,
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
// 9. GET ONE LAB REPORT
// GET /api/owner/lab-reports/:id
// ============================================
exports.getLabReport = async (req, res) => {
  try {
    const [reports] = await db.query(
      `SELECT 
        lt.*,
        an.name AS animal_name, an.species, an.breed, an.age_months,
        u.full_name AS vet_name,
        DATE_FORMAT(lt.completed_at, '%d %B %Y') AS report_date
       FROM lab_tests lt
       JOIN animals an ON lt.animal_id = an.id
       JOIN veterinarians v ON lt.vet_id = v.id
       JOIN users u ON v.user_id = u.id
       WHERE lt.id = ? AND an.owner_id = ?`,
      [req.params.id, req.user.id]
    );

    if (reports.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Report not found ❌'
      });
    }

    res.json({
      success: true,
      report: reports[0]
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
// 10. PRESCRIPTIONS (Figma sidebar)
// GET /api/owner/prescriptions
// ============================================
exports.getPrescriptions = async (req, res) => {
  try {
    const { animal_id, status } = req.query;

    let query = `
      SELECT 
        p.*,
        an.id AS animal_id, an.name AS animal_name, an.species, an.photo AS animal_photo,
        u.full_name AS vet_name,
        DATE_FORMAT(p.created_at, '%d %b %Y') AS prescribed_date
       FROM prescriptions p
       JOIN animals an ON p.animal_id = an.id
       LEFT JOIN veterinarians v ON p.vet_id = v.id
       LEFT JOIN users u ON v.user_id = u.id
       WHERE an.owner_id = ?
    `;
    const params = [req.user.id];

    if (animal_id) {
      query += ' AND p.animal_id = ?';
      params.push(animal_id);
    }
    if (status) {
      query += ' AND p.status = ?';
      params.push(status);
    }

    query += ' ORDER BY p.created_at DESC';

    const [prescriptions] = await db.query(query, params);

    res.json({
      success: true,
      count: prescriptions.length,
      pending_count: prescriptions.filter(p => p.status === 'ready' || p.status === 'pending').length,
      prescriptions
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
// 11. INVOICES & PAYMENTS (Figma sidebar)
// GET /api/owner/invoices
// ============================================
exports.getInvoices = async (req, res) => {
  try {
    const { status } = req.query;

    let query = `
      SELECT 
        i.*,
        an.name AS animal_name, an.species, an.photo AS animal_photo,
        DATE_FORMAT(i.created_at, '%d %b %Y') AS invoice_date,
        (SELECT COUNT(*) FROM payments WHERE invoice_id = i.id AND payment_status = 'paid') AS payment_count
       FROM invoices i
       LEFT JOIN animals an ON i.animal_id = an.id
       WHERE i.owner_id = ?
    `;
    const params = [req.user.id];

    if (status) {
      query += ' AND i.status = ?';
      params.push(status);
    }

    query += ' ORDER BY i.created_at DESC';

    const [invoices] = await db.query(query, params);

    // Totals
    const [totals] = await db.query(
      `SELECT 
        COUNT(*) AS total_invoices,
        SUM(CASE WHEN status = 'unpaid' THEN total ELSE 0 END) AS unpaid_amount,
        SUM(CASE WHEN status = 'paid' THEN total ELSE 0 END) AS paid_amount
       FROM invoices
       WHERE owner_id = ?`,
      [req.user.id]
    );

    res.json({
      success: true,
      count: invoices.length,
      stats: {
        total_invoices: totals[0].total_invoices || 0,
        unpaid_amount: parseFloat(totals[0].unpaid_amount) || 0,
        paid_amount: parseFloat(totals[0].paid_amount) || 0
      },
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
// 12. GET ONE INVOICE
// GET /api/owner/invoices/:id
// ============================================
exports.getInvoice = async (req, res) => {
  try {
    const [invoices] = await db.query(
      `SELECT 
        i.*,
        an.name AS animal_name, an.species, an.breed, an.photo AS animal_photo,
        DATE_FORMAT(i.created_at, '%d %B %Y') AS invoice_date
       FROM invoices i
       LEFT JOIN animals an ON i.animal_id = an.id
       WHERE i.id = ? AND i.owner_id = ?`,
      [req.params.id, req.user.id]
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
// 13. CARE CHECKLIST (Figma: Care checklist)
// GET /api/owner/care-checklist
// ============================================
exports.getCareChecklist = async (req, res) => {
  try {
    const ownerId = req.user.id;

    // Vaccinations due
    const [vaccinationsDue] = await db.query(
      `SELECT 
        'vaccination' AS type,
        v.vaccine_name AS title,
        CONCAT(an.name, ' · ', v.vaccine_name, ' due') AS description,
        v.next_due_date AS due_date,
        DATEDIFF(v.next_due_date, CURDATE()) AS days_until,
        an.id AS animal_id, an.name AS animal_name, an.photo AS animal_photo
       FROM vaccinations v
       JOIN animals an ON v.animal_id = an.id
       WHERE an.owner_id = ?
         AND v.next_due_date IS NOT NULL
         AND v.next_due_date <= DATE_ADD(CURDATE(), INTERVAL 60 DAY)
       ORDER BY v.next_due_date ASC`,
      [ownerId]
    );

    // Prescriptions in progress
    const [rxInProgress] = await db.query(
      `SELECT 
        'prescription' AS type,
        CONCAT('Finish ', p.medicine_name) AS title,
        CONCAT(an.name, ' · ', COALESCE(p.dosage, ''), ' ', COALESCE(p.frequency, '')) AS description,
        DATE_ADD(p.created_at, INTERVAL COALESCE(p.duration_days, 7) DAY) AS due_date,
        DATEDIFF(DATE_ADD(p.created_at, INTERVAL COALESCE(p.duration_days, 7) DAY), CURDATE()) AS days_until,
        an.id AS animal_id, an.name AS animal_name, an.photo AS animal_photo
       FROM prescriptions p
       JOIN animals an ON p.animal_id = an.id
       WHERE an.owner_id = ?
         AND p.status IN ('dispensed', 'ready')
         AND DATE_ADD(p.created_at, INTERVAL COALESCE(p.duration_days, 7) DAY) >= CURDATE()
       ORDER BY due_date ASC`,
      [ownerId]
    );

    // Follow-up due
    const [followUps] = await db.query(
      `SELECT 
        'follow_up' AS type,
        'Book wellness exam' AS title,
        CONCAT(an.name, ' · Follow-up needed') AS description,
        mr.follow_up_date AS due_date,
        DATEDIFF(mr.follow_up_date, CURDATE()) AS days_until,
        an.id AS animal_id, an.name AS animal_name, an.photo AS animal_photo
       FROM medical_records mr
       JOIN animals an ON mr.animal_id = an.id
       WHERE an.owner_id = ?
         AND mr.follow_up_date >= CURDATE()
         AND mr.follow_up_date <= DATE_ADD(CURDATE(), INTERVAL 60 DAY)
       ORDER BY mr.follow_up_date ASC`,
      [ownerId]
    );

    // Combine all
    const allItems = [...rxInProgress, ...vaccinationsDue, ...followUps]
      .sort((a, b) => new Date(a.due_date) - new Date(b.due_date))
      .slice(0, 10);

    res.json({
      success: true,
      count: allItems.length,
      checklist: allItems
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
// 14. GET AVAILABLE VETS (for booking)
// GET /api/owner/available-vets
// ============================================
exports.getAvailableVets = async (req, res) => {
  try {
    const [vets] = await db.query(
      `SELECT 
        v.id, v.specialization, v.experience_years, v.consultation_fee,
        v.available_days,
        u.full_name, u.email, u.phone, u.profile_image,
        b.name AS branch_name, b.id AS branch_id
       FROM veterinarians v
       JOIN users u ON v.user_id = u.id
       LEFT JOIN branches b ON u.branch_id = b.id
       WHERE u.is_active = TRUE
       ORDER BY u.full_name ASC`
    );

    res.json({
      success: true,
      count: vets.length,
      vets
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
// 15. GET SERVICES (for booking)
// GET /api/owner/services
// ============================================
exports.getServices = async (req, res) => {
  try {
    const [services] = await db.query(
      `SELECT id, name, category, description, price, duration_minutes
       FROM services
       WHERE is_active = TRUE
       ORDER BY category ASC, name ASC`
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
// 16. ANIMAL DETAIL (Figma: Cooper panel)
// GET /api/owner/animals/:id
// ============================================
exports.getAnimalDetail = async (req, res) => {
  try {
    const animalId = req.params.id;

    // Patient info
    const [animals] = await db.query(
      `SELECT 
        an.*,
        TIMESTAMPDIFF(YEAR, DATE_SUB(CURDATE(), INTERVAL an.age_months MONTH), CURDATE()) AS age_years
       FROM animals an
       WHERE an.id = ? AND an.owner_id = ?`,
      [animalId, req.user.id]
    );

    if (animals.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Animal not found ❌'
      });
    }

    // Allergies
    const [allergies] = await db.query(
      'SELECT * FROM allergies WHERE animal_id = ?',
      [animalId]
    );

    // Chronic conditions
    const [conditions] = await db.query(
      'SELECT * FROM chronic_conditions WHERE animal_id = ? AND is_active = TRUE',
      [animalId]
    );

    // Vaccinations
    const [vaccinations] = await db.query(
      `SELECT v.*, u.full_name AS vet_name
       FROM vaccinations v
       LEFT JOIN veterinarians vet ON v.vet_id = vet.id
       LEFT JOIN users u ON vet.user_id = u.id
       WHERE v.animal_id = ?
       ORDER BY v.vaccination_date DESC
       LIMIT 10`,
      [animalId]
    );

    // Recent medical records
    const [records] = await db.query(
      `SELECT mr.id, mr.diagnosis, mr.treatment, mr.created_at,
              u.full_name AS vet_name
       FROM medical_records mr
       JOIN veterinarians v ON mr.vet_id = v.id
       JOIN users u ON v.user_id = u.id
       WHERE mr.animal_id = ?
       ORDER BY mr.created_at DESC
       LIMIT 5`,
      [animalId]
    );

    res.json({
      success: true,
      animal: animals[0],
      allergies,
      chronic_conditions: conditions,
      vaccinations,
      recent_records: records
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
// 17. ADD ANIMAL (Figma: "Add an animal" button)
// POST /api/owner/animals
// ============================================
exports.addAnimal = async (req, res) => {
  try {
    const {
      name, species, breed, age_months, gender,
      color, weight_kg, microchip_id, is_neutered, notes
    } = req.body;

    if (!name || !species || !gender) {
      return res.status(400).json({
        success: false,
        message: 'Required: name, species, gender ❌'
      });
    }

    // Check microchip
    if (microchip_id) {
      const [existing] = await db.query(
        'SELECT id FROM animals WHERE microchip_id = ?',
        [microchip_id]
      );
      if (existing.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Microchip ID already exists ❌'
        });
      }
    }

    const [result] = await db.query(
      `INSERT INTO animals 
       (owner_id, name, species, breed, age_months, gender,
        color, weight_kg, microchip_id, is_neutered, notes) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.id, name, species, breed || null, age_months || null,
        gender, color || null, weight_kg || null,
        microchip_id || null, is_neutered || false, notes || null
      ]
    );

    res.status(201).json({
      success: true,
      message: 'Animal added ✅',
      animal_id: result.insertId
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
// 18. NOTIFICATIONS
// GET /api/owner/notifications
// ============================================
exports.getNotifications = async (req, res) => {
  try {
    const [notifications] = await db.query(
      `SELECT * FROM notifications
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT 30`,
      [req.user.id]
    );

    const unreadCount = notifications.filter(n => !n.is_read).length;

    res.json({
      success: true,
      count: notifications.length,
      unread_count: unreadCount,
      notifications
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
// 19. MARK NOTIFICATION READ
// PUT /api/owner/notifications/:id/read
// ============================================
exports.markNotificationRead = async (req, res) => {
  try {
    await db.query(
      `UPDATE notifications SET is_read = TRUE 
       WHERE id = ? AND user_id = ?`,
      [req.params.id, req.user.id]
    );

    res.json({
      success: true,
      message: 'Marked as read ✅'
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
// 20. PROFILE UPDATE
// PUT /api/owner/profile
// ============================================
exports.updateProfile = async (req, res) => {
  try {
    const { full_name, phone, address } = req.body;

    await db.query(
      `UPDATE users SET
        full_name = COALESCE(?, full_name),
        phone = COALESCE(?, phone),
        address = COALESCE(?, address)
       WHERE id = ?`,
      [full_name, phone, address, req.user.id]
    );

    res.json({
      success: true,
      message: 'Profile updated ✅'
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: err.message
    });
  }
};