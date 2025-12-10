// data.js
const payment_transactions = [
    // Initial transaction for the downpayment
    { transaction_id: "TXN-112233", enrollment_id: 1001, amount: 10000.00, currency: "PHP", payment_method: "Bank Transfer", transaction_ref: "REF-4567", payment_status_id: 1, transaction_timestamp: "2024-08-15T09:00:00Z" }
];

const fees_information = [
    {
        fee_record_id: 1, enrollment_id: 1001, tuition_fee: 10000.00, computer_lab_fee: 500.00, athletic_fee: 200.00,
        cultural_fee: 0, internet_fee: 0, library_fee: 300.00, medical_dental_fee: 0,
        registration_fee: 0, school_pub_fee: 0, id_validation_fee: 0, total_assessed: 15000.00
    }
];

const payment_status = [
    { status_id: 1, status_code: "COMPLETED", description: "Payment fully processed." },
    { status_id: 2, status_code: "PENDING", description: "Waiting for payment confirmation from gateway." },
    { status_id: 3, status_code: "FAILED", description: "Payment could not be processed." }
];

module.exports = { payment_transactions, fees_information, payment_status };
