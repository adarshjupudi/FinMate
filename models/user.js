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
    }]
}, { timestamps: true });

UserSchema.plugin(passportLocalMongoose);

module.exports = mongoose.model('User', UserSchema);