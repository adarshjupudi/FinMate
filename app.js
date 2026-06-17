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

        const categoryTotals = { Canteen: 0, Academics: 0, Travel: 0, 'Junk Food': 0, Other: 0 };
        let totalSpent = 0;
        
        expenses.forEach(exp => {
            if (exp.splitType === 'None') {
                const cat = categoryTotals.hasOwnProperty(exp.category) ? exp.category : 'Other';
                categoryTotals[cat] += exp.amount;
                totalSpent += exp.amount;
            }
        });

        const personalExpenseCount = expenses.filter(e => e.splitType === 'None').length;
        const avgExpense = personalExpenseCount > 0 ? Math.round(totalSpent / personalExpenseCount) : 0;

        return res.render('dashboard/index', { 
            expenses, 
            populatedUser, 
            pendingDebts,
            analytics: { categoryTotals, totalSpent, avgExpense }
        });
    } catch (err) {
        req.flash('error', `Unable to retrieve ledger logs: ${err.message}`);
        return res.render('dashboard/index', { expenses: [], populatedUser: req.user, pendingDebts: [], analytics: null });
    }
});

// Advanced Log Expense Flow supporting Equi-Split and Custom Split
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

                // Verify the total custom split amounts do not exceed the main bill
                if (verifiedSum > numericAmount) {
                    req.flash('error', `Custom split sums (₹${verifiedSum}) cannot exceed total bill (₹${numericAmount}).`);
                    return res.redirect('/');
                }
            }
        }

        const newExpense = new Expense({
            description,
            amount: numericAmount,
            category,
            paidBy: req.user._id,
            splitType: selectedFriends ? splitType : 'None',
            participants: participantsArray
        });
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

// ACCEPT DEBT HANDSHAKE WITH IMMEDIATE BALANCING RESTORATION
app.post('/debts/:notifyId/accept', isLoggedIn, async (req, res) => {
    try {
        const notification = await Notification.findById(req.params.notifyId);
        if (!notification || notification.recipient.toString() !== req.user._id.toString()) {
            req.flash('error', 'Debt record not found.');
            return res.redirect('/');
        }

        const parsedMatch = notification.message.match(/₹([\d.]+)/);
        const debtValue = parsedMatch ? Number(parsedMatch[1]) : 0;

        const user = await User.findById(req.user._id);
        if (user.allowance < debtValue) {
            req.flash('error', `Cannot accept request. You need ₹${debtValue} but your balance is only ₹${user.allowance}. Top up funds first.`);
            return res.redirect('/');
        }

        user.allowance -= debtValue;
        await user.save();

        await User.findByIdAndUpdate(notification.sender, { $inc: { allowance: debtValue } });

        notification.isRead = true;
        await notification.save();

        const settlementAlert = new Notification({
            recipient: notification.sender,
            sender: req.user._id,
            type: 'PAYMENT_MARKED',
            message: `${req.user.username} approved your split request and paid ₹${debtValue} instantly.`
        });
        await settlementAlert.save();

        req.flash('success', `Request accepted. ₹${debtValue} transferred safely.`);
        res.redirect('/');
    } catch (err) {
        req.flash('error', `Processing settlement workflow failed: ${err.message}`);
        res.redirect('/');
    }
});

// DECLINE DEBT REQUEST HANDLER
app.post('/debts/:notifyId/decline', isLoggedIn, async (req, res) => {
    try {
        const notification = await Notification.findById(req.params.notifyId);
        if (notification && notification.recipient.toString() === req.user._id.toString()) {
            notification.isRead = true;
            await notification.save();
            
            const declineAlert = new Notification({
                recipient: notification.sender,
                sender: req.user._id,
                type: 'DEBT_OWED',
                message: `${req.user.username} declined your bill splitting request.`
            });
            await declineAlert.save();
        }
        req.flash('success', 'Split request declined.');
        res.redirect('/');
    } catch (e) {
        res.redirect('/');
    }
});

// DELETE EXPENSE WITH RESTORATION FLOW
app.post('/expenses/:id/delete', isLoggedIn, async (req, res) => {
    try {
        const expense = await Expense.findById(req.params.id);
        if (!expense || expense.paidBy.toString() !== req.user._id.toString()) {
            req.flash('error', 'Unauthorized request.');
            return res.redirect('/');
        }
        const user = await User.findById(req.user._id);
        user.allowance += expense.amount;
        await user.save();
        await Expense.findByIdAndDelete(req.params.id);
        req.flash('success', 'Outlay removed. Funds restored.');
        res.redirect('/');
    } catch (err) {
        req.flash('error', `Failed to remove transaction item: ${err.message}`);
        res.redirect('/');
    }
});

app.post('/add-funds', isLoggedIn, async (req, res) => {
    try {
        const { fundingAmount } = req.body;
        if (!fundingAmount || Number(fundingAmount) <= 0) {
            req.flash('error', 'Invalid amount.');
            return res.redirect('/');
        }
        const user = await User.findById(req.user._id);
        user.allowance += Number(fundingAmount);
        await user.save();
        req.flash('success', 'Allowance updated!');
        res.redirect('/');
    } catch (err) { res.redirect('/'); }
});

app.post('/reset-funds', isLoggedIn, async (req, res) => {
    try {
        await User.findByIdAndUpdate(req.user._id, { allowance: 0 });
        req.flash('success', 'Campus balance reset to zero.');
        res.redirect('/');
    } catch (err) { res.redirect('/'); }
});

app.all('*', (req, res) => { res.status(404).send('Page Not Found'); });
const port = process.env.PORT || 3000;
app.listen(port, () => { console.log(`Serving on port ${port}`); });