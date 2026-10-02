const express = require('express');
const router = express.Router();

const {
  getDashboard,
  getMyAnimals,
  getMyAppointments,
  bookAppointment,
  updateAppointment,
  getVaccinations,
  getMedicalRecords,
  getLabReports,
  getLabReport,
  getPrescriptions,
  getInvoices,
  getInvoice,
  getCareChecklist,
  getAvailableVets,
  getServices,
  getAnimalDetail,
  addAnimal,
  getNotifications,
  markNotificationRead,
  updateProfile
} = require('../controllers/ownerController');

const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');

// All routes: auth + owner role
router.use(authMiddleware);
router.use(roleMiddleware('owner'));

// Dashboard
router.get('/dashboard', getDashboard);

// Animals
router.get('/animals', getMyAnimals);
router.get('/animals/:id', getAnimalDetail);
router.post('/animals', addAnimal);

// Appointments
router.get('/appointments', getMyAppointments);
router.post('/appointments', bookAppointment);
router.put('/appointments/:id', updateAppointment);

// Vaccinations
router.get('/vaccinations', getVaccinations);

// Medical records
router.get('/medical-records', getMedicalRecords);

// Lab reports
router.get('/lab-reports', getLabReports);
router.get('/lab-reports/:id', getLabReport);

// Prescriptions
router.get('/prescriptions', getPrescriptions);

// Invoices
router.get('/invoices', getInvoices);
router.get('/invoices/:id', getInvoice);

// Care checklist
router.get('/care-checklist', getCareChecklist);

// Booking helpers
router.get('/available-vets', getAvailableVets);
router.get('/services', getServices);

// Notifications
router.get('/notifications', getNotifications);
router.put('/notifications/:id/read', markNotificationRead);

// Profile
router.put('/profile', updateProfile);

module.exports = router;