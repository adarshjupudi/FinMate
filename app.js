if (process.env.NODE_ENV !== "production") {
    require('dotenv').config();
}

const express = require('express');
const app = express();
const mongoose = require('mongoose');
const path = require('path');
const engine = require('ejs-mate');
const session = require('express-session');
const MongoStore = require('connect-mongo')(session); // ADDED: MongoStore for serverless sessions
const flash = require('connect-flash');
const passport = require('passport');
const LocalStrategy = require('passport-local');

const User = require('./models/user');
const Expense = require('./models/expense');
const Notification = require('./models/notification');
const Lobby = require('./models/lobby');
const Transit = require('./models/transit'); 
const userRoutes = require('./routes/users');
const { isLoggedIn } = require('./middleware/index');

const dbUrl = process.env.DB_URL || 'mongodb://localhost:27017/finmate';
mongoose.connect(dbUrl, {
    useNewUrlParser: true,
    useCreateIndex: true,
    useUnifiedTopology: true,
    useFindAndModify: false
});

const db = mongoose.connection;
db.on("error", console.error.bind(console, "connection error:"));
db.once("open", () => { console.log("Database connected successfully"); });

app.engine('ejs', engine);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ADDED: Configuration for the database session store
const store = new MongoStore({
    url: dbUrl,
    secret: process.env.SECRET || 'thisshouldbeabettersecret!',
    touchAfter: 24 * 60 * 60 // Unnecessary saves are avoided, updates only once every 24 hours unless data changes
});

store.on("error", function(e) {
    console.log("SESSION STORE ERROR", e);
});

const sessionConfig = {
    store: store, // ADDED: Tells express-session to use MongoDB instead of server memory
    secret: process.env.SECRET || 'thisshouldbeabettersecret!',
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

app.use(passport.initialize());
app.use(passport.session());
passport.use(new LocalStrategy(User.authenticate()));
passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());

app.use(async (req, res, next) => {
    res.locals.currentUser = req.user;
    res.locals.success = req.flash('success');
    res.locals.error = req.flash('error');
    if (req.user) {
        try { 
            res.locals.unreadNotifications = await Notification.find({ recipient: req.user._id, isRead: false }).sort({ createdAt: -1 });
        } catch (err) { res.locals.unreadNotifications = []; }
    } else { res.locals.unreadNotifications = []; }
    next();
});

app.use('/', userRoutes);

// --- NEW HOME ROUTE ---
app.get('/', (req, res) => {
    if (req.isAuthenticated()) {
        return res.redirect('/dashboard');
    }
    res.render('home');
});

// --- CORE DASHBOARD AGGREGATOR ---
app.get('/dashboard', isLoggedIn, async (req, res) => {
    try {
        const populatedUser = await User.findById(req.user._id).populate('friends', 'username email');
        const expenses = await Expense.find({ paidBy: req.user._id }).sort({ createdAt: -1 });
        
        const pendingDebts = await Notification.find({ recipient: req.user._id, type: 'DEBT_OWED', isRead: false }).populate('sender', 'username').sort({ createdAt: -1 });
        const poolInvites = await Notification.find({ recipient: req.user._id, type: { $in: ['POOL_OPENED', 'TRANSIT_OPENED'] }, isRead: false }).populate('sender', 'username').sort({ createdAt: -1 });

        // DYNAMIC TTL EXPIRATION ENGINE
        const allOpenLobbies = await Lobby.find({ status: 'Open' }).populate('host', 'username');
        for (let l of allOpenLobbies) {
            if (Date.now() > new Date(l.createdAt).getTime() + (l.duration * 60000)) {
                l.status = 'Closed'; await l.save();
            }
        }
        
        const allOpenTransits = await Transit.find({ status: 'Open' }).populate('host', 'username');
        for (let t of allOpenTransits) {
            if (Date.now() > new Date(t.createdAt).getTime() + (t.duration * 60000)) {
                t.status = 'Closed';
                await t.save();
            }
        }

        const activeLobbies = await Lobby.find({ status: 'Open' }).populate('host', 'username');
        const activeTransits = await Transit.find({ status: 'Open' }).populate('host', 'username');

        const categoryTotals = { Canteen: 0, Academics: 0, Travel: 0, 'Junk Food': 0, Other: 0 };
        let totalSpent = 0;
        expenses.forEach(exp => {
            if (exp.splitType !== 'Settlement') {
                const cat = categoryTotals.hasOwnProperty(exp.category) ? exp.category : 'Other';
                categoryTotals[cat] += exp.amount; totalSpent += exp.amount;
            }
        });

        const analyticalExpenseCount = expenses.filter(e => e.splitType !== 'Settlement').length;
        const avgExpense = analyticalExpenseCount > 0 ? Math.round(totalSpent / analyticalExpenseCount) : 0;

        return res.render('dashboard/index', { 
            expenses, populatedUser, pendingDebts, poolInvites, activeLobbies, activeTransits, analytics: { categoryTotals, totalSpent, avgExpense }
        });
    } catch (err) {
        req.flash('error', `Dashboard Error: ${err.message}`);
        return res.redirect('/login');
    }
});

// --- EXPENSE & SPLIT ROUTES ---
app.post('/expenses', isLoggedIn, async (req, res) => {
    try {
        const { description, amount, category, splitType, selectedFriends, customAmounts } = req.body;
        const numericAmount = Number(amount);
        const user = await User.findById(req.user._id);

        if (user.allowance < numericAmount) {
            req.flash('error', `Insufficient funds! Available balance is only ₹${user.allowance}.`); return res.redirect('/dashboard');
        }

        let participantsArray = [];
        if (selectedFriends) {
            const friendsList = Array.isArray(selectedFriends) ? selectedFriends : [selectedFriends];
            if (splitType === 'Equi-Split') {
                const splitShare = Math.round((numericAmount / (friendsList.length + 1)) * 100) / 100;
                for (let friendId of friendsList) {
                    participantsArray.push({ user: friendId, owedAmount: splitShare, isSettled: false });
                    await new Notification({ recipient: friendId, sender: req.user._id, type: 'DEBT_OWED', message: `${req.user.username} split a bill. You owe ₹${splitShare} for "${description}".`, linkUrl: '#' }).save();
                }
            } else if (splitType === 'Custom Split' && customAmounts) {
                for (let friendId of friendsList) {
                    const friendShare = Number(customAmounts[friendId]) || 0;
                    if (friendShare > 0) {
                        participantsArray.push({ user: friendId, owedAmount: friendShare, isSettled: false });
                        await new Notification({ recipient: friendId, sender: req.user._id, type: 'DEBT_OWED', message: `${req.user.username} requested ₹${friendShare} for "${description}".`, linkUrl: '#' }).save();
                    }
                }
            }
        }
        await new Expense({ description, amount: numericAmount, category, paidBy: req.user._id, splitType: selectedFriends ? splitType : 'None', participants: participantsArray }).save();
        user.allowance = Math.max(user.allowance - numericAmount, 0); await user.save();
        req.flash('success', 'Outlay logged.'); res.redirect('/dashboard');
    } catch (err) { req.flash('error', err.message); res.redirect('/dashboard'); }
});

app.post('/debts/:notifyId/accept', isLoggedIn, async (req, res) => {
    try {
        const notification = await Notification.findById(req.params.notifyId);
        const parsedMatch = notification.message.match(/₹([\d.]+)/);
        const debtValue = parsedMatch ? Number(parsedMatch[1]) : 0;
        const user = await User.findById(req.user._id);
        
        if (user.allowance < debtValue) { req.flash('error', `Insufficient funds to accept.`); return res.redirect('/dashboard'); }
        user.allowance -= debtValue; 
        await user.save();
        const senderUser = await User.findById(notification.sender);
        
        await new Expense({ description: `Settled split share`, amount: debtValue, category: 'Other', paidBy: req.user._id, splitType: 'None' }).save();
        if (senderUser) {
            senderUser.allowance += debtValue; await senderUser.save();
            await new Expense({ description: `Received settlement from ${req.user.username}`, amount: debtValue, category: 'Other', paidBy: notification.sender, splitType: 'Settlement' }).save();
        }
        notification.isRead = true; await notification.save();
        await new Notification({ recipient: notification.sender, sender: req.user._id, type: 'PAYMENT_MARKED', message: `${req.user.username} paid ₹${debtValue} instantly.` }).save();
        req.flash('success', `Request accepted. ₹${debtValue} transferred.`);
        res.redirect('/dashboard');
    } catch (err) { res.redirect('/dashboard'); }
});

app.post('/debts/:notifyId/decline', isLoggedIn, async (req, res) => {
    try {
        const notification = await Notification.findById(req.params.notifyId);
        notification.isRead = true; await notification.save();
        res.redirect('/dashboard');
    } catch (e) { res.redirect('/dashboard'); }
});

app.post('/notifications/:id/dismiss', isLoggedIn, async (req, res) => {
    try {
        await Notification.findByIdAndUpdate(req.params.id, { isRead: true });
        res.redirect('/dashboard');
    } catch (e) { res.redirect('/dashboard'); }
});

app.post('/expenses/:id/delete', isLoggedIn, async (req, res) => {
    try {
        const expense = await Expense.findById(req.params.id);
        const user = await User.findById(req.user._id);
        if (expense.splitType === 'Settlement') user.allowance = Math.max(0, user.allowance - expense.amount);
        else user.allowance += expense.amount;
        await user.save(); await Expense.findByIdAndDelete(req.params.id);
        req.flash('success', 'Record removed.'); res.redirect('/dashboard');
    } catch (err) { res.redirect('/dashboard'); }
});

app.post('/add-funds', isLoggedIn, async (req, res) => {
    try {
        const user = await User.findById(req.user._id); user.allowance += Number(req.body.fundingAmount); await user.save();
        req.flash('success', 'Allowance updated!'); res.redirect('/dashboard');
    } catch (err) { res.redirect('/dashboard'); }
});

app.post('/reset-funds', isLoggedIn, async (req, res) => {
    try { await User.findByIdAndUpdate(req.user._id, { allowance: 0 }); req.flash('success', 'Reset to zero.'); res.redirect('/dashboard'); } catch (err) { res.redirect('/dashboard'); }
});

app.get('/goals', isLoggedIn, async (req, res) => {
    try { const user = await User.findById(req.user._id); res.render('goals/index', { goals: user.goals }); } catch (err) { res.redirect('/dashboard'); }
});

app.post('/goals', isLoggedIn, async (req, res) => {
    try {
        const { title, targetAmount } = req.body;
        const user = await User.findById(req.user._id);
        user.goals.push({ title, targetAmount: Number(targetAmount) });
        await user.save();
        res.redirect('/goals');
    } catch (err) { res.redirect('/goals'); }
});

app.post('/goals/:goalId/toggle', isLoggedIn, async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        const goal = user.goals.id(req.params.goalId);
        if (goal) { goal.isCompleted = !goal.isCompleted; await user.save(); }
        res.redirect('/goals');
    } catch (err) { res.redirect('/goals'); }
});

app.post('/goals/:goalId/delete', isLoggedIn, async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        user.goals.pull(req.params.goalId); await user.save();
        res.redirect('/goals');
    } catch (err) { res.redirect('/goals'); }
});

// --- MODULE 4: FOOD CART LOBBIES ---
app.get('/lobbies', isLoggedIn, async (req, res) => {
    try {
        const lobbies = await Lobby.find({ status: 'Open' }).populate('host', 'username').populate('members.user', 'username');
        res.render('lobbies/index', { lobbies });
    } catch (err) { res.redirect('/dashboard'); }
});

app.post('/lobbies', isLoggedIn, async (req, res) => {
    try {
        const { storeName, targetAmount, initialItemCost, initialItemDesc, duration } = req.body;
        const hostUser = await User.findById(req.user._id).populate('friends');
        
        const lobby = new Lobby({
            host: req.user._id, storeName, targetAmount: Number(targetAmount), duration: Number(duration), currentAmount: Number(initialItemCost),
            members: [{ user: req.user._id, itemsDescription: initialItemDesc, itemCost: Number(initialItemCost) }]
        });
        await lobby.save();

        for (let friend of hostUser.friends) {
            await new Notification({
                recipient: friend._id, sender: req.user._id, type: 'POOL_OPENED', linkUrl: '/lobbies',
                message: `@${hostUser.username} is ordering from ${storeName}. Cart closes in ${duration} mins! Join now.`
            }).save();
        }
        req.flash('success', 'Delivery pool created. Circle notified!'); res.redirect('/lobbies');
    } catch (err) { res.redirect('/lobbies'); }
});

app.post('/lobbies/:id/join', isLoggedIn, async (req, res) => {
    try {
        const lobby = await Lobby.findById(req.params.id);
        if (Date.now() > new Date(lobby.createdAt).getTime() + (lobby.duration * 60000)) {
            lobby.status = 'Closed'; await lobby.save();
            req.flash('error', 'This pool has expired.'); return res.redirect('/lobbies');
        }
        lobby.members.push({ user: req.user._id, itemsDescription: req.body.itemsDescription, itemCost: Number(req.body.itemCost) });
        lobby.currentAmount += Number(req.body.itemCost); await lobby.save();
        req.flash('success', 'Merged items into cart!'); res.redirect('/lobbies');
    } catch (err) { res.redirect('/lobbies'); }
});

app.post('/lobbies/:id/close', isLoggedIn, async (req, res) => {
    try {
        const lobby = await Lobby.findById(req.params.id);
        lobby.status = 'Closed'; await lobby.save();
        req.flash('success', 'Lobby closed.'); res.redirect('/lobbies');
    } catch (err) { res.redirect('/lobbies'); }
});

// --- MODULE 3: TRANSIT RADAR (CAB/AUTO) ---
app.get('/transit', isLoggedIn, async (req, res) => {
    try {
        const transits = await Transit.find({ status: 'Open' }).populate('host', 'username').populate('members.user', 'username');
        res.render('transit/index', { transits });
    } catch (err) { res.redirect('/dashboard'); }
});

app.post('/transit', isLoggedIn, async (req, res) => {
    try {
        const { destination, vehicleType, duration } = req.body;
        const targetCapacity = vehicleType === 'Auto' ? 3 : 4;
        const hostUser = await User.findById(req.user._id).populate('friends');
        
        const transit = new Transit({
            host: req.user._id, destination, vehicleType, targetCapacity, duration: Number(duration), currentCapacity: 1,
            members: [{ user: req.user._id, seats: 1 }]
        });
        await transit.save();

        for (let friend of hostUser.friends) {
            await new Notification({
                recipient: friend._id, sender: req.user._id, type: 'TRANSIT_OPENED', linkUrl: '/transit',
                message: `@${hostUser.username} booked a ${vehicleType} to ${destination}. Departing in ${duration} mins!`
            }).save();
        }
        req.flash('success', 'Ride radar activated. Circle notified!'); res.redirect('/transit');
    } catch (err) { res.redirect('/transit'); }
});

app.post('/transit/:id/join', isLoggedIn, async (req, res) => {
    try {
        const transit = await Transit.findById(req.params.id);
        if (Date.now() > new Date(transit.createdAt).getTime() + (transit.duration * 60000)) {
            transit.status = 'Closed'; await transit.save();
            req.flash('error', 'Ride has departed.'); return res.redirect('/transit');
        }
        if (transit.currentCapacity >= transit.targetCapacity) {
            req.flash('error', 'Ride is full!'); return res.redirect('/transit');
        }
        transit.members.push({ user: req.user._id, seats: 1 });
        transit.currentCapacity += 1; await transit.save();
        req.flash('success', 'Seat secured!'); res.redirect('/transit');
    } catch (err) { res.redirect('/transit'); }
});

app.post('/transit/:id/close', isLoggedIn, async (req, res) => {
    try {
        const transit = await Transit.findById(req.params.id);
        transit.status = 'Closed'; await transit.save();
        req.flash('success', 'Ride departed.'); res.redirect('/transit');
    } catch (err) { res.redirect('/transit'); }
});

app.all('*', (req, res) => { res.status(404).send('Page Not Found'); });

const port = process.env.PORT || 3000;
if (process.env.NODE_ENV !== 'production') {
    app.listen(port, () => {
        console.log(`Serving on port ${port}`);
    });
}

// CRITICAL FOR VERCEL DEPLOYMENT
module.exports = app;