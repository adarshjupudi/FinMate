const express = require('express');
const router = express.Router();
const passport = require('passport');
const User = require('../models/user');

// --- RESPONSIVE VALIDATION API ENDPOINTS ---

// Check if username already exists instantly
router.get('/check-username', async (req, res) => {
    try {
        const { username } = req.query;
        const user = await User.findOne({ username: username.trim() });
        return res.json({ exists: !!user });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
});

// Check if email already exists instantly
router.get('/check-email', async (req, res) => {
    try {
        const { email } = req.query;
        const user = await User.findOne({ email: email.trim() });
        return res.json({ exists: !!user });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
});

// --- REGISTER USER ROUTES ---
router.get('/register', (req, res) => {
    if (req.isAuthenticated()) {
        return res.redirect('/');
    }
    res.render('users/register'); 
});

router.post('/register', async (req, res, next) => {
    try {
        const { username, email, allowance, password } = req.body;
        
        const existingUser = await User.findOne({ username: username });
        if (existingUser) {
            req.flash('error', 'A user with the given username is already registered.');
            return res.redirect('/register');
        }

        const existingEmail = await User.findOne({ email: email });
        if (existingEmail) {
            req.flash('error', 'A user with that email address already exists.');
            return res.redirect('/register');
        }
        
        const user = new User({ 
            email: email, 
            username: username, 
            allowance: allowance ? Number(allowance) : 0 
        });
        
        const registeredUser = await User.register(user, password);
        
        req.login(registeredUser, err => {
            if (err) return next(err);
            req.flash('success', 'Welcome to FinMate! Let\'s manage those campus expenses.');
            res.redirect('/');
        });
    } catch (e) {
        req.flash('error', e.message);
        res.redirect('/register');
    }
});

// --- LOGIN ROUTES ---
router.get('/login', (req, res) => {
    if (req.isAuthenticated()) {
        return res.redirect('/');
    }
    res.render('users/login');
});

router.post('/login', passport.authenticate('local', {
    failureFlash: true,
    failureRedirect: '/login'
}), (req, res) => {
    req.flash('success', 'Welcome back to FinMate!');
    res.redirect('/');
});

// --- LOGOUT ROUTE ---
router.get('/logout', (req, res) => {
    req.logout(); 
    req.flash('success', 'Logged out successfully. See you around!');
    res.redirect('/');
});

module.exports = router;