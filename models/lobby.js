const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const LobbySchema = new Schema({
    host: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    storeName: { type: String, required: true },
    targetAmount: { type: Number, required: true, default: 399 },
    currentAmount: { type: Number, default: 0 },
    duration: { type: Number, default: 10 }, // Mins until expiry
    status: { type: String, enum: ['Open', 'Ordered', 'Closed'], default: 'Open' },
    createdAt: { type: Date, default: Date.now },
    members: [{
        user: { type: Schema.Types.ObjectId, ref: 'User' },
        itemsDescription: String,
        itemCost: Number
    }]
});

module.exports = mongoose.model('Lobby', LobbySchema);