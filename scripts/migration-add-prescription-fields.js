import mongoose from 'mongoose';
import Visit from '../models/Visit.js';

async function migratePrescriptions() {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/hospital_management', {
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
    });

  const visits = await Visit.find({ 'prescriptions.0': { $exists: true } });
  
  for (const visit of visits) {
    visit.prescriptions.forEach(prescription => {
      // Set default values for new fields
      if (!prescription.status) {
        prescription.status = 'Pending Quantification';
      }
      if (!prescription.sentToPharmacyAt) {
        prescription.sentToPharmacyAt = prescription.createdAt || new Date();
      }
    });
    
    await visit.save();
  }
  
  console.log(`Migrated ${visits.length} visits`);
}

migratePrescriptions();