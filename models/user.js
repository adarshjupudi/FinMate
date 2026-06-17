const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const passportLocalMongoose = require('passport-local-mongoose');

const UserSchema = new Schema({
    email: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    allowance: {
        type: Number,
        default: 0,
        min: 0
    },
    subscriptions: [{
        name: String,
        cost: Number,
        isGhost: { type: Boolean, default: false }
    }],
    friends: [{
        type: Schema.Types.ObjectId,
        ref: 'User'
    }]
}, { timestamps: true });

UserSchema.plugin(passportLocalMongoose);

module.exports = mongoose.model('User', UserSchema);