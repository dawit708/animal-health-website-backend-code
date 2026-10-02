const express = require('express');
const router = express.Router();

const {
  getDashboard,
  getCheckInQueue,
  checkInPatient,
  getAllAppointments,
  registerOwnerAndAnimal,
  searchOwner,
  getOwnerDetail,
  getUnpaidInvoices,
  createInvoice,
  processPayment,
  getInvoiceDetail,
  getNewRegistrations,
  rescheduleAppointment,
  createWalkIn
} = require('../controllers/receptionistController');

const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');

// All routes: auth + receptionist/admin role
router.use(authMiddleware);
router.use(roleMiddleware('receptionist', 'admin'));

// Dashboard
router.get('/dashboard', getDashboard);

// Check-in queue
router.get('/check-in-queue', getCheckInQueue);
router.put('/check-in/:id', checkInPatient);

// Appointments
router.get('/appointments', getAllAppointments);
router.put('/reschedule/:id', rescheduleAppointment);
router.post('/walk-in', createWalkIn);

// Owner & Animal registration
router.post('/register', registerOwnerAndAnimal);
router.get('/search-owner', searchOwner);
router.get('/owners/:id', getOwnerDetail);
router.get('/new-registrations', getNewRegistrations);

// Invoices & Payments
router.get('/unpaid-invoices', getUnpaidInvoices);
router.post('/invoices', createInvoice);
router.get('/invoices/:id', getInvoiceDetail);
router.post('/payments', processPayment);

module.exports = router;