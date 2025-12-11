const express = require('express');
const bodyParser = require('body-parser');
const admin = require('firebase-admin');

// --- 1. FIREBASE SETUP (USING ENVIRONMENT VARIABLE) ---
const serviceAccountString = process.env.SERVICE_ACCOUNT_KEY;

let db;
try {
    const serviceAccount = JSON.parse(serviceAccountString);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    db = admin.firestore();
    console.log("Firebase initialized successfully.");
} catch (e) {
    console.error("ERROR: Failed to initialize Firebase. Check SERVICE_ACCOUNT_KEY environment variable. If running locally, ensure serviceAccountKey.json is present.", e);
    // Para sa local testing, gagamitin ang local file (kung nasa local ka)
    if (process.env.NODE_ENV !== 'production' && !serviceAccountString) {
        try {
            const localServiceAccount = require('./serviceAccountKey.json');
            admin.initializeApp({
                credential: admin.credential.cert(localServiceAccount)
            });
            db = admin.firestore();
            console.log("Firebase initialized using local file.");
        } catch (localError) {
            console.error("Critical Error: Firebase setup failed both with ENV variable and local file.");
            process.exit(1);
        }
    } else if (!db) {
        process.exit(1); 
    }
}


const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());

// Helper function to get Fees Info data
const getFeesInfo = async (enrollmentId) => {
    const numericEnrollmentId = parseInt(enrollmentId); // Ensure it's a number for comparison
    
    // Kukunin ang Fees Information mula sa Firestore
    const feeSnapshot = await db.collection('fees_information').where('enrollment_id', '==', numericEnrollmentId).limit(1).get();

    if (feeSnapshot.empty) {
        return null;
    }

    const feesData = feeSnapshot.docs[0].data();
    
    // Simpleng simulation ng transactions para sa summary
    const transactionsSnapshot = await db.collection('payment_transactions')
                                       .where('enrollment_id', '==', numericEnrollmentId)
                                       .where('payment_status_id', '==', 2) // Only count COMPLETED payments
                                       .get();
    
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
        "enrollment_id": numericEnrollmentId,
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
            // Ginagawang Number ang total assessed (para iwas error)
            "miscellaneous_fees": (totalAssessed - feesData.tuition_fee - feesData.computer_lab_fee - feesData.athletic_fee - feesData.library_fee), 
        }
    };
};

// --- 2. ENDPOINTS IMPLEMENTATION ---

// GET /enrollment/{id}/fees_information
app.get('/enrollment/:id/fees_information', async (req, res) => {
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
    try {
        const numericEnrollmentId = parseInt(req.params.id);
        const { amount, payment_method, description } = req.body;

        if (!amount || !payment_method) {
            return res.status(400).json({ message: "Missing required fields: amount, payment_method" });
        }
        
        // Simulan ang transaction record sa Firestore
        const newTransactionRef = db.collection('payment_transactions').doc();
        const transactionId = newTransactionRef.id;

        const transactionData = {
            transaction_id: transactionId,
            enrollment_id: numericEnrollmentId, // Siguraduhin na Number ito
            amount: amount,
            currency: "PHP",
            payment_method: payment_method,
            transaction_ref: null,
            payment_status_id: 1, // 'PENDING' status ID (Number)
            transaction_timestamp: new Date().toISOString(),
            description: description || "Regular Payment",
        };

        await newTransactionRef.set(transactionData);
        
        // Output format (Mocking Payment Gateway)
        res.status(202).json({
            "transaction_id": transactionId,
            "enrollment_id": numericEnrollmentId,
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

// POST /transactions/{transaction_id} (Update Payment Status from Gateway/Webhook)
app.post('/transactions/:transaction_id', async (req, res) => {
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
            statusId = 2; // COMPLETED status ID (Number)
            statusDescription = 'COMPLETED';
        } else if (status_code === 'FAILED') {
            statusId = 3; // FAILED status ID (Number)
            statusDescription = 'FAILED';
        } else {
            // Iba pang status code
            statusId = 1; 
            statusDescription = status_code;
        }

        await transactionRef.update({
            transaction_ref: gateway_reference,
            payment_status_id: statusId,
        });

        // Sa totoong system, dapat i-calculate ang bagong balance
        const updatedBalance = 0.00; // Mocking

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
    try {
        const transactionId = req.params.transaction_id;
        const transactionDoc = await db.collection('payment_transactions').doc(transactionId).get();

        if (!transactionDoc.exists) {
            return res.status(404).json({ message: 'Transaction not found' });
        }

        const data = transactionDoc.data();
        
        let statusDescription;
        if (data.payment_status_id === 1) statusDescription = "PENDING";
        else if (data.payment_status_id === 2) statusDescription = "COMPLETED";
        else statusDescription = "FAILED"; // assuming 3 is failed

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
    try {
        const numericEnrollmentId = parseInt(req.params.id);
        
        const transactionsSnapshot = await db.collection('payment_transactions')
            .where('enrollment_id', '==', numericEnrollmentId) // Use numeric ID
            .orderBy('transaction_timestamp', 'desc')
            .get();

        const transactions = [];
        let totalPaid = 0;

        transactionsSnapshot.forEach(doc => {
            const data = doc.data();
            
            let statusDescription;
            if (data.payment_status_id === 1) statusDescription = "PENDING";
            else if (data.payment_status_id === 2) statusDescription = "COMPLETED";
            else statusDescription = "FAILED"; 

            // Kung COMPLETED lang ang binabayaran, saka lang siya idadagdag sa totalPaid
            if (data.payment_status_id === 2) { 
                totalPaid += data.amount;
            }
            
            const transactionType = data.description && data.description.includes("Final") ? "Final Installment" : "Downpayment";

            transactions.push({
                "transaction_id": data.transaction_id,
                "date": data.transaction_timestamp.substring(0, 10),
                "amount": data.amount,
                "status": statusDescription,
                "type": transactionType 
            });
        });

        if (transactions.length === 0) {
             // Kung walang transaction, pwede pa ring ibalik ang 200 na may empty list
             return res.status(200).json({
                "enrollment_id": numericEnrollmentId,
                "total_paid": 0,
                "transactions": []
            });
        }

        res.status(200).json({
            "enrollment_id": numericEnrollmentId,
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
  console.log(`Server running on port ${PORT}`);
});