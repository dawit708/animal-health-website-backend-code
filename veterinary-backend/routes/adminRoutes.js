const express = require('express');
const router = express.Router();

const {
  getDashboard,
  getAllUsers,
  getUser,
  createUser,
  updateUser,
  deleteUser,
  getBranches,
  createBranch,
  updateBranch,
  getInvitations,
  sendInvitation,
  cancelInvitation,
  getServices,
  createService,
  updateService,
  getSecurity,
  getBackups,
  createBackup,
  getSystemLogs,
  getSystemStats,
  getMaintenance
} = require('../controllers/adminController');

const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');

// All routes: auth + admin role only
router.use(authMiddleware);
router.use(roleMiddleware('admin'));

// Dashboard
router.get('/dashboard', getDashboard);
router.get('/stats', getSystemStats);

// Users
router.get('/users', getAllUsers);
router.post('/users', createUser);
router.get('/users/:id', getUser);
router.put('/users/:id', updateUser);
router.delete('/users/:id', deleteUser);

// Branches
router.get('/branches', getBranches);
router.post('/branches', createBranch);
router.put('/branches/:id', updateBranch);

// Invitations
router.get('/invitations', getInvitations);
router.post('/invitations', sendInvitation);
router.delete('/invitations/:id', cancelInvitation);

// Services & Pricing
router.get('/services', getServices);
router.post('/services', createService);
router.put('/services/:id', updateService);

// Security
router.get('/security', getSecurity);

// Backups
router.get('/backups', getBackups);
router.post('/backups', createBackup);

// System Logs
router.get('/logs', getSystemLogs);

// Maintenance
router.get('/maintenance', getMaintenance);

module.exports = router;