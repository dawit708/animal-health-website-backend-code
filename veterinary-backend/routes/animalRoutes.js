const express = require('express');
const router = express.Router();
const {
  createAnimal,
  getMyAnimals,
  getAnimal,
  updateAnimal,
  deleteAnimal,
  getAllergies,
  addAllergy,
  getVaccinations,
  getMedicalRecords,
  getChronicConditions,
  searchAnimals
} = require('../controllers/animalController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');
router.use(authMiddleware);
router.get('/my', roleMiddleware('owner'), getMyAnimals);
router.get('/search', roleMiddleware('admin', 'vet', 'receptionist', 'lab'), searchAnimals);
router.post('/', roleMiddleware('owner', 'receptionist', 'admin'), createAnimal);
router.get('/:id', getAnimal);
router.put('/:id', roleMiddleware('owner', 'receptionist', 'admin'), updateAnimal);
router.delete('/:id', roleMiddleware('owner', 'admin'), deleteAnimal);
router.get('/:id/allergies', getAllergies);
router.post('/:id/allergies', roleMiddleware('vet', 'admin'), addAllergy);
router.get('/:id/vaccinations', getVaccinations);
router.get('/:id/medical-records', getMedicalRecords);
router.get('/:id/chronic-conditions', getChronicConditions);
module.exports = router;