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
const Notification = require('./models/notification');
const Lobby = require('./models/lobby'); // INJECTED LOBBY MODEL
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
db.once("open", () => { console.log("Database connected successfully"); });

// --- APP CONFIGURATION ---
app.engine('ejs', engine);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
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

// Core Dashboard Feed Aggregator
app.get('/', isLoggedIn, async (req, res) => {
    try {
        const populatedUser = await User.findById(req.user._id).populate('friends', 'username email');
        const expenses = await Expense.find({ paidBy: req.user._id }).sort({ createdAt: -1 });
        
        const pendingDebts = await Notification.find({ 
            recipient: req.user._id, 
            type: 'DEBT_OWED',
            isRead: false 
        }).populate('sender', 'username').sort({ createdAt: -1 });

        // FETCH ACTIVE LOBBIES FOR MODULE 4
        const activeLobbies = await Lobby.find({ status: 'Open' }).populate('host', 'username');

        const categoryTotals = { Canteen: 0, Academics: 0, Travel: 0, 'Junk Food': 0, Other: 0 };
        let totalSpent = 0;
        
        expenses.forEach(exp => {
            if (exp.splitType !== 'Settlement') {
                const cat = categoryTotals.hasOwnProperty(exp.category) ? exp.category : 'Other';
                categoryTotals[cat] += exp.amount;
                totalSpent += exp.amount;
            }
        });

        const analyticalExpenseCount = expenses.filter(e => e.splitType !== 'Settlement').length;
        const avgExpense = analyticalExpenseCount > 0 ? Math.round(totalSpent / analyticalExpenseCount) : 0;

        let totalMonthlySubCost = 0;
        let activeGhostsCount = 0;
        if (populatedUser.subscriptions) {
            populatedUser.subscriptions.forEach(sub => {
                totalMonthlySubCost += (sub.billingCycle === 'Yearly' ? sub.cost / 12 : sub.cost);
                if (sub.isGhost) activeGhostsCount++;
            });
        }

        return res.render('dashboard/index', { 
            expenses, 
            populatedUser, 
            pendingDebts,
            activeLobbies,
            analytics: { categoryTotals, totalSpent, avgExpense },
            subStats: { totalMonthlySubCost: Math.round(totalMonthlySubCost), activeGhostsCount }
        });
    } catch (err) {
        req.flash('error', `Unable to retrieve ledger logs: ${err.message}`);
        return res.render('dashboard/index', { expenses: [], populatedUser: req.user, pendingDebts: [], activeLobbies: [], analytics: null, subStats: null });
    }
});

app.post('/expenses', isLoggedIn, async (req, res) => {
    try {
        const { description, amount, category, splitType, selectedFriends, customAmounts } = req.body;
        const numericAmount = Number(amount);
        const user = await User.findById(req.user._id);

        if (user.allowance < numericAmount) {
            req.flash('error', `Insufficient funds! Available balance is only ₹${user.allowance}.`);
            return res.redirect('/');
        }

        let participantsArray = [];

        if (selectedFriends) {
            const friendsList = Array.isArray(selectedFriends) ? selectedFriends : [selectedFriends];
            
            if (splitType === 'Equi-Split') {
                const totalSharers = friendsList.length + 1;
                const splitShare = Math.round((numericAmount / totalSharers) * 100) / 100;

                for (let friendId of friendsList) {
                    participantsArray.push({ user: friendId, owedAmount: splitShare, isSettled: false });
                    
                    const debtAlert = new Notification({
                        recipient: friendId,
                        sender: req.user._id,
                        type: 'DEBT_OWED',
                        message: `${req.user.username} split a bill. You owe ₹${splitShare} for "${description}".`,
                        linkUrl: '#'
                    });
                    await debtAlert.save();
                }
            } else if (splitType === 'Custom Split' && customAmounts) {
                let verifiedSum = 0;
                for (let friendId of friendsList) {
                    const friendShare = Number(customAmounts[friendId]) || 0;
                    verifiedSum += friendShare;
                    if (friendShare > 0) {
                        participantsArray.push({ user: friendId, owedAmount: friendShare, isSettled: false });
                        const debtAlert = new Notification({
                            recipient: friendId,
                            sender: req.user._id,
                            type: 'DEBT_OWED',
                            message: `${req.user.username} requested money. You owe ₹${friendShare} for "${description}".`,
                            linkUrl: '#'
                        });
                        await debtAlert.save();
                    }
                }
                if (verifiedSum > numericAmount) {
                    req.flash('error', `Custom split sums (₹${verifiedSum}) cannot exceed total bill (₹${numericAmount}).`);
                    return res.redirect('/');
                }
            }
        }

        const newExpense = new Expense({ description, amount: numericAmount, category, paidBy: req.user._id, splitType: selectedFriends ? splitType : 'None', participants: participantsArray });
        await newExpense.save();
        user.allowance = Math.max(user.allowance - numericAmount, 0);
        await user.save();
        req.flash('success', selectedFriends ? 'Group split bills dispatched successfully.' : 'Personal outlay logged.');
        res.redirect('/');
    } catch (err) {
        req.flash('error', `Failed to store expense item: ${err.message}`);
        res.redirect('/');
    }
});

app.post('/debts/:notifyId/accept', isLoggedIn, async (req, res) => {
    try {
        const notification = await Notification.findById(req.params.notifyId);
        if (!notification || notification.recipient.toString() !== req.user._id.toString()) {
            req.flash('error', 'Debt record not found.'); return res.redirect('/');
        }
        const parsedMatch = notification.message.match(/₹([\d.]+)/);
        const debtValue = parsedMatch ? Number(parsedMatch[1]) : 0;
        const user = await User.findById(req.user._id);
        if (user.allowance < debtValue) {
            req.flash('error', `Cannot accept request. You need ₹${debtValue}. Top up funds first.`); return res.redirect('/');
        }
        user.allowance -= debtValue; await user.save();
        const senderUser = await User.findById(notification.sender);
        const paymentLog = new Expense({ description: `Settled split share to ${senderUser ? senderUser.username : 'friend'}`, amount: debtValue, category: 'Other', paidBy: req.user._id, splitType: 'None' });
        await paymentLog.save();
        if (senderUser) {
            senderUser.allowance += debtValue; await senderUser.save();
            const creditLog = new Expense({ description: `Received settlement from ${req.user.username}`, amount: debtValue, category: 'Other', paidBy: notification.sender, splitType: 'Settlement' });
            await creditLog.save();
        }
        notification.isRead = true; await notification.save();
        const settlementAlert = new Notification({ recipient: notification.sender, sender: req.user._id, type: 'PAYMENT_MARKED', message: `${req.user.username} approved your split request and paid ₹${debtValue} instantly.` });
        await settlementAlert.save();
        req.flash('success', `Request accepted. ₹${debtValue} transferred safely.`);
        res.redirect('/');
    } catch (err) { req.flash('error', 'Processing settlement failed.'); res.redirect('/'); }
});

app.post('/debts/:notifyId/decline', isLoggedIn, async (req, res) => {
    try {
        const notification = await Notification.findById(req.params.notifyId);
        if (notification && notification.recipient.toString() === req.user._id.toString()) {
            notification.isRead = true; await notification.save();
            const declineAlert = new Notification({ recipient: notification.sender, sender: req.user._id, type: 'DEBT_OWED', message: `${req.user.username} declined your bill splitting request.` });
            await declineAlert.save();
        }
        req.flash('success', 'Split request declined.'); res.redirect('/');
    } catch (e) { res.redirect('/'); }
});

app.post('/expenses/:id/delete', isLoggedIn, async (req, res) => {
    try {
        const expense = await Expense.findById(req.params.id);
        if (!expense || expense.paidBy.toString() !== req.user._id.toString()) return res.redirect('/');
        const user = await User.findById(req.user._id);
        if (expense.splitType === 'Settlement') user.allowance = Math.max(0, user.allowance - expense.amount);
        else user.allowance += expense.amount;
        await user.save();
        await Expense.findByIdAndDelete(req.params.id);
        req.flash('success', 'Ledger record removed and balance adjusted.'); res.redirect('/');
    } catch (err) { res.redirect('/'); }
});

app.post('/add-funds', isLoggedIn, async (req, res) => {
    try {
        const { fundingAmount } = req.body;
        const user = await User.findById(req.user._id);
        user.allowance += Number(fundingAmount);
        await user.save();
        req.flash('success', 'Allowance updated!'); res.redirect('/');
    } catch (err) { res.redirect('/'); }
});

app.post('/reset-funds', isLoggedIn, async (req, res) => {
    try {
        await User.findByIdAndUpdate(req.user._id, { allowance: 0 });
        req.flash('success', 'Campus balance reset to zero.'); res.redirect('/');
    } catch (err) { res.redirect('/'); }
});

app.get('/goals', isLoggedIn, async (req, res) => {
    try { const user = await User.findById(req.user._id); res.render('goals/index', { goals: user.goals }); } catch (err) { res.redirect('/'); }
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

app.get('/subscriptions', isLoggedIn, async (req, res) => {
    try { const user = await User.findById(req.user._id); res.render('subscriptions/index', { subscriptions: user.subscriptions }); } catch (err) { res.redirect('/'); }
});

app.post('/subscriptions', isLoggedIn, async (req, res) => {
    try {
        const { name, cost, billingCycle, lastUsed, cancelUrl } = req.body;
        const isGhost = (lastUsed === '1+ Month Ago');
        const user = await User.findById(req.user._id);
        user.subscriptions.push({ name, cost: Number(cost), billingCycle, lastUsed, cancelUrl: cancelUrl || '#', isGhost });
        await user.save(); req.flash('success', 'Subscription logged. Ghost scanning active.'); res.redirect('/subscriptions');
    } catch (err) { res.redirect('/subscriptions'); }
});

app.post('/subscriptions/:subId/status', isLoggedIn, async (req, res) => {
    try {
        const { lastUsed } = req.body; const user = await User.findById(req.user._id); const sub = user.subscriptions.id(req.params.subId);
        if (sub) { sub.lastUsed = lastUsed; sub.isGhost = (lastUsed === '1+ Month Ago'); await user.save(); req.flash('success', 'Activity status updated.'); }
        res.redirect('/subscriptions');
    } catch (err) { res.redirect('/subscriptions'); }
});

app.post('/subscriptions/:subId/delete', isLoggedIn, async (req, res) => {
    try { const user = await User.findById(req.user._id); user.subscriptions.pull(req.params.subId); await user.save(); res.redirect('/subscriptions'); } catch (err) { res.redirect('/subscriptions'); }
});

// --- NEW: POOL CART LOBBY ROUTE IMPLEMENTATIONS ---
app.get('/lobbies', isLoggedIn, async (req, res) => {
    try {
        const lobbies = await Lobby.find({ status: 'Open' }).populate('host', 'username').populate('members.user', 'username');
        res.render('lobbies/index', { lobbies });
    } catch (err) {
        req.flash('error', `Failed to load pool cart registries: ${err.message}`);
        res.redirect('/');
    }
});

app.post('/lobbies', isLoggedIn, async (req, res) => {
    try {
        const { storeName, targetAmount, initialItemCost, initialItemDesc } = req.body;
        const numericCost = Number(initialItemCost);

        const lobby = new Lobby({
            host: req.user._id,
            storeName,
            targetAmount: Number(targetAmount),
            currentAmount: numericCost,
            members: [{ user: req.user._id, itemsDescription: initialItemDesc, itemCost: numericCost }]
        });
        await lobby.save();
        req.flash('success', 'Delivery pool cart lobby established.');
        res.redirect('/lobbies');
    } catch (err) {
        req.flash('error', `Lobby creation rejected: ${err.message}`);
        res.redirect('/lobbies');
    }
});

app.post('/lobbies/:id/join', isLoggedIn, async (req, res) => {
    try {
        const { itemCost, itemsDescription } = req.body;
        const numericCost = Number(itemCost);

        const lobby = await Lobby.findById(req.params.id);
        lobby.members.push({ user: req.user._id, itemsDescription, itemCost: numericCost });
        lobby.currentAmount += numericCost;
        await lobby.save();

        req.flash('success', 'Successfully merged items into the cart lobby!');
        res.redirect('/lobbies');
    } catch (err) {
        req.flash('error', 'Failed to join delivery pool.');
        res.redirect('/lobbies');
    }
});

app.post('/lobbies/:id/close', isLoggedIn, async (req, res) => {
    try {
        const lobby = await Lobby.findById(req.params.id);
        if (lobby.host.toString() !== req.user._id.toString()) {
            req.flash('error', 'Unauthorized access.');
            return res.redirect('/lobbies');
        }
        lobby.status = 'Closed';
        await lobby.save();
        req.flash('success', 'Lobby successfully closed.');
        res.redirect('/lobbies');
    } catch (err) {
        res.redirect('/lobbies');
    }
});

app.all('*', (req, res) => { res.status(404).send('Page Not Found'); });
const port = process.env.PORT || 3000;
app.listen(port, () => { console.log(`Serving on port ${port}`); });