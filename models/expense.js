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
        enum: ['Canteen', 'Academics', 'Travel', 'Junk Food', 'Other'],
        required: true
    },
    paidBy: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    splitType: {
        type: String,
        enum: ['None', 'Equi-Split', 'Custom'],
        default: 'None'
    },
    participants: [{
        user: {
            type: Schema.Types.ObjectId,
            ref: 'User'
        },
        share: Number
    }]
}, { timestamps: true });

module.exports = mongoose.model('Expense', ExpenseSchema);