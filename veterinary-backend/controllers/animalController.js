const db = require('../config/database');

// ============================================
// 1. CREATE - አዲስ እንስሳ ጨምር
// POST /api/animals
// Access: owner, receptionist, admin
// ============================================
exports.createAnimal = async (req, res) => {
  try {
    const {
      name, species, breed, age_months, gender,
      color, weight_kg, microchip_id, is_neutered, notes,
      owner_id  // For receptionist/admin to add for owners
    } = req.body;

    // Determine owner
    const finalOwnerId = (req.user.role === 'owner') ? req.user.id : (owner_id || req.user.id);

    // Validation
    if (!name || !species || !gender) {
      return res.status(400).json({
        success: false,
        message: 'Required fields: name, species, gender ❌'
      });
    }

    // Check microchip duplicate
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

    // Insert
    const [result] = await db.query(
      `INSERT INTO animals 
       (owner_id, name, species, breed, age_months, gender, 
        color, weight_kg, microchip_id, is_neutered, notes) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        finalOwnerId, name, species, breed || null, age_months || null,
        gender, color || null, weight_kg || null,
        microchip_id || null, is_neutered || false, notes || null
      ]
    );

    const [newAnimal] = await db.query(
      'SELECT * FROM animals WHERE id = ?',
      [result.insertId]
    );

    res.status(201).json({
      success: true,
      message: 'Animal added successfully ✅',
      animal: newAnimal[0]
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
// 2. GET MY ANIMALS - የራሴን እንስሳት
// GET /api/animals/my
// Access: owner
// ============================================
exports.getMyAnimals = async (req, res) => {
  try {
    const [animals] = await db.query(
      `SELECT a.*,
        (SELECT COUNT(*) FROM appointments WHERE animal_id = a.id) AS appointment_count,
        (SELECT COUNT(*) FROM vaccinations WHERE animal_id = a.id) AS vaccination_count,
        (SELECT COUNT(*) FROM allergies WHERE animal_id = a.id) AS allergy_count,
        (SELECT COUNT(*) FROM lab_tests WHERE animal_id = a.id) AS lab_test_count
       FROM animals a
       WHERE a.owner_id = ?
       ORDER BY a.created_at DESC`,
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
// 3. GET ONE ANIMAL - አንድ እንስሳ
// GET /api/animals/:id
// Access: any logged-in user (owner or staff)
// ============================================
exports.getAnimal = async (req, res) => {
  try {
    const [animals] = await db.query(
      `SELECT a.*, u.full_name AS owner_name, u.phone AS owner_phone, u.email AS owner_email
       FROM animals a
       JOIN users u ON a.owner_id = u.id
       WHERE a.id = ?`,
      [req.params.id]
    );

    if (animals.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Animal not found ❌'
      });
    }

    const animal = animals[0];
    const staffRoles = ['admin', 'vet', 'receptionist', 'lab', 'pharmacy'];

    // Access check
    if (animal.owner_id !== req.user.id && !staffRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied ❌'
      });
    }

    res.json({ success: true, animal });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: err.message
    });
  }
};

// ============================================
// 4. UPDATE ANIMAL
// PUT /api/animals/:id
// Access: owner (own), admin
// ============================================
exports.updateAnimal = async (req, res) => {
  try {
    const { id } = req.params;

    const [existing] = await db.query(
      'SELECT owner_id FROM animals WHERE id = ?',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Animal not found ❌'
      });
    }

    if (existing[0].owner_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied ❌'
      });
    }

    const {
      name, species, breed, age_months, gender,
      color, weight_kg, microchip_id, is_neutered, notes
    } = req.body;

    await db.query(
      `UPDATE animals SET 
        name = COALESCE(?, name),
        species = COALESCE(?, species),
        breed = COALESCE(?, breed),
        age_months = COALESCE(?, age_months),
        gender = COALESCE(?, gender),
        color = COALESCE(?, color),
        weight_kg = COALESCE(?, weight_kg),
        microchip_id = COALESCE(?, microchip_id),
        is_neutered = COALESCE(?, is_neutered),
        notes = COALESCE(?, notes)
       WHERE id = ?`,
      [name, species, breed, age_months, gender, color,
       weight_kg, microchip_id, is_neutered, notes, id]
    );

    const [updated] = await db.query('SELECT * FROM animals WHERE id = ?', [id]);

    res.json({
      success: true,
      message: 'Animal updated successfully ✅',
      animal: updated[0]
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
// 5. DELETE ANIMAL
// DELETE /api/animals/:id
// Access: owner (own), admin
// ============================================
exports.deleteAnimal = async (req, res) => {
  try {
    const { id } = req.params;

    const [existing] = await db.query(
      'SELECT owner_id FROM animals WHERE id = ?',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Animal not found ❌'
      });
    }

    if (existing[0].owner_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied ❌'
      });
    }

    await db.query('DELETE FROM animals WHERE id = ?', [id]);

    res.json({
      success: true,
      message: 'Animal deleted successfully ✅'
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
// 6. GET ALLERGIES
// GET /api/animals/:id/allergies
// ============================================
exports.getAllergies = async (req, res) => {
  try {
    const [allergies] = await db.query(
      'SELECT * FROM allergies WHERE animal_id = ? ORDER BY created_at DESC',
      [req.params.id]
    );

    res.json({
      success: true,
      count: allergies.length,
      allergies
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
// 7. ADD ALLERGY
// POST /api/animals/:id/allergies
// Access: vet, admin
// ============================================
exports.addAllergy = async (req, res) => {
  try {
    const { allergen, severity, notes } = req.body;

    if (!allergen) {
      return res.status(400).json({
        success: false,
        message: 'Allergen required ❌'
      });
    }

    const [result] = await db.query(
      'INSERT INTO allergies (animal_id, allergen, severity, notes) VALUES (?, ?, ?, ?)',
      [req.params.id, allergen, severity || 'moderate', notes || null]
    );

    res.status(201).json({
      success: true,
      message: 'Allergy added successfully ✅',
      allergy_id: result.insertId
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
// 8. GET VACCINATIONS
// GET /api/animals/:id/vaccinations
// ============================================
exports.getVaccinations = async (req, res) => {
  try {
    const [vaccinations] = await db.query(
      `SELECT v.*, u.full_name AS vet_name
       FROM vaccinations v
       LEFT JOIN veterinarians vet ON v.vet_id = vet.id
       LEFT JOIN users u ON vet.user_id = u.id
       WHERE v.animal_id = ?
       ORDER BY v.vaccination_date DESC`,
      [req.params.id]
    );

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
// 9. GET MEDICAL RECORDS
// GET /api/animals/:id/medical-records
// ============================================
exports.getMedicalRecords = async (req, res) => {
  try {
    const [records] = await db.query(
      `SELECT mr.*, u.full_name AS vet_name,
        s.subjective, s.objective, s.assessment, s.plan
       FROM medical_records mr
       JOIN veterinarians vet ON mr.vet_id = vet.id
       JOIN users u ON vet.user_id = u.id
       LEFT JOIN soap_notes s ON s.medical_record_id = mr.id
       WHERE mr.animal_id = ?
       ORDER BY mr.created_at DESC`,
      [req.params.id]
    );

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
// 10. GET CHRONIC CONDITIONS
// GET /api/animals/:id/chronic-conditions
// ============================================
exports.getChronicConditions = async (req, res) => {
  try {
    const [conditions] = await db.query(
      'SELECT * FROM chronic_conditions WHERE animal_id = ? ORDER BY created_at DESC',
      [req.params.id]
    );

    res.json({
      success: true,
      count: conditions.length,
      conditions
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
// 11. SEARCH ANIMALS (Staff only)
// GET /api/animals/search?q=cooper
// ============================================
exports.searchAnimals = async (req, res) => {
  try {
    const { q } = req.query;

    if (!q) {
      return res.status(400).json({
        success: false,
        message: 'Search query (q) required ❌'
      });
    }

    const [animals] = await db.query(
      `SELECT a.id, a.name, a.species, a.breed, a.microchip_id,
              u.full_name AS owner_name, u.phone AS owner_phone
       FROM animals a
       JOIN users u ON a.owner_id = u.id
       WHERE a.name LIKE ? OR a.microchip_id LIKE ? OR u.full_name LIKE ?
       LIMIT 20`,
      [`%${q}%`, `%${q}%`, `%${q}%`]
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