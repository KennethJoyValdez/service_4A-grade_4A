const express = require('express');
const bodyParser = require('body-parser');
const admin = require('firebase-admin');

// --- 1. FIREBASE SETUP (Updated for Environment Variables) ---
// Hihingin natin ang SERVICE_ACCOUNT_KEY bilang Environment Variable (JSON string)
const serviceAccountString = process.env.SERVICE_ACCOUNT_KEY;

let db;
if (serviceAccountString) {
    try {
        const serviceAccount = JSON.parse(serviceAccountString);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        db = admin.firestore();
        console.log("Firebase initialized successfully from environment variable.");
    } catch (e) {
        console.error("ERROR: Failed to parse SERVICE_ACCOUNT_KEY. Check if it's a valid JSON string.");
        // Sa production environment, maaaring mag-exit, pero para sa local testing, hayaan muna.
    }
} else {
    // Fallback: Kapag nag-test sa local (dapat may serviceAccountKey.json sa local)
    try {
        const serviceAccount = require('./serviceAccountKey.json');
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        db = admin.firestore();
        console.log("Firebase initialized successfully from local file.");
    } catch (e) {
        console.warn("WARNING: SERVICE_ACCOUNT_KEY not found in ENV and serviceAccountKey.json not found locally. Database operations will fail.");
    }
}

const app = express();
// Gamitin ang port ng host (process.env.PORT) o default sa 3000
const PORT = process.env.PORT || 3000; 

app.use(bodyParser.json());

// --- HELPER FUNCTION ---
const getFeesInfo = async (enrollmentId) => {
    if (!db) return null; // Check kung initialized ang DB

    const feeSnapshot = await db.collection('fees_information').where('enrollment_id', '==', parseInt(enrollmentId)).limit(1).get();

    if (feeSnapshot.empty) {
        return null;
    }

    const feesData = feeSnapshot.docs[0].data();
    
    const transactionsSnapshot = await db.collection('payment_transactions').where('enrollment_id', '==', parseInt(enrollmentId)).where('payment_status_id', '==', 2).get(); // Only count COMPLETED
    let totalPaid = 0;
    transactionsSnapshot.forEach(doc => {
        totalPaid += doc.data().amount;
    });

    const totalAssessed = feesData.total_assessed;
    const remainingBalance = totalAssessed - totalPaid;
    let paymentStatus = 'Pending';
    if (totalPaid >= totalAssessed) {
        paymentStatus = 'Paid';
    } else if (totalPaid > 0) {
        paymentStatus = 'Partial';
    }

    return {
        "enrollment_id": parseInt(enrollmentId),
        "student_id": "S-2023-005",
        "term": "Fall 2024",
        "currency": "PHP",
        "summary": {
            "total_assessed_fees": totalAssessed,
            "total_amount_paid": totalPaid,
            "remaining_balance": remainingBalance,
            "payment_status": paymentStatus
        },
        "fees_details": {
            "tuition_fee": feesData.tuition_fee,
            "computer_lab_fee": feesData.computer_lab_fee,
            "athletic_fee": feesData.athletic_fee,
            "library_fee": feesData.library_fee,
            // I-group ang miscellaneous fees base sa binigay mong fields
            "miscellaneous_fees": feesData.cultural_fee + feesData.internet_fee + feesData.medical_dental_fee + feesData.registration_fee + feesData.school_pub_fee + feesData.id_validation_fee,
        }
    };
};

// --- 2. ENDPOINTS IMPLEMENTATION ---

// Simple check lang kung buhay ang service
app.get('/', (req, res) => {
    res.send({ status: "Payment Microservice Running", deployed_on: process.env.RENDER_EXTERNAL_URL ? 'Render' : 'Local' });
});


// GET /enrollment/{id}/fees_information
app.get('/enrollment/:id/fees_information', async (req, res) => {
    if (!db) return res.status(500).json({ message: "Database not initialized." });
    try {
        const enrollmentId = req.params.id;
        const feesInfo = await getFeesInfo(enrollmentId);

        if (!feesInfo) {
            return res.status(404).json({ message: 'Enrollment or Fees information not found' });
        }
        
        res.status(200).json(feesInfo);
    } catch (error) {
        console.error("Error fetching fees information:", error);
        res.status(500).json({ message: "Internal Server Error" });
    }
});

// POST /enrollment/{id}/payment_transactions (Initiate Payment)
app.post('/enrollment/:id/payment_transactions', async (req, res) => {
    if (!db) return res.status(500).json({ message: "Database not initialized." });
    try {
        const enrollmentId = req.params.id;
        const { amount, payment_method, description } = req.body;

        if (!amount || !payment_method) {
            return res.status(400).json({ message: "Missing required fields: amount, payment_method" });
        }
        
        const newTransactionRef = db.collection('payment_transactions').doc();
        const transactionId = newTransactionRef.id; 

        const transactionData = {
            transaction_id: transactionId,
            enrollment_id: parseInt(enrollmentId),
            amount: amount,
            currency: "PHP",
            payment_method: payment_method,
            transaction_ref: null,
            payment_status_id: 1, // 1: PENDING
            transaction_timestamp: new Date().toISOString(),
            description: description,
        };

        await newTransactionRef.set(transactionData);
        
        res.status(202).json({
            "transaction_id": transactionId,
            "enrollment_id": parseInt(enrollmentId),
            "status": "PENDING",
            "amount_due": amount,
            "payment_gateway_url": `https://gateway.payment.com/checkout?token=${transactionId}`,
            "timestamp": transactionData.transaction_timestamp
        });
    } catch (error) {
        console.error("Error initiating transaction:", error);
        res.status(500).json({ message: "Internal Server Error" });
    }
});

// POST /transactions/{transaction_id} (Update Payment Status)
app.post('/transactions/:transaction_id', async (req, res) => {
    if (!db) return res.status(500).json({ message: "Database not initialized." });
    try {
        const transactionId = req.params.transaction_id;
        const { gateway_reference, status_code } = req.body;

        if (!gateway_reference || !status_code) {
            return res.status(400).json({ message: "Missing required fields: gateway_reference, status_code" });
        }

        const transactionRef = db.collection('payment_transactions').doc(transactionId);
        const transactionDoc = await transactionRef.get();

        if (!transactionDoc.exists) {
            return res.status(404).json({ message: 'Transaction not found' });
        }
        
        let statusId; 
        let statusDescription;

        if(status_code === 'COMPLETED') {
            statusId = 2; // 2: COMPLETED
            statusDescription = 'COMPLETED';
        } else {
            statusId = 3; // 3: FAILED (Example Status)
            statusDescription = status_code;
        }

        await transactionRef.update({
            transaction_ref: gateway_reference,
            payment_status_id: statusId,
            // Hindi na kailangan i-update ang balance dito, kukunin na lang natin ang updated balance
        });
        
        // Simple logic para kunin ang Updated Balance (kailangan ng enrollment_id)
        const enrollmentId = transactionDoc.data().enrollment_id;
        const feesInfo = await getFeesInfo(enrollmentId);
        const updatedBalance = feesInfo ? feesInfo.summary.remaining_balance : 'N/A';

        res.status(200).json({
            "transaction_id": transactionId,
            "status": statusDescription,
            "updated_balance": updatedBalance, 
            "message": "Payment successfully recorded."
        });
    } catch (error) {
        console.error("Error updating transaction status:", error);
        res.status(500).json({ message: "Internal Server Error" });
    }
});

// GET /transactions/{transaction_id}
app.get('/transactions/:transaction_id', async (req, res) => {
    if (!db) return res.status(500).json({ message: "Database not initialized." });
    try {
        const transactionId = req.params.transaction_id;
        const transactionDoc = await db.collection('payment_transactions').doc(transactionId).get();

        if (!transactionDoc.exists) {
            return res.status(404).json({ message: 'Transaction not found' });
        }

        const data = transactionDoc.data();
        
        let statusDescription;
        switch(data.payment_status_id) {
            case 1: statusDescription = "PENDING"; break;
            case 2: statusDescription = "COMPLETED"; break;
            case 3: statusDescription = "FAILED"; break;
            default: statusDescription = "UNKNOWN";
        }

        res.status(200).json({
            "transaction_id": data.transaction_id,
            "date": data.transaction_timestamp,
            "student_id": "S-2023-005",
            "amount_paid": data.amount,
            "payment_method": data.payment_method,
            "reference_number": data.transaction_ref || 'N/A',
            "status": statusDescription
        });
    } catch (error) {
        console.error("Error fetching transaction details:", error);
        res.status(500).json({ message: "Internal Server Error" });
    }
});

// GET /enrollment/{id}/transaction_history
app.get('/enrollment/:id/transaction_history', async (req, res) => {
    if (!db) return res.status(500).json({ message: "Database not initialized." });
    try {
        const enrollmentId = req.params.id;
        
        const transactionsSnapshot = await db.collection('payment_transactions')
            .where('enrollment_id', '==', parseInt(enrollmentId))
            .orderBy('transaction_timestamp', 'desc')
            .get();

        const transactions = [];
        let totalPaid = 0;

        transactionsSnapshot.forEach(doc => {
            const data = doc.data();
            
            let statusDescription;
            switch(data.payment_status_id) {
                case 1: statusDescription = "PENDING"; break;
                case 2: statusDescription = "COMPLETED"; break;
                case 3: statusDescription = "FAILED"; break;
                default: statusDescription = "UNKNOWN";
            }
            
            if (data.payment_status_id === 2) { // Only count COMPLETED payments
                totalPaid += data.amount;
            }

            const transactionType = data.description.includes("Final") ? "Final Installment" : "Downpayment";

            transactions.push({
                "transaction_id": data.transaction_id,
                "date": data.transaction_timestamp.substring(0, 10),
                "amount": data.amount,
                "status": statusDescription,
                "type": transactionType 
            });
        });

        if (transactions.length === 0) {
             return res.status(404).json({ message: 'No transactions found for this enrollment' });
        }

        res.status(200).json({
            "enrollment_id": parseInt(enrollmentId),
            "total_paid": totalPaid,
            "transactions": transactions
        });
    } catch (error) {
        console.error("Error fetching transaction history:", error);
        res.status(500).json({ message: "Internal Server Error" });
    }
});


// Start Server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}. Access URL: ${process.env.RENDER_EXTERNAL_URL || 'http://localhost:' + PORT}`);
});