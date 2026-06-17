const express = require('express');
const router = express.Router();
const User = require('../models/user');
const passport = require('passport');

// --- REGISTER FORM ROUTE ---
router.get('/register', (req, res) => {
    res.render('users/register');
});

// --- REGISTER POST ROUTE ---
router.post('/register', async (req, res, next) => {
    try {
        const { email, username, password, allowance } = req.body;
        const user = new User({ email, username, allowance });
        const registeredUser = await User.register(user, password);
        req.login(registeredUser, err => {
            if (err) return next(err);
            req.flash('success', 'Welcome to FinMate, your campus financial wingman!');
            res.redirect('/');
        });
    } catch (e) {
        req.flash('error', e.message);
        res.redirect('/register');
    }
});

// --- LOGIN FORM ROUTE ---
router.get('/login', (req, res) => {
    res.render('users/login');
});

// --- LOGIN POST ROUTE ---
router.post('/login', passport.authenticate('local', { 
    failureFlash: true, 
    failureRedirect: '/login' 
}), (req, res) => {
    req.flash('success', `Welcome back, ${req.user.username}!`);
    res.redirect('/');
});

// --- LOGOUT ROUTE ---
router.get('/logout', (req, res, next) => {
    req.logout(function(err) {
        if (err) { return next(err); }
        req.flash('success', 'Logged out successfully. See you around campus!');
        res.redirect('/');
    });
});

module.exports = router;