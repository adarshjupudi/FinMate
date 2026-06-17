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
const Expense = require('./models/expense');
const userRoutes = require('./routes/users');
const { isLoggedIn } = require('./middleware/index');

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

const sessionConfig = {
    secret: 'thisshouldbeabettersecret!',
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

// --- PASSPORT AUTHENTICATION ---
app.use(passport.initialize());
app.use(passport.session());
passport.use(new LocalStrategy(User.authenticate()));

passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());

// --- GLOBAL VARIABLES MIDDLEWARE ---
app.use((req, res, next) => {
    res.locals.currentUser = req.user;
    res.locals.success = req.flash('success');
    res.locals.error = req.flash('error');
    next();
});

// --- ROUTE DECORATORS ---
app.use('/', userRoutes);

// Core Dashboard Feed Aggregation Endpoint Handler
app.get('/', async (req, res) => {
    if (req.isAuthenticated()) {
        try {
            const expenses = await Expense.find({ paidBy: req.user._id }).sort({ createdAt: -1 });
            return res.render('dashboard/index', { expenses });
        } catch (err) {
            req.flash('error', 'Unable to retrieve ledger logs.');
            return res.render('dashboard/index', { expenses: [] });
        }
    }
    res.render('home');
});

// Express POST pipeline to process a newly saved manual expense ledger tracking log item
app.post('/expenses', isLoggedIn, async (req, res) => {
    try {
        const { description, amount, category } = req.body;
        const newExpense = new Expense({
            description,
            amount: Number(amount),
            category,
            paidBy: req.user._id,
            splitType: 'None'
        });
        await newExpense.save();
        
        const user = await User.findById(req.user._id);
        user.allowance = Math.max(user.allowance - Number(amount), 0);
        await user.save();
        
        req.flash('success', 'Outlay successfully recorded to campus transaction ledger.');
        res.redirect('/');
    } catch (err) {
        req.flash('error', 'Failed to store expense item.');
        res.redirect('/');
    }
});

// --- ERROR HANDLING PROVISIONS ---
app.all('*', (req, res, next) => {
    res.status(404).send('Page Not Found');
});

app.use((err, req, res, next) => {
    const { statusCode = 500 } = err;
    if (!err.message) err.message = 'Oh No, Something Went Wrong!';
    res.status(statusCode).send(err.message);
});

// --- START APP SERVER INSTANCE ---
const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Serving on port ${port}`);
});