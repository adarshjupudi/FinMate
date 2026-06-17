const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const NotificationSchema = new Schema({
    recipient: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    sender: {
        type: Schema.Types.ObjectId,
        ref: 'User'
    },
    type: {
        type: String,
        required: true,
        enum: ['DEBT_OWED', 'PAYMENT_MARKED', 'POOL_OPENED', 'FRIEND_REQUEST', 'REQUEST_ACCEPTED']
    },
    message: {
        type: String,
        required: true
    },
    isRead: {
        type: Boolean,
        default: false
    },
    linkUrl: {
        type: String,
        default: '/'
    }
}, { timestamps: true });

module.exports = mongoose.model('Notification', NotificationSchema);