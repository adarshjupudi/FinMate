const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const LobbySchema = new Schema({
    host: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    storeName: {
        type: String,
        required: true
    },
    targetAmount: {
        type: Number,
        required: true,
        default: 399 // Typical free delivery cap
    },
    currentAmount: {
        type: Number,
        default: 0
    },
    status: {
        type: String,
        enum: ['Open', 'Ordered', 'Closed'],
        default: 'Open'
    },
    members: [{
        user: {
            type: Schema.Types.ObjectId,
            ref: 'User'
        },
        itemsDescription: String,
        itemCost: Number
    }]
}, { timestamps: true });

module.exports = mongoose.model('Lobby', LobbySchema);