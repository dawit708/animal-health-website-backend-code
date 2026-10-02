const db = require('../config/database');

// ============================================
// HELPER: Get Vet ID from logged-in user
// ============================================
const getVetId = async (userId) => {
  const [rows] = await db.query(
    'SELECT id FROM veterinarians WHERE user_id = ?',
    [userId]
  );
  return rows.length > 0 ? rows[0].id : null;
};

// ============================================
// 1. DASHBOARD - Header + 4 Stat Cards
// GET /api/vet/dashboard
// Figma: "Good morning, Dr. Mensah" + 4 cards
// ============================================
exports.getDashboard = async (req, res) => {
  try {
    const vetId = await getVetId(req.user.id);

    if (!vetId) {
      return res.status(404).json({
        success: false,
        message: 'Vet profile not found ❌'
      });
    }

    // Get vet info (header)
    const [vetInfo] = await db.query(
      `SELECT 
        u.full_name, u.email, u.phone, u.profile_image,
        v.specialization, v.experience_years,
        b.name AS branch_name, b.id AS branch_id
       FROM veterinarians v
       JOIN users u ON v.user_id = u.id
       LEFT JOIN branches b ON u.branch_id = b.id
       WHERE v.id = ?`,
      [vetId]
    );

    // Card 1: Today's appointments
    const [todayAppts] = await db.query(
      `SELECT 
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
        SUM(CASE 
          WHEN status = 'checked_in' 
            AND TIMESTAMPDIFF(MINUTE, check_in_time, NOW()) > 30 
          THEN 1 ELSE 0 END) AS urgent
       FROM appointments
       WHERE vet_id = ? AND DATE(appointment_date) = CURDATE()`,
      [vetId]
    );

    // Card 2: Waiting now
    const [waiting] = await db.query(
      `SELECT 
        COUNT(*) AS count,
        COALESCE(MAX(TIMESTAMPDIFF(MINUTE, check_in_time, NOW())), 0) AS longest_wait
       FROM appointments
       WHERE vet_id = ? 
         AND status = 'checked_in'
         AND DATE(appointment_date) = CURDATE()`,
      [vetId]
    );

    // Card 3: Results to review (Lab tests completed, not yet reviewed)
    const [labResults] = await db.query(
      `SELECT 
        COUNT(*) AS count,
        SUM(CASE WHEN lt.is_abnormal = TRUE THEN 1 ELSE 0 END) AS abnormal
       FROM lab_tests lt
       WHERE lt.vet_id = ? 
         AND lt.status = 'completed'`,
      [vetId]
    );

    // Card 4: Follow-ups
    const [followUps] = await db.query(
      `SELECT 
        COUNT(*) AS count,
        SUM(CASE 
          WHEN follow_up_date <= DATE_ADD(CURDATE(), INTERVAL 7 DAY) 
          THEN 1 ELSE 0 END) AS need_scheduling
       FROM medical_records
       WHERE vet_id = ? 
         AND follow_up_date IS NOT NULL
         AND follow_up_date >= CURDATE()
         AND follow_up_date <= DATE_ADD(CURDATE(), INTERVAL 60 DAY)`,
      [vetId]
    );

    // Greeting based on time
    const hour = new Date().getHours();
    let greeting = 'Good morning';
    if (hour >= 12 && hour < 18) greeting = 'Good afternoon';
    else if (hour >= 18) greeting = 'Good evening';

    res.json({
      success: true,
      greeting: `${greeting}, ${vetInfo[0]?.full_name || 'Dr.'}`,
      vet: vetInfo[0] || {},
      stats: {
        today_appointments: {
          total: todayAppts[0].total || 0,
          completed: todayAppts[0].completed || 0,
          cancelled: todayAppts[0].cancelled || 0,
          urgent: todayAppts[0].urgent || 0
        },
        waiting_now: {
          count: waiting[0].count || 0,
          longest_wait_minutes: waiting[0].longest_wait || 0
        },
        results_to_review: {
          count: labResults[0].count || 0,
          abnormal: labResults[0].abnormal || 0
        },
        follow_ups: {
          count: followUps[0].count || 0,
          need_scheduling: followUps[0].need_scheduling || 0
        }
      }
    });
  } catch (err) {
    console.error('Vet dashboard error:', err);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: err.message
    });
  }
};

// ============================================
// 2. TODAY'S SCHEDULE
// GET /api/vet/schedule/today
// Figma: 09:00 Milo Chen, 09:45 Cooper Davis, etc.
// ============================================
exports.getTodaySchedule = async (req, res) => {
  try {
    const vetId = await getVetId(req.user.id);

    if (!vetId) {
      return res.status(404).json({
        success: false,
        message: 'Vet profile not found ❌'
      });
    }

    const [schedule] = await db.query(
      `SELECT 
        a.id AS appointment_id,
        a.appointment_date, a.reason, a.status, a.check_in_time,
        TIMESTAMPDIFF(MINUTE, a.check_in_time, NOW()) AS wait_minutes,
        an.id AS animal_id, an.name AS animal_name, an.species,
        an.breed, an.age_months, an.gender, an.photo AS animal_photo,
        u.full_name AS owner_name, u.phone AS owner_phone,
        s.name AS service_name, s.duration_minutes,
        (SELECT COUNT(*) FROM allergies WHERE animal_id = an.id) AS allergy_count,
        (SELECT COUNT(*) FROM chronic_conditions WHERE animal_id = an.id AND is_active = TRUE) AS condition_count
       FROM appointments a
       JOIN animals an ON a.animal_id = an.id
       JOIN users u ON a.owner_id = u.id
       LEFT JOIN services s ON a.service_id = s.id
       WHERE a.vet_id = ? 
         AND DATE(a.appointment_date) = CURDATE()
         AND a.status NOT IN ('cancelled', 'no_show')
       ORDER BY a.appointment_date ASC`,
      [vetId]
    );

    // Add color codes (like Figma)
    const scheduleWithColors = schedule.map(apt => ({
      ...apt,
      color_code: apt.status === 'completed' ? 'gray' :
                  apt.status === 'in_consultation' ? 'amber' :
                  apt.status === 'checked_in' ? 'teal' : 'blue'
    }));

    res.json({
      success: true,
      count: scheduleWithColors.length,
      date: new Date().toISOString().split('T')[0],
      day_name: new Date().toLocaleDateString('en-US', { weekday: 'long' }),
      schedule: scheduleWithColors
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
// 3. PATIENT QUEUE (Waiting now)
// GET /api/vet/patient-queue
// Figma: "3 waiting" - longest 18 min
// ============================================
exports.getPatientQueue = async (req, res) => {
  try {
    const vetId = await getVetId(req.user.id);

    if (!vetId) {
      return res.status(404).json({
        success: false,
        message: 'Vet profile not found ❌'
      });
    }

    const [queue] = await db.query(
      `SELECT 
        a.id AS appointment_id, a.check_in_time, a.reason, a.status,
        TIMESTAMPDIFF(MINUTE, a.check_in_time, NOW()) AS wait_minutes,
        an.id AS animal_id, an.name AS animal_name, an.species,
        an.breed, an.photo AS animal_photo,
        u.full_name AS owner_name, u.phone AS owner_phone,
        CASE 
          WHEN TIMESTAMPDIFF(MINUTE, a.check_in_time, NOW()) > 30 THEN 'urgent'
          WHEN TIMESTAMPDIFF(MINUTE, a.check_in_time, NOW()) > 15 THEN 'warning'
          ELSE 'normal'
        END AS priority
       FROM appointments a
       JOIN animals an ON a.animal_id = an.id
       JOIN users u ON a.owner_id = u.id
       WHERE a.vet_id = ? 
         AND a.status = 'checked_in'
         AND DATE(a.appointment_date) = CURDATE()
       ORDER BY a.check_in_time ASC`,
      [vetId]
    );

    res.json({
      success: true,
      count: queue.length,
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
// 4. RESULTS TO REVIEW
// GET /api/vet/results-to-review
// Figma: "3 results, 1 abnormal"
// ============================================
exports.getResultsToReview = async (req, res) => {
  try {
    const vetId = await getVetId(req.user.id);

    if (!vetId) {
      return res.status(404).json({
        success: false,
        message: 'Vet profile not found ❌'
      });
    }

    const [results] = await db.query(
      `SELECT 
        lt.id, lt.lab_number, lt.test_type, lt.status, 
        lt.findings, lt.is_abnormal, lt.completed_at,
        an.id AS animal_id, an.name AS animal_name, an.species,
        an.photo AS animal_photo,
        u.full_name AS owner_name, u.phone AS owner_phone
       FROM lab_tests lt
       JOIN animals an ON lt.animal_id = an.id
       JOIN users u ON an.owner_id = u.id
       WHERE lt.vet_id = ? 
         AND lt.status = 'completed'
       ORDER BY lt.completed_at DESC
       LIMIT 20`,
      [vetId]
    );

    res.json({
      success: true,
      count: results.length,
      abnormal_count: results.filter(r => r.is_abnormal).length,
      results
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
// 5. FOLLOW-UPS
// GET /api/vet/follow-ups
// Figma: "6 follow-ups, 2 need sc..."
// ============================================
exports.getFollowUps = async (req, res) => {
  try {
    const vetId = await getVetId(req.user.id);

    if (!vetId) {
      return res.status(404).json({
        success: false,
        message: 'Vet profile not found ❌'
      });
    }

    const [followUps] = await db.query(
      `SELECT 
        mr.id, mr.diagnosis, mr.follow_up_date, mr.created_at,
        DATEDIFF(mr.follow_up_date, CURDATE()) AS days_until,
        an.id AS animal_id, an.name AS animal_name, an.species,
        an.photo AS animal_photo,
        u.full_name AS owner_name, u.phone AS owner_phone
       FROM medical_records mr
       JOIN animals an ON mr.animal_id = an.id
       JOIN users u ON an.owner_id = u.id
       WHERE mr.vet_id = ? 
         AND mr.follow_up_date IS NOT NULL
         AND mr.follow_up_date >= CURDATE()
         AND mr.follow_up_date <= DATE_ADD(CURDATE(), INTERVAL 60 DAY)
       ORDER BY mr.follow_up_date ASC
       LIMIT 20`,
      [vetId]
    );

    res.json({
      success: true,
      count: followUps.length,
      need_scheduling: followUps.filter(f => f.days_until <= 7).length,
      follow_ups: followUps
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
// 6. PATIENT LIST
// GET /api/vet/patients
// ============================================
exports.getPatients = async (req, res) => {
  try {
    const vetId = await getVetId(req.user.id);

    if (!vetId) {
      return res.status(404).json({
        success: false,
        message: 'Vet profile not found ❌'
      });
    }

    const [patients] = await db.query(
      `SELECT DISTINCT
        an.id, an.name, an.species, an.breed, an.age_months, 
        an.gender, an.weight_kg, an.photo,
        u.id AS owner_id, u.full_name AS owner_name, u.phone AS owner_phone,
        (SELECT COUNT(*) FROM appointments WHERE animal_id = an.id AND vet_id = ?) AS visit_count,
        (SELECT MAX(appointment_date) FROM appointments WHERE animal_id = an.id AND vet_id = ?) AS last_visit
       FROM animals an
       JOIN users u ON an.owner_id = u.id
       JOIN appointments a ON a.animal_id = an.id
       WHERE a.vet_id = ?
       ORDER BY last_visit DESC
       LIMIT 50`,
      [vetId, vetId, vetId]
    );

    res.json({
      success: true,
      count: patients.length,
      patients
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
// 7. PATIENT DETAIL
// GET /api/vet/patients/:id
// Figma: Cooper Davis full detail panel
// ============================================
exports.getPatientDetail = async (req, res) => {
  try {
    const animalId = req.params.id;

    // Patient info + owner
    const [patients] = await db.query(
      `SELECT 
        an.*,
        u.id AS owner_id, u.full_name AS owner_name, 
        u.phone AS owner_phone, u.email AS owner_email,
        TIMESTAMPDIFF(YEAR, DATE_SUB(CURDATE(), INTERVAL an.age_months MONTH), CURDATE()) AS age_years
       FROM animals an
       JOIN users u ON an.owner_id = u.id
       WHERE an.id = ?`,
      [animalId]
    );

    if (patients.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Patient not found ❌'
      });
    }

    const patient = patients[0];

    // Allergies (Figma: "Allergy: Amoxicillin")
    const [allergies] = await db.query(
      'SELECT * FROM allergies WHERE animal_id = ?',
      [animalId]
    );

    // Chronic conditions (Figma: "Chronic atopy")
    const [conditions] = await db.query(
      'SELECT * FROM chronic_conditions WHERE animal_id = ? AND is_active = TRUE',
      [animalId]
    );

    // Latest vitals (Figma: Temp 38.7, HR 92, Resp 24, BCS 6/9)
    const [vitals] = await db.query(
      `SELECT temperature, heart_rate, respiration, bcs, created_at
       FROM medical_records
       WHERE animal_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      [animalId]
    );

    // Active appointment (Figma: "In consultation · 14 min")
    const [activeAppt] = await db.query(
      `SELECT a.*, s.name AS service_name,
              TIMESTAMPDIFF(MINUTE, a.check_in_time, NOW()) AS duration_minutes
       FROM appointments a
       LEFT JOIN services s ON a.service_id = s.id
       WHERE a.animal_id = ? 
         AND DATE(a.appointment_date) = CURDATE()
         AND a.status IN ('checked_in', 'in_consultation')
       LIMIT 1`,
      [animalId]
    );

    // Latest SOAP note
    const [soapNote] = await db.query(
      `SELECT mr.id, mr.diagnosis, mr.treatment, 
              mr.temperature, mr.heart_rate, mr.respiration, mr.bcs,
              s.subjective, s.objective, s.assessment, s.plan,
              mr.created_at
       FROM medical_records mr
       LEFT JOIN soap_notes s ON s.medical_record_id = mr.id
       WHERE mr.animal_id = ?
       ORDER BY mr.created_at DESC
       LIMIT 1`,
      [animalId]
    );

    res.json({
      success: true,
      patient: {
        ...patient,
        allergies,
        chronic_conditions: conditions,
        latest_vitals: vitals[0] || null,
        active_appointment: activeAppt[0] || null,
        latest_soap_note: soapNote[0] || null
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
// 8. CREATE SOAP NOTE
// POST /api/vet/soap-notes
// Figma: S.O.A.P tabs
// ============================================
exports.createSoapNote = async (req, res) => {
  try {
    const vetId = await getVetId(req.user.id);

    if (!vetId) {
      return res.status(404).json({
        success: false,
        message: 'Vet profile not found ❌'
      });
    }

    const {
      appointment_id, animal_id,
      diagnosis, treatment,
      temperature, heart_rate, respiration, bcs,
      subjective, objective, assessment, plan,
      follow_up_date
    } = req.body;

    if (!appointment_id || !animal_id || !diagnosis) {
      return res.status(400).json({
        success: false,
        message: 'Required: appointment_id, animal_id, diagnosis ❌'
      });
    }

    // Create medical record
    const [mrResult] = await db.query(
      `INSERT INTO medical_records 
       (appointment_id, animal_id, vet_id, diagnosis, treatment,
        temperature, heart_rate, respiration, bcs, follow_up_date) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        appointment_id, animal_id, vetId, diagnosis, treatment || null,
        temperature || null, heart_rate || null,
        respiration || null, bcs || null,
        follow_up_date || null
      ]
    );

    const medicalRecordId = mrResult.insertId;

    // Create SOAP note
    if (subjective || objective || assessment || plan) {
      await db.query(
        `INSERT INTO soap_notes 
         (medical_record_id, subjective, objective, assessment, plan) 
         VALUES (?, ?, ?, ?, ?)`,
        [
          medicalRecordId,
          subjective || null,
          objective || null,
          assessment || null,
          plan || null
        ]
      );
    }

    // Update appointment status
    await db.query(
      `UPDATE appointments SET status = 'completed' WHERE id = ?`,
      [appointment_id]
    );

    // Notify owner
    const [animal] = await db.query(
      'SELECT owner_id, name FROM animals WHERE id = ?',
      [animal_id]
    );

    if (animal.length > 0) {
      await db.query(
        `INSERT INTO notifications (user_id, title, message, type) 
         VALUES (?, ?, ?, 'general')`,
        [
          animal[0].owner_id,
          'የህክምና ማስታወሻ',
          `ለ${animal[0].name} የህክምና ማስታወሻ ተጽፏል`
        ]
      );
    }

    res.status(201).json({
      success: true,
      message: 'Medical record & SOAP note created ✅',
      medical_record_id: medicalRecordId
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
// 9. GET SOAP NOTE
// GET /api/vet/soap-notes/:id
// ============================================
exports.getSoapNote = async (req, res) => {
  try {
    const [notes] = await db.query(
      `SELECT 
        mr.id, mr.diagnosis, mr.treatment, mr.created_at,
        mr.temperature, mr.heart_rate, mr.respiration, mr.bcs,
        s.subjective, s.objective, s.assessment, s.plan,
        an.name AS animal_name, an.species,
        u.full_name AS vet_name
       FROM medical_records mr
       LEFT JOIN soap_notes s ON s.medical_record_id = mr.id
       JOIN animals an ON mr.animal_id = an.id
       JOIN veterinarians v ON mr.vet_id = v.id
       JOIN users u ON v.user_id = u.id
       WHERE mr.id = ?`,
      [req.params.id]
    );

    if (notes.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'SOAP note not found ❌'
      });
    }

    res.json({
      success: true,
      soap_note: notes[0]
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
// 10. ORDER LAB TEST
// POST /api/vet/lab-order
// Figma: "+ Order laboratory" button
// ============================================
exports.orderLabTest = async (req, res) => {
  try {
    const vetId = await getVetId(req.user.id);

    if (!vetId) {
      return res.status(404).json({
        success: false,
        message: 'Vet profile not found ❌'
      });
    }

    const { animal_id, test_type, sample_type, priority, notes } = req.body;

    if (!animal_id || !test_type) {
      return res.status(400).json({
        success: false,
        message: 'Required: animal_id, test_type ❌'
      });
    }

    // Generate lab number (LAB-2841+)
    const [count] = await db.query('SELECT COUNT(*) AS total FROM lab_tests');
    const labNumber = `LAB-${2841 + count[0].total + 1}`;

    const [result] = await db.query(
      `INSERT INTO lab_tests 
       (lab_number, animal_id, vet_id, test_type, sample_type, priority, status, notes) 
       VALUES (?, ?, ?, ?, ?, ?, 'received', ?)`,
      [
        labNumber, animal_id, vetId, test_type,
        sample_type || null, priority || 'normal', notes || null
      ]
    );

    // Notify lab staff
    const [labStaff] = await db.query(
      `SELECT id FROM users WHERE role = 'lab' AND is_active = TRUE LIMIT 1`
    );

    if (labStaff.length > 0) {
      await db.query(
        `INSERT INTO notifications (user_id, title, message, type) 
         VALUES (?, ?, ?, 'lab_result')`,
        [
          labStaff[0].id,
          'አዲስ የላብራቶሪ ጥያቄ',
          `${labNumber}: ${test_type}`
        ]
      );
    }

    res.status(201).json({
      success: true,
      message: 'Lab test ordered ✅',
      lab_test: {
        id: result.insertId,
        lab_number: labNumber,
        test_type,
        status: 'received'
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
// 11. CREATE PRESCRIPTION
// POST /api/vet/prescription
// Figma: "Prescription - Mometamax otic"
// ============================================
exports.createPrescription = async (req, res) => {
  try {
    const vetId = await getVetId(req.user.id);

    if (!vetId) {
      return res.status(404).json({
        success: false,
        message: 'Vet profile not found ❌'
      });
    }

    const {
      medical_record_id, animal_id,
      medicine_id, medicine_name,
      dosage, frequency, duration_days, quantity,
      instructions, priority
    } = req.body;

    if (!animal_id || !medicine_name || !dosage) {
      return res.status(400).json({
        success: false,
        message: 'Required: animal_id, medicine_name, dosage ❌'
      });
    }

    // Generate RX number (RX-8412+)
    const [count] = await db.query('SELECT COUNT(*) AS total FROM prescriptions');
    const rxNumber = `RX-${8412 + count[0].total + 1}`;

    const [result] = await db.query(
      `INSERT INTO prescriptions 
       (rx_number, medical_record_id, vet_id, animal_id,
        medicine_id, medicine_name, dosage, frequency, 
        duration_days, quantity, instructions, priority, status) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [
        rxNumber, medical_record_id || 1, vetId, animal_id,
        medicine_id || null, medicine_name, dosage,
        frequency || null, duration_days || null,
        quantity || null, instructions || null,
        priority || 'normal'
      ]
    );

    // Notify pharmacy
    const [pharm] = await db.query(
      `SELECT id FROM users WHERE role = 'pharmacy' AND is_active = TRUE LIMIT 1`
    );

    if (pharm.length > 0) {
      await db.query(
        `INSERT INTO notifications (user_id, title, message, type) 
         VALUES (?, ?, ?, 'prescription')`,
        [
          pharm[0].id,
          'አዲስ ማዘዣ',
          `${rxNumber}: ${medicine_name}`
        ]
      );
    }

    res.status(201).json({
      success: true,
      message: 'Prescription created ✅',
      prescription: {
        id: result.insertId,
        rx_number: rxNumber,
        medicine_name,
        status: 'pending'
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