const express = require('express');
const router = express.Router();

const {
  createAppointment,
  getMyAppointments,
  getAllAppointments,
  getTodayAppointments,
  getAppointment,
  updateStatus,
  checkIn,
  updateAppointment,
  deleteAppointment,
  getAvailableVets,
  getUpcoming
} = require('../controllers/appointmentController');

const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');

// All routes need auth
router.use(authMiddleware);
router.get('/my', roleMiddleware('owner'), getMyAppointments);
router.get('/today', roleMiddleware('admin', 'vet', 'receptionist'), getTodayAppointments);
router.get('/upcoming', getUpcoming);
router.get('/available-vets', getAvailableVets);
router.post('/', roleMiddleware('owner', 'receptionist', 'admin'), createAppointment);
router.get('/', roleMiddleware('admin', 'vet', 'receptionist'), getAllAppointments);
router.get('/:id', getAppointment);
router.put('/:id', roleMiddleware('owner', 'receptionist', 'admin'), updateAppointment);
router.delete('/:id', roleMiddleware('owner', 'admin'), deleteAppointment);
router.put('/:id/status', roleMiddleware('vet', 'receptionist', 'admin'), updateStatus);
router.put('/:id/check-in', roleMiddleware('receptionist', 'admin'), checkIn);

module.exports = router;