const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');

// Enrollment related routes
router.get('/enrollment/:id/fees_information', paymentController.getFeesInformation);
router.post('/enrollment/:id/payment_transactions', paymentController.handlePaymentTransaction);
router.get('/enrollment/:id/transaction_history', paymentController.getTransactionHistory);

// Transaction related routes
router.get('/transactions/:transaction_id', paymentController.getTransactionDetails);

module.exports = router;