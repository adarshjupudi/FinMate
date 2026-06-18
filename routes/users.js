const express = require('express');
const router = express.Router();
const passport = require('passport');
const mongoose = require('mongoose');
const User = require('../models/user');
const Notification = require('../models/notification');

// --- RESPONSIVE VALIDATION API ENDPOINTS ---
router.get('/check-username', async (req, res) => {
    try {
        const { username } = req.query;
        const user = await User.findOne({ username: username.trim() });
        return res.json({ exists: !!user });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
});

router.get('/check-email', async (req, res) => {
    try {
        const { email } = req.query;
        const user = await User.findOne({ email: email.trim() });
        return res.json({ exists: !!user });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
});

// --- PEER SEARCH API ---
router.get('/search', async (req, res) => {
    if (!req.isAuthenticated()) {
        return res.status(401).json({ error: 'Unauthorized access' });
    }
    try {
        const { username } = req.query;
        if (!username) return res.json([]);
        
        const users = await User.find({ 
            username: { $regex: username, $options: 'i' },
            _id: { $ne: req.user._id } 
        }).limit(5);
        res.json(users);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// --- NOTIFICATION CLEAR ENGINE HANDLERS ---
router.post('/notifications/:id/read', async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ success: false });
    try {
        if (mongoose.Types.ObjectId.isValid(req.params.id)) {
            await Notification.findByIdAndUpdate(req.params.id, { isRead: true });
            return res.json({ success: true });
        }
        res.status(400).json({ success: false, error: 'Invalid ID' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// NEW: CLEAR ALL NOTIFICATIONS
router.post('/notifications/clear-all', async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ success: false });
    try {
        await Notification.updateMany({ recipient: req.user._id, isRead: false }, { isRead: true });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// --- TWO-WAY FRIEND REQUEST SYSTEM ---
router.post('/send-friend-request', async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ success: false, error: 'Unauthorized' });
    try {
        const { friendId } = req.body;
        if (!friendId || !mongoose.Types.ObjectId.isValid(friendId)) {
            return res.json({ success: false, error: 'Invalid or missing user identifier.' });
        }
        const currentUser = await User.findById(req.user._id);
        
        // FIX: Fallback to empty array if 'friends' doesn't exist yet on new accounts
        const friendsList = currentUser.friends || [];
        
        if (friendsList.includes(friendId)) {
            return res.json({ success: false, error: 'User is already in your circle.' });
        }
        const existingRequest = await Notification.findOne({
            sender: req.user._id,
            recipient: friendId,
            type: 'FRIEND_REQUEST',
            isRead: false
        });
        if (existingRequest) {
            return res.json({ success: false, error: 'Request already pending.' });
        }
        const newNotification = new Notification({
            sender: req.user._id,
            recipient: friendId,
            type: 'FRIEND_REQUEST',
            message: `${req.user.username} sent you a friend request.`,
            linkUrl: '#'
        });
        await newNotification.save();
        res.json({ success: true, message: 'Request sent!' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

router.post('/accept-friend/:notifyId', async (req, res) => {
    if (!req.isAuthenticated()) return res.redirect('/login');
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.notifyId)) {
            req.flash('error', 'Invalid reference ID.');
            return res.redirect('/dashboard');
        }
        const notification = await Notification.findById(req.params.notifyId);
        if (!notification || notification.recipient.toString() !== req.user._id.toString()) {
            req.flash('error', 'Invalid request.');
            return res.redirect('/dashboard');
        }
        await User.findByIdAndUpdate(req.user._id, { $addToSet: { friends: notification.sender } });
        await User.findByIdAndUpdate(notification.sender, { $addToSet: { friends: req.user._id } });
        notification.isRead = true;
        await notification.save();

        const confirmNotification = new Notification({
            sender: req.user._id,
            recipient: notification.sender,
            type: 'REQUEST_ACCEPTED',
            message: `${req.user.username} accepted your friend request!`
        });
        await confirmNotification.save();
        req.flash('success', 'Friend added to your circle!');
        res.redirect('/dashboard');
    } catch (e) {
        req.flash('error', 'Something went wrong.');
        res.redirect('/dashboard');
    }
});

router.post('/decline-friend/:notifyId', async (req, res) => {
    if (!req.isAuthenticated()) return res.redirect('/login');
    try {
        if (mongoose.Types.ObjectId.isValid(req.params.notifyId)) {
            await Notification.findByIdAndUpdate(req.params.notifyId, { isRead: true });
        }
        res.redirect('/dashboard');
    } catch (e) {
        res.redirect('/dashboard');
    }
});

router.post('/remove-friend', async (req, res) => {
    if (!req.isAuthenticated()) return res.redirect('/login');
    try {
        const { friendId } = req.body;
        if (!friendId || !mongoose.Types.ObjectId.isValid(friendId)) {
            req.flash('error', 'No valid friend identifier provided.');
            return res.redirect('/dashboard');
        }
        await User.findByIdAndUpdate(req.user._id, { $pull: { friends: friendId } });
        await User.findByIdAndUpdate(friendId, { $pull: { friends: req.user._id } });
        req.flash('success', 'User removed from your friend circle.');
        res.redirect('/dashboard');
    } catch (e) {
        req.flash('error', 'Failed to disconnect user from your circle.');
        res.redirect('/dashboard');
    }
});

// --- AUTHENTICATION ROUTES ---
router.get('/register', (req, res) => {
    if (req.isAuthenticated()) return res.redirect('/dashboard');
    res.render('users/register'); 
});

router.post('/register', async (req, res, next) => {
    try {
        const { username, email, allowance, password } = req.body;
        const existingUser = await User.findOne({ username: username });
        if (existingUser) {
            req.flash('error', 'Username is already registered.');
            return res.redirect('/register');
        }
        const existingEmail = await User.findOne({ email: email });
        if (existingEmail) {
            req.flash('error', 'Email address already exists.');
            return res.redirect('/register');
        }
        const user = new User({ email, username, allowance: allowance ? Number(allowance) : 0 });
        const registeredUser = await User.register(user, password);
        req.login(registeredUser, err => {
            if (err) return next(err);
            req.flash('success', 'Welcome to FinMate!');
            res.redirect('/dashboard');
        });
    } catch (e) {
        req.flash('error', e.message);
        res.redirect('/register');
    }
});

router.get('/login', (req, res) => {
    if (req.isAuthenticated()) return res.redirect('/dashboard');
    res.render('users/login');
});

router.post('/login', passport.authenticate('local', {
    failureFlash: true,
    failureRedirect: '/login'
}), (req, res) => {
    req.flash('success', 'Welcome back!');
    res.redirect('/dashboard');
});

router.get('/logout', (req, res) => {
    req.logout(); 
    req.flash('success', 'Logged out successfully.');
    res.redirect('/');
});

module.exports = router;