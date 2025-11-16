import mongoose from 'mongoose';

const ItemPriceSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
  },
  prices: {
    BRITAM: Number,
    NSSF: Number,
    NHIF: Number,
    ASSEMBLE: Number,
    Pharmacy: Number,
    HospitalShop: Number,
  },
});

export default mongoose.model('ItemPrice', ItemPriceSchema);