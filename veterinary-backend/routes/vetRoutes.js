const express = require('express');
const router = express.Router();

const {
  getDashboard,
  getTodaySchedule,
  getPatientQueue,
  getResultsToReview,
  getFollowUps,
  getPatients,
  getPatientDetail,
  createSoapNote,
  getSoapNote,
  orderLabTest,
  createPrescription
} = require('../controllers/vetController');

const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');

// All routes: auth + vet/admin
router.use(authMiddleware);
router.use(roleMiddleware('vet', 'admin'));

// Dashboard
router.get('/dashboard', getDashboard);

// Schedule & Queue
router.get('/schedule/today', getTodaySchedule);
router.get('/patient-queue', getPatientQueue);

// Reviews & Follow-ups
router.get('/results-to-review', getResultsToReview);
router.get('/follow-ups', getFollowUps);

// Patients
router.get('/patients', getPatients);
router.get('/patients/:id', getPatientDetail);

// SOAP Notes
router.post('/soap-notes', createSoapNote);
router.get('/soap-notes/:id', getSoapNote);

// Actions
router.post('/lab-order', orderLabTest);
router.post('/prescription', createPrescription);

module.exports = router;