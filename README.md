# FinMate

A campus-focused financial and logistics platform that helps students manage expenses, split bills, coordinate group food orders, and share transportation costs.

## Overview

Students regularly face challenges in managing their monthly allowances, splitting group expenses, coordinating food deliveries, and sharing transportation costs. FinMate brings these activities into a single platform, making everyday financial management simpler and more collaborative.

## Features

### Expense Tracking

* Record daily expenses.
* Categorize spending habits.
* View spending analytics and trends.
* Monitor total monthly expenditure.

### Circle Splitter

* Split canteen bills and group purchases.
* Support equal and custom share distributions.
* Keep track of shared expenses among friends.

### Transit Radar

* Create ride-sharing pools for autos and cabs.
* Allow other students to join available seats.
* Automatically divide transportation costs among participants.

### Pool Carts

* Create temporary group-order lobbies.
* Combine food delivery orders with peers.
* Reduce individual delivery charges and satisfy minimum order requirements.

### Allowance Management

* Track monthly budgets and allowances.
* Monitor remaining funds.
* Reset budgets for new spending cycles.

## Tech Stack

**Backend**

* Node.js
* Express.js

**Database**

* MongoDB Atlas
* Mongoose

**Authentication**

* Passport.js
* Local Authentication
* OAuth

**Frontend**

* EJS
* Bootstrap 5
* Chart.js

**Deployment**

* Vercel

## Live Demo

https://fin-mate-ten.vercel.app

## Installation

### Clone the Repository

```bash
git clone https://github.com/yourusername/finmate.git
cd finmate
```

### Install Dependencies

```bash
npm install
```

### Environment Variables

Create a `.env` file in the root directory.

```env
DB_URL=your_mongodb_atlas_connection_string
SESSION_SECRET=your_secret_key
NODE_ENV=development
```

### Run Locally

```bash
node app.js
```

## Future Enhancements

* Real-time notifications for ride pools and order lobbies.
* Advanced spending analytics and budgeting insights.
* Recurring allowance management.
* Mobile-first responsive experience.
* Campus marketplace and peer payment integrations.

## License

This project is licensed under the MIT License.
