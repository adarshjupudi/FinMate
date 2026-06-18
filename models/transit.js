const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const TransitSchema = new Schema({
    host: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    destination: { type: String, required: true },
    vehicleType: { type: String, enum: ['Auto', 'Cab'], default: 'Auto' },
    targetCapacity: { type: Number, required: true, default: 3 }, // Auto=3, Cab=4
    currentCapacity: { type: Number, default: 1 }, // Host takes 1 seat
    duration: { type: Number, default: 10 }, // Mins until expiry
    status: { type: String, enum: ['Open', 'Departed', 'Closed'], default: 'Open' },
    createdAt: { type: Date, default: Date.now },
    members: [{
        user: { type: Schema.Types.ObjectId, ref: 'User' },
        seats: { type: Number, default: 1 }
    }]
});

module.exports = mongoose.model('Transit', TransitSchema);