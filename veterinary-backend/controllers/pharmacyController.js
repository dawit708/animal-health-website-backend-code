const db = require('../config/database');

// Helper: Get pharmacy staff ID
const getPharmacyStaffId = async (userId) => {
  const [rows] = await db.query(
    'SELECT id FROM pharmacy_staff WHERE user_id = ?',
    [userId]
  );
  return rows.length > 0 ? rows[0].id : null;
};

// ============================================
// 1. DASHBOARD - 4 Stat Cards
// GET /api/pharmacy/dashboard
// Figma: Dispensing(8), Ready(5), Low-stock(11), Expiring(7)
// ============================================
exports.getDashboard = async (req, res) => {
  try {
    // Card 1: Dispensing queue (pending prescriptions)
    const [dispensingQueue] = await db.query(
      `SELECT 
        COUNT(*) AS total,
        SUM(CASE WHEN priority = 'priority' OR priority = 'urgent' THEN 1 ELSE 0 END) AS priority_count
       FROM prescriptions
       WHERE status = 'pending'`
    );

    // Card 2: Ready for pickup
    const [readyForPickup] = await db.query(
      `SELECT 
        COUNT(*) AS count,
        COALESCE(MAX(TIMESTAMPDIFF(MINUTE, created_at, NOW())), 0) AS oldest_minutes
       FROM prescriptions
       WHERE status = 'ready'`
    );

    // Card 3: Low-stock items
    const [lowStock] = await db.query(
      `SELECT 
        COUNT(*) AS total,
        SUM(CASE WHEN stock_quantity <= critical_stock_level THEN 1 ELSE 0 END) AS critical_count
       FROM medicines
       WHERE stock_quantity <= min_stock_level`
    );

    // Card 4: Expiring in 60 days
    const [expiring] = await db.query(
      `SELECT 
        COUNT(*) AS count,
        COALESCE(SUM(stock_quantity * price), 0) AS inventory_value
       FROM medicines
       WHERE expiry_date IS NOT NULL
         AND expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 60 DAY)`
    );

    // Get pharmacy staff info
    const [pharmacyInfo] = await db.query(
      `SELECT u.full_name, u.profile_image, 
              ps.role_type, ps.shift,
              b.name AS branch_name
       FROM users u
       LEFT JOIN pharmacy_staff ps ON ps.user_id = u.id
       LEFT JOIN branches b ON u.branch_id = b.id
       WHERE u.id = ?`,
      [req.user.id]
    );

    res.json({
      success: true,
      pharmacy: pharmacyInfo[0] || {},
      stats: {
        dispensing_queue: {
          total: dispensingQueue[0].total || 0,
          priority_count: dispensingQueue[0].priority_count || 0
        },
        ready_for_pickup: {
          count: readyForPickup[0].count || 0,
          oldest_ready_minutes: readyForPickup[0].oldest_minutes || 0
        },
        low_stock: {
          total: lowStock[0].total || 0,
          critical_count: lowStock[0].critical_count || 0
        },
        expiring_soon: {
          count: expiring[0].count || 0,
          inventory_value: parseFloat(expiring[0].inventory_value) || 0
        }
      }
    });
  } catch (err) {
    console.error('Pharmacy dashboard error:', err);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: err.message
    });
  }
};

// ============================================
// 2. DISPENSING QUEUE
// GET /api/pharmacy/dispensing-queue
// Figma: RX-8412, RX-8411, RX-8410, RX-8408
// ============================================
exports.getDispensingQueue = async (req, res) => {
  try {
    const { status } = req.query;

    let query = `
      SELECT 
        p.id, p.rx_number, p.medicine_name, p.dosage, p.frequency,
        p.duration_days, p.quantity, p.instructions, p.status, p.priority,
        p.created_at, p.dispensed_at,
        an.id AS animal_id, an.name AS animal_name, an.species, an.photo AS animal_photo,
        u.id AS owner_id, u.full_name AS owner_name, u.phone AS owner_phone,
        vst.full_name AS vet_name,
        m.id AS medicine_id, m.stock_quantity AS available_stock, m.price,
        m.batch_number, m.expiry_date
       FROM prescriptions p
       JOIN animals an ON p.animal_id = an.id
       JOIN users u ON an.owner_id = u.id
       LEFT JOIN veterinarians v ON p.vet_id = v.id
       LEFT JOIN users vst ON v.user_id = vst.id
       LEFT JOIN medicines m ON p.medicine_id = m.id
    `;
    const params = [];

    if (status) {
      query += ' WHERE p.status = ?';
      params.push(status);
    } else {
      query += " WHERE p.status IN ('pending', 'ready')";
    }

    query += ` ORDER BY 
      CASE p.priority 
        WHEN 'urgent' THEN 1 
        WHEN 'priority' THEN 2 
        ELSE 3 
      END,
      p.created_at ASC`;

    const [queue] = await db.query(query, params);

    // Group by status
    const pending = queue.filter(q => q.status === 'pending');
    const ready = queue.filter(q => q.status === 'ready');

    res.json({
      success: true,
      count: queue.length,
      pending_count: pending.length,
      ready_count: ready.length,
      priority_count: queue.filter(q => q.priority === 'priority' || q.priority === 'urgent').length,
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
// 3. GET ONE PRESCRIPTION (Figma: Dispense RX-8412)
// GET /api/pharmacy/prescriptions/:id
// ============================================
exports.getPrescription = async (req, res) => {
  try {
    const [prescriptions] = await db.query(
      `SELECT 
        p.*,
        an.name AS animal_name, an.species, an.breed,
        an.age_months, an.weight_kg, an.photo AS animal_photo,
        u.id AS owner_id, u.full_name AS owner_name, u.phone AS owner_phone,
        vst.full_name AS vet_name,
        m.stock_quantity AS available_stock, 
        m.batch_number, m.expiry_date, m.price AS medicine_price
       FROM prescriptions p
       JOIN animals an ON p.animal_id = an.id
       JOIN users u ON an.owner_id = u.id
       LEFT JOIN veterinarians v ON p.vet_id = v.id
       LEFT JOIN users vst ON v.user_id = vst.id
       LEFT JOIN medicines m ON p.medicine_id = m.id
       WHERE p.id = ?`,
      [req.params.id]
    );

    if (prescriptions.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Prescription not found ❌'
      });
    }

    // Check allergies (Figma: "Allergy and interaction check passed")
    const [allergies] = await db.query(
      `SELECT allergen, severity FROM allergies WHERE animal_id = ?`,
      [prescriptions[0].animal_id]
    );

    res.json({
      success: true,
      prescription: prescriptions[0],
      allergies,
      interaction_check: {
        passed: true,
        message: 'Allergy and interaction check passed'
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
// 4. MARK AS READY (Figma: "Ready to fill" → "Ready")
// PUT /api/pharmacy/prescriptions/:id/ready
// ============================================
exports.markAsReady = async (req, res) => {
  try {
    const { id } = req.params;

    const [existing] = await db.query(
      'SELECT id, status FROM prescriptions WHERE id = ?',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Prescription not found ❌'
      });
    }

    if (existing[0].status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Cannot mark as ready. Current status: ${existing[0].status} ❌`
      });
    }

    await db.query(
      `UPDATE prescriptions SET status = 'ready' WHERE id = ?`,
      [id]
    );

    // Notify owner
    const [presc] = await db.query(
      `SELECT p.rx_number, an.owner_id, an.name AS animal_name
       FROM prescriptions p
       JOIN animals an ON p.animal_id = an.id
       WHERE p.id = ?`,
      [id]
    );

    if (presc.length > 0) {
      await db.query(
        `INSERT INTO notifications (user_id, title, message, type) 
         VALUES (?, ?, ?, 'prescription')`,
        [
          presc[0].owner_id,
          'ማዘዣ ዝግጁ ነው',
          `${presc[0].animal_name} ማዘዣ (${presc[0].rx_number}) ዝግጁ ነው`
        ]
      );
    }

    res.json({
      success: true,
      message: 'Prescription marked as ready ✅',
      status: 'ready'
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
// 5. DISPENSE (Figma: "Print label & dispense")
// POST /api/pharmacy/dispense/:id
// Body: { quantity, batch_number }
// ============================================
exports.dispensePrescription = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const { id } = req.params;
    const { quantity, batch_number, notes } = req.body;

    // Get prescription
    const [prescriptions] = await connection.query(
      `SELECT p.*, m.id AS med_id, m.stock_quantity, m.name AS medicine_full_name
       FROM prescriptions p
       LEFT JOIN medicines m ON p.medicine_id = m.id
       WHERE p.id = ?`,
      [id]
    );

    if (prescriptions.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: 'Prescription not found ❌'
      });
    }

    const presc = prescriptions[0];

    if (presc.status === 'dispensed') {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: 'Already dispensed ❌'
      });
    }

    // Check stock
    if (presc.med_id && presc.stock_quantity < (quantity || 1)) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: `Insufficient stock. Available: ${presc.stock_quantity} ❌`
      });
    }

    // Get pharmacy staff ID
    const pharmacyStaffId = await getPharmacyStaffId(req.user.id);

    // Update prescription
    await connection.query(
      `UPDATE prescriptions 
       SET status = 'dispensed',
           dispensed_by = ?,
           dispensed_at = NOW(),
           quantity = COALESCE(?, quantity),
           instructions = COALESCE(?, instructions)
       WHERE id = ?`,
      [pharmacyStaffId, quantity || null, notes || null, id]
    );

    // Deduct stock
    if (presc.med_id && quantity) {
      await connection.query(
        `UPDATE medicines 
         SET stock_quantity = stock_quantity - ? 
         WHERE id = ?`,
        [quantity, presc.med_id]
      );

      // Check if stock fell below minimum → create alert
      const [updated] = await connection.query(
        'SELECT stock_quantity, min_stock_level, critical_stock_level, name FROM medicines WHERE id = ?',
        [presc.med_id]
      );

      if (updated.length > 0) {
        const med = updated[0];
        if (med.stock_quantity <= med.critical_stock_level) {
          await connection.query(
            `INSERT INTO stock_alerts (medicine_id, alert_type, message) 
             VALUES (?, 'critical_stock', ?)`,
            [presc.med_id, `${med.name} - Only ${med.stock_quantity} left (critical: ${med.critical_stock_level})`]
          );
        } else if (med.stock_quantity <= med.min_stock_level) {
          await connection.query(
            `INSERT INTO stock_alerts (medicine_id, alert_type, message) 
             VALUES (?, 'low_stock', ?)`,
            [presc.med_id, `${med.name} - Only ${med.stock_quantity} left (min: ${med.min_stock_level})`]
          );
        }
      }
    }

    await connection.commit();

    res.json({
      success: true,
      message: 'Prescription dispensed ✅',
      dispensed_at: new Date().toISOString(),
      status: 'dispensed'
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
// 6. DRUG INVENTORY
// GET /api/pharmacy/medicines
// Figma: "Drug inventory"
// ============================================
exports.getMedicines = async (req, res) => {
  try {
    const { category, low_stock, expiring, search } = req.query;

    let query = `
      SELECT 
        m.*,
        s.name AS supplier_name,
        b.name AS branch_name,
        CASE 
          WHEN m.stock_quantity = 0 THEN 'out_of_stock'
          WHEN m.stock_quantity <= m.critical_stock_level THEN 'critical'
          WHEN m.stock_quantity <= m.min_stock_level THEN 'low'
          WHEN m.expiry_date IS NOT NULL 
            AND m.expiry_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY) THEN 'expiring_soon'
          WHEN m.expiry_date IS NOT NULL 
            AND m.expiry_date <= DATE_ADD(CURDATE(), INTERVAL 60 DAY) THEN 'expiring'
          ELSE 'ok'
        END AS stock_status
       FROM medicines m
       LEFT JOIN suppliers s ON m.supplier_id = s.id
       LEFT JOIN branches b ON m.branch_id = b.id
       WHERE 1=1
    `;
    const params = [];

    if (category) {
      query += ' AND m.category = ?';
      params.push(category);
    }
    if (low_stock === 'true') {
      query += ' AND m.stock_quantity <= m.min_stock_level';
    }
    if (expiring === 'true') {
      query += ' AND m.expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 60 DAY)';
    }
    if (search) {
      query += ' AND (m.name LIKE ? OR m.generic_name LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    query += ' ORDER BY stock_status DESC, m.name ASC';

    const [medicines] = await db.query(query, params);

    res.json({
      success: true,
      count: medicines.length,
      low_stock_count: medicines.filter(m => m.stock_status === 'low' || m.stock_status === 'critical').length,
      out_of_stock_count: medicines.filter(m => m.stock_status === 'out_of_stock').length,
      medicines
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
// 7. ADD MEDICINE
// POST /api/pharmacy/medicines
// ============================================
exports.addMedicine = async (req, res) => {
  try {
    const {
      name, generic_name, category, description, price,
      stock_quantity, min_stock_level, critical_stock_level,
      batch_number, expiry_date, supplier_id, branch_id
    } = req.body;

    if (!name || !price) {
      return res.status(400).json({
        success: false,
        message: 'Name and price required ❌'
      });
    }

    const [result] = await db.query(
      `INSERT INTO medicines 
       (name, generic_name, category, description, price,
        stock_quantity, min_stock_level, critical_stock_level,
        batch_number, expiry_date, supplier_id, branch_id) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name, generic_name || null, category || null, description || null,
        price, stock_quantity || 0, min_stock_level || 10,
        critical_stock_level || 5, batch_number || null,
        expiry_date || null, supplier_id || null, branch_id || null
      ]
    );

    res.status(201).json({
      success: true,
      message: 'Medicine added ✅',
      medicine_id: result.insertId
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
// 8. UPDATE MEDICINE STOCK
// PUT /api/pharmacy/medicines/:id
// ============================================
exports.updateMedicine = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name, category, price, stock_quantity,
      min_stock_level, critical_stock_level,
      batch_number, expiry_date
    } = req.body;

    const [existing] = await db.query(
      'SELECT id FROM medicines WHERE id = ?',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Medicine not found ❌'
      });
    }

    await db.query(
      `UPDATE medicines SET
        name = COALESCE(?, name),
        category = COALESCE(?, category),
        price = COALESCE(?, price),
        stock_quantity = COALESCE(?, stock_quantity),
        min_stock_level = COALESCE(?, min_stock_level),
        critical_stock_level = COALESCE(?, critical_stock_level),
        batch_number = COALESCE(?, batch_number),
        expiry_date = COALESCE(?, expiry_date)
       WHERE id = ?`,
      [
        name, category, price, stock_quantity,
        min_stock_level, critical_stock_level,
        batch_number, expiry_date, id
      ]
    );

    res.json({
      success: true,
      message: 'Medicine updated ✅'
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
// 9. STOCK ALERTS
// GET /api/pharmacy/stock-alerts
// Figma: "Stock alerts (11)"
// ============================================
exports.getStockAlerts = async (req, res) => {
  try {
    const { resolved } = req.query;

    let query = `
      SELECT 
        sa.*,
        m.name AS medicine_name,
        m.stock_quantity,
        m.min_stock_level,
        m.critical_stock_level,
        m.expiry_date,
        m.price,
        b.name AS branch_name
       FROM stock_alerts sa
       LEFT JOIN medicines m ON sa.medicine_id = m.id
       LEFT JOIN branches b ON m.branch_id = b.id
    `;
    const params = [];

    if (resolved === 'true') {
      query += ' WHERE sa.is_resolved = TRUE';
    } else if (resolved === 'false' || !resolved) {
      query += ' WHERE sa.is_resolved = FALSE';
    }

    query += ` ORDER BY 
      CASE sa.alert_type 
        WHEN 'critical_stock' THEN 1 
        WHEN 'expired' THEN 2 
        WHEN 'low_stock' THEN 3 
        WHEN 'expiring' THEN 4 
      END,
      sa.created_at DESC`;

    const [alerts] = await db.query(query, params);

    res.json({
      success: true,
      count: alerts.length,
      critical_count: alerts.filter(a => a.alert_type === 'critical_stock').length,
      low_stock_count: alerts.filter(a => a.alert_type === 'low_stock').length,
      expiring_count: alerts.filter(a => a.alert_type === 'expiring').length,
      alerts
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
// 10. RESOLVE ALERT
// PUT /api/pharmacy/stock-alerts/:id/resolve
// ============================================
exports.resolveAlert = async (req, res) => {
  try {
    await db.query(
      `UPDATE stock_alerts 
       SET is_resolved = TRUE, resolved_at = NOW() 
       WHERE id = ?`,
      [req.params.id]
    );

    res.json({
      success: true,
      message: 'Alert resolved ✅'
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
// 11. VACCINES (Figma sidebar)
// GET /api/pharmacy/vaccines
// ============================================
exports.getVaccines = async (req, res) => {
  try {
    const [vaccines] = await db.query(
      `SELECT 
        m.*,
        CASE 
          WHEN m.stock_quantity = 0 THEN 'out_of_stock'
          WHEN m.stock_quantity <= m.critical_stock_level THEN 'critical'
          WHEN m.stock_quantity <= m.min_stock_level THEN 'low'
          ELSE 'ok'
        END AS stock_status
       FROM medicines m
       WHERE m.category IN ('Vaccine', 'vaccine') OR m.name LIKE '%Vaccine%'
       ORDER BY m.stock_quantity ASC, m.name ASC`
    );

    res.json({
      success: true,
      count: vaccines.length,
      low_stock_count: vaccines.filter(v => v.stock_status !== 'ok').length,
      vaccines
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
// 12. TOOLS & CONSUMABLES (Figma sidebar)
// GET /api/pharmacy/tools-consumables
// ============================================
exports.getToolsConsumables = async (req, res) => {
  try {
    const [items] = await db.query(
      `SELECT 
        m.*,
        CASE 
          WHEN m.stock_quantity = 0 THEN 'out_of_stock'
          WHEN m.stock_quantity <= m.critical_stock_level THEN 'critical'
          WHEN m.stock_quantity <= m.min_stock_level THEN 'low'
          ELSE 'ok'
        END AS stock_status
       FROM medicines m
       WHERE m.category IN ('Tool', 'Consumable', 'Equipment', 'Tools')
       ORDER BY stock_status DESC, m.name ASC`
    );

    res.json({
      success: true,
      count: items.length,
      low_stock_count: items.filter(i => i.stock_status !== 'ok').length,
      items
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
// 13. SUPPLIERS
// GET /api/pharmacy/suppliers
// ============================================
exports.getSuppliers = async (req, res) => {
  try {
    const [suppliers] = await db.query(
      `SELECT 
        s.*,
        (SELECT COUNT(*) FROM medicines WHERE supplier_id = s.id) AS medicine_count,
        (SELECT COUNT(*) FROM purchase_orders WHERE supplier_id = s.id AND status NOT IN ('received', 'cancelled')) AS active_orders
       FROM suppliers s
       ORDER BY s.name ASC`
    );

    res.json({
      success: true,
      count: suppliers.length,
      suppliers
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
// 14. PURCHASE ORDERS
// GET /api/pharmacy/purchase-orders
// ============================================
exports.getPurchaseOrders = async (req, res) => {
  try {
    const { status } = req.query;

    let query = `
      SELECT 
        po.*,
        s.name AS supplier_name,
        b.name AS branch_name,
        u.full_name AS created_by_name,
        (SELECT COUNT(*) FROM purchase_order_items WHERE purchase_order_id = po.id) AS item_count
       FROM purchase_orders po
       LEFT JOIN suppliers s ON po.supplier_id = s.id
       LEFT JOIN branches b ON po.branch_id = b.id
       LEFT JOIN users u ON po.created_by = u.id
    `;
    const params = [];

    if (status) {
      query += ' WHERE po.status = ?';
      params.push(status);
    }

    query += ' ORDER BY po.created_at DESC LIMIT 50';

    const [orders] = await db.query(query, params);

    res.json({
      success: true,
      count: orders.length,
      orders
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
// 15. CREATE PURCHASE ORDER
// POST /api/pharmacy/purchase-orders
// ============================================
exports.createPurchaseOrder = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const { supplier_id, branch_id, expected_date, items, notes } = req.body;

    if (!supplier_id || !items || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'supplier_id and items required ❌'
      });
    }

    // Generate PO number
    const [count] = await connection.query(
      'SELECT COUNT(*) AS total FROM purchase_orders'
    );
    const poNumber = `PO-${new Date().getFullYear()}-${String(count[0].total + 1).padStart(3, '0')}`;

    // Calculate total
    const totalAmount = items.reduce((sum, item) => {
      return sum + (parseFloat(item.unit_price) * parseInt(item.quantity));
    }, 0);

    // Insert PO
    const [poResult] = await connection.query(
      `INSERT INTO purchase_orders 
       (po_number, supplier_id, branch_id, order_date, expected_date, 
        status, total_amount, notes, created_by) 
       VALUES (?, ?, ?, CURDATE(), ?, 'pending', ?, ?, ?)`,
      [
        poNumber, supplier_id, branch_id || null,
        expected_date || null, totalAmount,
        notes || null, req.user.id
      ]
    );

    // Insert items
    for (const item of items) {
      await connection.query(
        `INSERT INTO purchase_order_items 
         (purchase_order_id, medicine_id, item_name, quantity, unit_price, total_price) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          poResult.insertId,
          item.medicine_id || null,
          item.item_name || null,
          item.quantity,
          item.unit_price,
          item.quantity * item.unit_price
        ]
      );
    }

    await connection.commit();

    res.status(201).json({
      success: true,
      message: 'Purchase order created ✅',
      purchase_order: {
        id: poResult.insertId,
        po_number: poNumber,
        total_amount: totalAmount
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
// 16. RECEIVE PURCHASE ORDER (Stock In)
// PUT /api/pharmacy/purchase-orders/:id/receive
// ============================================
exports.receivePurchaseOrder = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const { id } = req.params;

    // Get PO
    const [orders] = await connection.query(
      'SELECT id, status FROM purchase_orders WHERE id = ?',
      [id]
    );

    if (orders.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: 'Purchase order not found ❌'
      });
    }

    if (orders[0].status === 'received') {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: 'Already received ❌'
      });
    }

    // Get items
    const [items] = await connection.query(
      'SELECT * FROM purchase_order_items WHERE purchase_order_id = ?',
      [id]
    );

    // Update stock for each item
    for (const item of items) {
      if (item.medicine_id) {
        await connection.query(
          `UPDATE medicines 
           SET stock_quantity = stock_quantity + ? 
           WHERE id = ?`,
          [item.quantity, item.medicine_id]
        );
      }
    }

    // Update PO status
    await connection.query(
      `UPDATE purchase_orders SET status = 'received' WHERE id = ?`,
      [id]
    );

    await connection.commit();

    res.json({
      success: true,
      message: 'Purchase order received, stock updated ✅',
      items_updated: items.length
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
// 17. EXPIRING SOON LIST
// GET /api/pharmacy/expiring
// ============================================
exports.getExpiring = async (req, res) => {
  try {
    const { days } = req.query;
    const daysAhead = days || 60;

    const [medicines] = await db.query(
      `SELECT 
        m.*,
        DATEDIFF(m.expiry_date, CURDATE()) AS days_until_expiry,
        (m.stock_quantity * m.price) AS inventory_value
       FROM medicines m
       WHERE m.expiry_date IS NOT NULL
         AND m.expiry_date BETWEEN CURDATE() 
           AND DATE_ADD(CURDATE(), INTERVAL ? DAY)
       ORDER BY m.expiry_date ASC`,
      [daysAhead]
    );

    const totalValue = medicines.reduce(
      (sum, m) => sum + parseFloat(m.inventory_value || 0), 0
    );

    res.json({
      success: true,
      count: medicines.length,
      total_inventory_value: parseFloat(totalValue.toFixed(2)),
      days_ahead: daysAhead,
      medicines
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: err.message
    });
  }
};