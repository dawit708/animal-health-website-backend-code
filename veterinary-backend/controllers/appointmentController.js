const db = require('../config/database');
exports.createAppointment = async (req, res) => {
  try {
    const {
      animal_id, vet_id, branch_id, service_id,
      appointment_date, reason
    } = req.body;

    const owner_id = (req.user.role === 'owner')
      ? req.user.id
      : (req.body.owner_id || req.user.id);
    if (!animal_id || !vet_id || !appointment_date) {
      return res.status(400).json({
        success: false,
        message: 'Required: animal_id, vet_id, appointment_date ❌'
      });
    }
    const [animals] = await db.query(
      'SELECT id, owner_id, name FROM animals WHERE id = ?',
      [animal_id]
    );

    if (animals.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Animal not found ❌'
      });
    }

    if (req.user.role === 'owner' && animals[0].owner_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'This animal does not belong to you ❌'
      });
    }
    const [vets] = await db.query(
      'SELECT id FROM veterinarians WHERE id = ?',
      [vet_id]
    );

    if (vets.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Veterinarian not found ❌'
      });
    }
    const [existing] = await db.query(
      `SELECT id FROM appointments 
       WHERE vet_id = ? 
         AND appointment_date = ?
         AND status IN ('pending', 'confirmed', 'checked_in', 'in_consultation')`,
      [vet_id, appointment_date]
    );

    if (existing.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'This time slot is already booked ❌'
      });
    }
    const [result] = await db.query(
      `INSERT INTO appointments 
       (owner_id, animal_id, vet_id, branch_id, service_id, 
        appointment_date, reason, status) 
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [
        owner_id, animal_id, vet_id,
        branch_id || null, service_id || null,
        appointment_date, reason || null
      ]
    );

    // Create notification for vet
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
          'አዲስ ቀጠሮ',
          `አዲስ ቀጠሮ ለ${animals[0].name} በ${appointment_date}`
        ]
      );
    }

    // Get full appointment
    const [newAppointment] = await db.query(
      `SELECT a.*, 
              an.name AS animal_name, an.species,
              u.full_name AS owner_name, u.phone AS owner_phone
       FROM appointments a
       JOIN animals an ON a.animal_id = an.id
       JOIN users u ON a.owner_id = u.id
       WHERE a.id = ?`,
      [result.insertId]
    );

    res.status(201).json({
      success: true,
      message: 'Appointment booked successfully ✅',
      appointment: newAppointment[0]
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: err.message
    });
  }
};
exports.getMyAppointments = async (req, res) => {
  try {
    const [appointments] = await db.query(
      `SELECT a.*, 
              an.name AS animal_name, an.species, an.photo AS animal_photo,
              u.full_name AS vet_name,
              s.name AS service_name, s.price AS service_price,
              b.name AS branch_name
       FROM appointments a
       JOIN animals an ON a.animal_id = an.id
       JOIN veterinarians v ON a.vet_id = v.id
       JOIN users u ON v.user_id = u.id
       LEFT JOIN services s ON a.service_id = s.id
       LEFT JOIN branches b ON a.branch_id = b.id
       WHERE a.owner_id = ?
       ORDER BY a.appointment_date DESC`,
      [req.user.id]
    );

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

exports.getAllAppointments = async (req, res) => {
  try {
    const { status, date, branch_id, vet_id } = req.query;

    let query = `
      SELECT a.*, 
             an.name AS animal_name, an.species,
             u.full_name AS owner_name, u.phone AS owner_phone,
             vst.full_name AS vet_name,
             s.name AS service_name,
             b.name AS branch_name
      FROM appointments a
      JOIN animals an ON a.animal_id = an.id
      JOIN users u ON a.owner_id = u.id
      JOIN veterinarians v ON a.vet_id = v.id
      JOIN users vst ON v.user_id = vst.id
      LEFT JOIN services s ON a.service_id = s.id
      LEFT JOIN branches b ON a.branch_id = b.id
      WHERE 1=1
    `;
    const params = [];

    if (status) {
      query += ' AND a.status = ?';
      params.push(status);
    }

    if (date) {
      query += ' AND DATE(a.appointment_date) = ?';
      params.push(date);
    }

    if (branch_id) {
      query += ' AND a.branch_id = ?';
      params.push(branch_id);
    }

    if (vet_id) {
      query += ' AND a.vet_id = ?';
      params.push(vet_id);
    }

    query += ' ORDER BY a.appointment_date DESC LIMIT 100';

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
exports.getTodayAppointments = async (req, res) => {
  try {
    let query = `
      SELECT a.*, 
             an.name AS animal_name, an.species, an.breed, an.photo AS animal_photo,
             u.full_name AS owner_name, u.phone AS owner_phone,
             vst.full_name AS vet_name,
             s.name AS service_name, s.duration_minutes,
             b.name AS branch_name
      FROM appointments a
      JOIN animals an ON a.animal_id = an.id
      JOIN users u ON a.owner_id = u.id
      JOIN veterinarians v ON a.vet_id = v.id
      JOIN users vst ON v.user_id = vst.id
      LEFT JOIN services s ON a.service_id = s.id
      LEFT JOIN branches b ON a.branch_id = b.id
      WHERE DATE(a.appointment_date) = CURDATE()
    `;
    const params = [];
    if (req.user.role === 'vet') {
      const [vetRows] = await db.query(
        'SELECT id FROM veterinarians WHERE user_id = ?',
        [req.user.id]
      );
      if (vetRows.length > 0) {
        query += ' AND a.vet_id = ?';
        params.push(vetRows[0].id);
      }
    }

    query += ' ORDER BY a.appointment_date ASC';

    const [appointments] = await db.query(query, params);

    // Stats
    const stats = {
      total: appointments.length,
      completed: appointments.filter(a => a.status === 'completed').length,
      waiting: appointments.filter(a => a.status === 'checked_in').length,
      in_consultation: appointments.filter(a => a.status === 'in_consultation').length,
      pending: appointments.filter(a => a.status === 'pending').length,
      confirmed: appointments.filter(a => a.status === 'confirmed').length
    };

    res.json({
      success: true,
      count: appointments.length,
      stats,
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
exports.getAppointment = async (req, res) => {
  try {
    const [appointments] = await db.query(
      `SELECT a.*, 
              an.name AS animal_name, an.species, an.breed, an.age_months,
              an.gender, an.weight_kg, an.microchip_id, an.photo AS animal_photo,
              u.full_name AS owner_name, u.phone AS owner_phone, u.email AS owner_email,
              vst.full_name AS vet_name,
              s.name AS service_name, s.price AS service_price,
              b.name AS branch_name
       FROM appointments a
       JOIN animals an ON a.animal_id = an.id
       JOIN users u ON a.owner_id = u.id
       JOIN veterinarians v ON a.vet_id = v.id
       JOIN users vst ON v.user_id = vst.id
       LEFT JOIN services s ON a.service_id = s.id
       LEFT JOIN branches b ON a.branch_id = b.id
       WHERE a.id = ?`,
      [req.params.id]
    );

    if (appointments.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found ❌'
      });
    }

    const apt = appointments[0];
    const staffRoles = ['admin', 'vet', 'receptionist', 'lab', 'pharmacy'];

    // Access check
    if (apt.owner_id !== req.user.id && !staffRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied ❌'
      });
    }

    res.json({ success: true, appointment: apt });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: err.message
    });
  }
};
exports.updateStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = [
      'pending', 'confirmed', 'checked_in',
      'in_consultation', 'completed', 'cancelled', 'no_show'
    ];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Allowed: ${validStatuses.join(', ')} ❌`
      });
    }

    // Check appointment exists
    const [existing] = await db.query(
      'SELECT id, owner_id, status FROM appointments WHERE id = ?',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found ❌'
      });
    }

    // Owner can only cancel
    if (req.user.role === 'owner') {
      if (existing[0].owner_id !== req.user.id) {
        return res.status(403).json({
          success: false,
          message: 'Access denied ❌'
        });
      }
      if (status !== 'cancelled') {
        return res.status(403).json({
          success: false,
          message: 'Owners can only cancel appointments ❌'
        });
      }
    }

    // Update
    const updateFields = ['status = ?'];
    const params = [status];

    // Auto-set check-in time
    if (status === 'checked_in') {
      updateFields.push('check_in_time = NOW()');
    }

    params.push(id);

    await db.query(
      `UPDATE appointments SET ${updateFields.join(', ')} WHERE id = ?`,
      params
    );

    // Notify owner if status changed by staff
    if (req.user.role !== 'owner') {
      await db.query(
        `INSERT INTO notifications (user_id, title, message, type) 
         VALUES (?, ?, ?, 'appointment')`,
        [
          existing[0].owner_id,
          'የቀጠሮ ሁኔታ ተቀይሯል',
          `ቀጠሮዎ ወደ "${status}" ተቀይሯል`
        ]
      );
    }

    res.json({
      success: true,
      message: `Appointment status updated to "${status}" ✅`
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: err.message
    });
  }
};
exports.checkIn = async (req, res) => {
  try {
    const { id } = req.params;

    const [existing] = await db.query(
      'SELECT id, status, appointment_date FROM appointments WHERE id = ?',
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

    // Calculate wait time
    const [result] = await db.query(
      `UPDATE appointments 
       SET status = 'checked_in', check_in_time = NOW() 
       WHERE id = ?`,
      [id]
    );

    res.json({
      success: true,
      message: 'Patient checked in successfully ✅',
      check_in_time: new Date()
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: err.message
    });
  }
};

exports.updateAppointment = async (req, res) => {
  try {
    const { id } = req.params;
    const { appointment_date, reason, service_id, vet_id } = req.body;

    const [existing] = await db.query(
      'SELECT owner_id, status FROM appointments WHERE id = ?',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found ❌'
      });
    }

    const staffRoles = ['admin', 'receptionist'];

    if (existing[0].owner_id !== req.user.id && !staffRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied ❌'
      });
    }

    await db.query(
      `UPDATE appointments SET 
        appointment_date = COALESCE(?, appointment_date),
        reason = COALESCE(?, reason),
        service_id = COALESCE(?, service_id),
        vet_id = COALESCE(?, vet_id)
       WHERE id = ?`,
      [appointment_date, reason, service_id, vet_id, id]
    );

    res.json({
      success: true,
      message: 'Appointment updated successfully ✅'
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
// 9. DELETE APPOINTMENT
// DELETE /api/appointments/:id
// ============================================
exports.deleteAppointment = async (req, res) => {
  try {
    const { id } = req.params;

    const [existing] = await db.query(
      'SELECT owner_id FROM appointments WHERE id = ?',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found ❌'
      });
    }

    if (existing[0].owner_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied ❌'
      });
    }

    await db.query('DELETE FROM appointments WHERE id = ?', [id]);

    res.json({
      success: true,
      message: 'Appointment deleted successfully ✅'
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: err.message
    });
  }
};
exports.getAvailableVets = async (req, res) => {
  try {
    const { date, specialization } = req.query;

    let query = `
      SELECT v.id, v.specialization, v.experience_years, 
             v.consultation_fee, v.available_days,
             u.full_name, u.email, u.phone, u.profile_image,
             b.name AS branch_name, b.id AS branch_id
      FROM veterinarians v
      JOIN users u ON v.user_id = u.id
      LEFT JOIN branches b ON u.branch_id = b.id
      WHERE u.is_active = TRUE
    `;
    const params = [];

    if (specialization) {
      query += ' AND v.specialization LIKE ?';
      params.push(`%${specialization}%`);
    }

    const [vets] = await db.query(query, params);

    // If date given, count booked slots
    if (date) {
      for (let vet of vets) {
        const [booked] = await db.query(
          `SELECT COUNT(*) AS count FROM appointments 
           WHERE vet_id = ? 
             AND DATE(appointment_date) = ?
             AND status NOT IN ('cancelled', 'no_show')`,
          [vet.id, date]
        );
        vet.booked_count = booked[0].count;
      }
    }

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
// 11. GET UPCOMING APPOINTMENTS
// GET /api/appointments/upcoming
// ============================================
exports.getUpcoming = async (req, res) => {
  try {
    let query = `
      SELECT a.*, 
             an.name AS animal_name, an.species,
             u.full_name AS owner_name, u.phone AS owner_phone,
             vst.full_name AS vet_name,
             s.name AS service_name
      FROM appointments a
      JOIN animals an ON a.animal_id = an.id
      JOIN users u ON a.owner_id = u.id
      JOIN veterinarians v ON a.vet_id = v.id
      JOIN users vst ON v.user_id = vst.id
      LEFT JOIN services s ON a.service_id = s.id
      WHERE a.appointment_date > NOW()
        AND a.status IN ('pending', 'confirmed')
    `;
    const params = [];

    if (req.user.role === 'owner') {
      query += ' AND a.owner_id = ?';
      params.push(req.user.id);
    }

    query += ' ORDER BY a.appointment_date ASC LIMIT 10';

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