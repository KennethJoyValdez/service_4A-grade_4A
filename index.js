// index.js
const express = require('express');
const bodyParser = require('body-parser');
const { payment_transactions, fees_information, payment_status } = require('./data');

const app = express();
const PORT = 3000;

app.use(bodyParser.json());

// Helper function to calculate balances
const calculateBalances = (enrollment_id) => {
    const fees = fees_information.find(f => f.enrollment_id === enrollment_id);
    const payments = payment_transactions.filter(t => t.enrollment_id === enrollment_id && payment_status.find(s => s.status_id === t.payment_status_id).status_code === 'COMPLETED');
    const total_paid = payments.reduce((sum, t) => sum + t.amount, 0);
    const total_assessed_fees = fees ? fees.total_assessed : 0;
    const remaining_balance = total_assessed_fees - total_paid;
    const payment_status_text = remaining_balance <= 0 ? "Paid" : (total_paid > 0 ? "Partial" : "Unpaid");

    return { total_assessed_fees, total_amount_paid: total_paid, remaining_balance, payment_status_text };
};

// 1. GET /enrollment/{id}/fees_information
app.get('/enrollment/:id/fees_information', (req, res) => {
    const enrollment_id = parseInt(req.params.id);
    const fees = fees_information.find(f => f.enrollment_id === enrollment_id);

    if (!fees) return res.status(404).send({ message: "Enrollment not found" });

    const { total_assessed_fees, total_amount_paid, remaining_balance, payment_status_text } = calculateBalances(enrollment_id);

    res.json({
        "enrollment_id": enrollment_id,
        "student_id": "S-2023-005", // Mocked
        "term": "Fall 2024", // Mocked
        "currency": "PHP",
        "summary": {
            total_assessed_fees,
            total_amount_paid,
            remaining_balance,
            "payment_status": payment_status_text
        },
        "fees_details": {
            "tuition_fee": fees.tuition_fee,
            "computer_lab_fee": fees.computer_lab_fee,
            "athletic_fee": fees.athletic_fee,
            "library_fee": fees.library_fee,
            "miscellaneous_fees": total_assessed_fees - (fees.tuition_fee + fees.computer_lab_fee + fees.athletic_fee + fees.library_fee)
        }
    });
});

// 2. POST /enrollment/{id}/payment_transactions (Initiate Payment)
app.post('/enrollment/:id/payment_transactions', (req, res) => {
    const enrollment_id = parseInt(req.params.id);
    const { amount, payment_method } = req.body;
    const transaction_id = `TXN-${Math.floor(Math.random() * 90000000) + 10000000}`; // Mocked ID

    const newTransaction = {
        transaction_id,
        enrollment_id,
        amount,
        currency: "PHP",
        payment_method,
        transaction_ref: null,
        payment_status_id: 2, // PENDING
        transaction_timestamp: new Date().toISOString()
    };
    payment_transactions.push(newTransaction);

    res.status(202).json({
        "transaction_id": transaction_id,
        "enrollment_id": enrollment_id,
        "status": "PENDING",
        "amount_due": amount,
        "payment_gateway_url": `https://gateway.payment.com/checkout?token=xyz123`, // Mocked URL
        "timestamp": newTransaction.transaction_timestamp
    });
});

// 3. POST /transactions/{transaction_id} (Process Gateway Callback)
app.post('/transactions/:transaction_id', (req, res) => {
    const transaction_id = req.params.transaction_id;
    const { gateway_reference, status_code } = req.body;

    const transaction = payment_transactions.find(t => t.transaction_id === transaction_id);
    if (!transaction) return res.status(404).send({ message: "Transaction not found" });

    // Update transaction status
    const status = payment_status.find(s => s.status_code === status_code);
    if (!status) return res.status(400).send({ message: "Invalid status code" });

    transaction.payment_status_id = status.status_id;
    transaction.transaction_ref = gateway_reference;
    // Note: The second POST in the prompt is used for processing the callback/webhook.

    const { remaining_balance } = calculateBalances(transaction.enrollment_id);

    res.json({
        "transaction_id": transaction_id,
        "status": status.status_code,
        "updated_balance": remaining_balance,
        "message": "Payment successfully recorded."
    });
});

// 4. GET /transactions/{transaction_id}
app.get('/transactions/:transaction_id', (req, res) => {
    const transaction_id = req.params.transaction_id;
    const transaction = payment_transactions.find(t => t.transaction_id === transaction_id);

    if (!transaction) return res.status(404).send({ message: "Transaction not found" });

    const status = payment_status.find(s => s.status_id === transaction.payment_status_id);

    res.json({
        "transaction_id": transaction.transaction_id,
        "date": transaction.transaction_timestamp,
        "student_id": "S-2023-005", // Mocked
        "amount_paid": transaction.amount,
        "payment_method": transaction.payment_method,
        "reference_number": transaction.transaction_ref,
        "status": status.status_code
    });
});

// 5. GET /enrollment/{id}/transaction_history
app.get('/enrollment/:id/transaction_history', (req, res) => {
    const enrollment_id = parseInt(req.params.id);
    const payments = payment_transactions.filter(t => t.enrollment_id === enrollment_id);

    const { total_amount_paid } = calculateBalances(enrollment_id);

    const transactions = payments.map(t => {
        const status = payment_status.find(s => s.status_id === t.payment_status_id);
        return {
            "transaction_id": t.transaction_id,
            "date": t.transaction_timestamp.substring(0, 10), // simplified date
            "amount": t.amount,
            "status": status.status_code,
            "type": t.transaction_id === "TXN-112233" ? "Downpayment" : "Installment"
        };
    });

    res.json({
        "enrollment_id": enrollment_id,
        "total_paid": total_amount_paid,
        transactions
    });
});

app.listen(PORT, () => {
    console.log(`Microservice running on http://localhost:${PORT}`);
});
