const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

// Import routes
const testRoutes = require('./routes/testRoutes');
const authRoutes = require('./routes/authRoutes');
const animalRoutes = require('./routes/animalRoutes');
const appointmentRoutes = require('./routes/appointmentRoutes');
const vetRoutes = require('./routes/vetRoutes');
const labRoutes = require('./routes/labRoutes');
const receptionistRoutes = require('./routes/receptionistRoutes');
const pharmacyRoutes = require('./routes/pharmacyRoutes');
const adminRoutes = require('./routes/adminRoutes');
const ownerRoutes = require('./routes/ownerRoutes');                 // 🆕

// Import middleware
const errorMiddleware = require('./middleware/errorMiddleware');

const app = express();

// Global Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes
app.use('/api/test', testRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/animals', animalRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/vet', vetRoutes);
app.use('/api/lab', labRoutes);
app.use('/api/receptionist', receptionistRoutes);
app.use('/api/pharmacy', pharmacyRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/owner', ownerRoutes);                                  // 🆕

// Home
app.get('/', (req, res) => {
  res.json({
    message: '🐾 VetraCare API Running',
    version: '1.0.0',
    status: 'OK',
    endpoints: {
      auth: '/api/auth/login',
      animals: '/api/animals/my',
      appointments: '/api/appointments/my',
      vet_dashboard: '/api/vet/dashboard',
      lab_dashboard: '/api/lab/dashboard',
      receptionist_dashboard: '/api/receptionist/dashboard',
      pharmacy_dashboard: '/api/pharmacy/dashboard',
      admin_dashboard: '/api/admin/dashboard',
      owner_dashboard: '/api/owner/dashboard'
    }
  });
});

// 404
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found ❌'
  });
});

// Error handler
app.use(errorMiddleware);

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log('====================================');
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 http://localhost:${PORT}`);
 
});