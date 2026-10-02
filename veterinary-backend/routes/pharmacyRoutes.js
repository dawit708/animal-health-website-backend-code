const express = require('express');
const router = express.Router();

const {
  getDashboard,
  getDispensingQueue,
  getPrescription,
  markAsReady,
  dispensePrescription,
  getMedicines,
  addMedicine,
  updateMedicine,
  getStockAlerts,
  resolveAlert,
  getVaccines,
  getToolsConsumables,
  getSuppliers,
  getPurchaseOrders,
  createPurchaseOrder,
  receivePurchaseOrder,
  getExpiring
} = require('../controllers/pharmacyController');

const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');

// All routes: auth + pharmacy/admin role
router.use(authMiddleware);
router.use(roleMiddleware('pharmacy', 'admin'));

// Dashboard
router.get('/dashboard', getDashboard);

// Dispensing queue
router.get('/dispensing-queue', getDispensingQueue);
router.get('/prescriptions/:id', getPrescription);
router.put('/prescriptions/:id/ready', markAsReady);
router.post('/dispense/:id', dispensePrescription);

// Drug inventory
router.get('/medicines', getMedicines);
router.post('/medicines', addMedicine);
router.put('/medicines/:id', updateMedicine);

// Vaccines & Tools
router.get('/vaccines', getVaccines);
router.get('/tools-consumables', getToolsConsumables);

// Stock alerts
router.get('/stock-alerts', getStockAlerts);
router.put('/stock-alerts/:id/resolve', resolveAlert);

// Expiring
router.get('/expiring', getExpiring);

// Suppliers
router.get('/suppliers', getSuppliers);

// Purchase orders
router.get('/purchase-orders', getPurchaseOrders);
router.post('/purchase-orders', createPurchaseOrder);
router.put('/purchase-orders/:id/receive', receivePurchaseOrder);

module.exports = router;