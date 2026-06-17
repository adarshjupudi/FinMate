if (process.env.NODE_ENV !== "production") 
{
    require('dotenv').config();
}

const express = require('express');
const app = express();
const mongoose = require('mongoose');
const path = require('path');
const engine = require('ejs-mate');
const session = require('express-session');
const flash = require('connect-flash');
const passport = require('passport');
const LocalStrategy = require('passport-local');
const User = require('./models/user');
const userRoutes = require('./routes/users');

// --- DATABASE CONNECTION ---
const dbUrl = process.env.DB_URL || 'mongodb://localhost:27017/finmate';
mongoose.connect(dbUrl, {
    useNewUrlParser: true,
    useCreateIndex: true,
    useUnifiedTopology: true,
    useFindAndModify: false
});

const db = mongoose.connection;
db.on("error", console.error.bind(console, "connection error:"));
db.once("open", () => 
{
    console.log("Database connected successfully");
});

// --- APP CONFIGURATION ---
app.engine('ejs', engine);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// --- SESSION & FLASH ---
const sessionConfig = {
    secret: process.env.SECRET || 'thisshouldbeabettersecret',
    resave: false,
    saveUninitialized: true,
    cookie: {
        httpOnly: true,
        expires: Date.now() + 1000 * 60 * 60 * 24 * 7,
        maxAge: 1000 * 60 * 60 * 24 * 7
    }
};
app.use(session(sessionConfig));
app.use(flash());

// --- PASSPORT (AUTHENTICATION SETUP) ---
app.use(passport.initialize());
app.use(passport.session());
passport.use(new LocalStrategy(User.authenticate()));
passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());

// --- GLOBAL VARIABLES MIDDLEWARE ---
app.use((req, res, next) => 
{
    res.locals.currentUser = req.user;
    res.locals.success = req.flash('success');
    res.locals.error = req.flash('error');
    next();
});

// --- MOUNT ROUTERS ---
app.use('/', userRoutes);

// --- BASIC TEST ROUTE ---
app.get('/', (req, res) => 
{
    res.send('FinMate Server is Live with Auth Mounted!');
});

// --- SERVER START ---
const port = process.env.PORT || 3000;
app.listen(port, () => 
{
    console.log(`Serving on port ${port}`);
});