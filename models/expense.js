const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const ExpenseSchema = new Schema({
    description: {
        type: String,
        required: true
    },
    amount: {
        type: Number,
        required: true,
        min: 0
    },
    category: {
        type: String,
        required: true,
        enum: ['Canteen', 'Academics', 'Travel', 'Junk Food', 'Other']
    },
    paidBy: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    splitType: {
        type: String,
        required: true,
        // Added 'Settlement' to explicitly track incoming peer payments
        enum: ['None', 'Equi-Split', 'Custom Split', 'Settlement'],
        default: 'None'
    },
    participants: [{
        user: {
            type: Schema.Types.ObjectId,
            ref: 'User'
        },
        owedAmount: {
            type: Number,
            default: 0
        },
        isSettled: {
            type: Boolean,
            default: false
        }
    }]
}, { timestamps: true });

module.exports = mongoose.model('Expense', ExpenseSchema);