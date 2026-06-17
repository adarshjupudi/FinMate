const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const passportLocalMongoose = require('passport-local-mongoose');

const UserSchema = new Schema({
    email: {
        type: String,
        required: true,
        unique: true
    },
    allowance: {
        type: Number,
        default: 0,
        min: 0
    },
    friends: [{
        type: Schema.Types.ObjectId,
        ref: 'User'
    }],
    goals: [{
        title: { type: String, required: true },
        targetAmount: { type: Number, required: true, min: 1 },
        isCompleted: { type: Boolean, default: false }
    }],
    // EXPANDED GHOST TRACKER SCHEMA
    subscriptions: [{
        name: { type: String, required: true },
        cost: { type: Number, required: true, min: 0 },
        billingCycle: { 
            type: String, 
            enum: ['Monthly', 'Yearly'], 
            default: 'Monthly' 
        },
        lastUsed: { 
            type: String, 
            enum: ['Today', 'Last Week', '1+ Month Ago'], 
            default: 'Today' 
        },
        cancelUrl: { type: String, default: '' },
        isGhost: { type: Boolean, default: false }
    }]
}, { timestamps: true });

UserSchema.plugin(passportLocalMongoose);

module.exports = mongoose.model('User', UserSchema);