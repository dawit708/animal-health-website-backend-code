const express = require('express');
const router = express.Router();

const {
  getDashboard,
  getSampleTracking,
  getRequisitions,
  getSample,
  startProcessing,
  submitFindings,
  validateResult,
  getAwaitingValidation,
  getEquipment,
  getReagents,
  getReports,
  getQualityControl
} = require('../controllers/labController');

const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');

// All routes: auth + lab/admin role
router.use(authMiddleware);
router.use(roleMiddleware('lab', 'admin'));

// Dashboard
router.get('/dashboard', getDashboard);

// Samples
router.get('/samples', getSampleTracking);
router.get('/samples/:id', getSample);
router.put('/samples/:id/process', startProcessing);
router.put('/samples/:id/validate', validateResult);

// Requisitions & Findings
router.get('/requisitions', getRequisitions);
router.get('/awaiting-validation', getAwaitingValidation);
router.post('/findings/:id', submitFindings);

// Equipment & Reagents
router.get('/equipment', getEquipment);
router.get('/reagents', getReagents);

// Reports & QC
router.get('/reports', getReports);
router.get('/quality-control', getQualityControl);

module.exports = router;