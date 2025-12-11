const express = require('express');
const bodyParser = require('body-parser');
const admin = require('firebase-admin');

// --- 1. FIREBASE SETUP (USING ENVIRONMENT VARIABLE) ---
const serviceAccountString = process.env.SERVICE_ACCOUNT_KEY;

let db;
try {
    // Subukan munang gamitin ang ENV variable (para sa Render)
    if (serviceAccountString) {
        const serviceAccount = JSON.parse(serviceAccountString);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        db = admin.firestore();
        console.log("Firebase initialized successfully using Environment Variable.");
    } else {
        // Fallback para sa local testing (kung may serviceAccountKey.json)
        const localServiceAccount = require('./serviceAccountKey.json');
        admin.initializeApp({
            credential: admin.credential.cert(localServiceAccount)
        });
        db = admin.firestore();
        console.log("Firebase initialized successfully using local file.");
    }
} catch (e) {
    console.error("CRITICAL ERROR: Failed to initialize Firebase Admin SDK.", e.message);
    // Kapag nag-fail ang initialization, hindi na tayo magpapahintulot na tumakbo ang app
    process.exit(1); 
}

const app = express();
// Gamitin ang port galing sa host (Render) o 3000 (local)
const PORT = process.env.PORT || 3000; 

app.use(bodyParser.json());

// Helper function to convert transaction status ID to description
const getStatusDescription = (statusId) => {
    switch (statusId) {
        case 1:
            return "PENDING";
        case 2:
            return "COMPLETED";
        case 3:
            return "FAILED";
        default:
            return "UNKNOWN";
    }
}

// Helper function to get Fees Info data
const getFeesInfo = async (enrollmentId) => {
    const numericEnrollmentId = Number(enrollmentId); // Gamitin ang Number() para mas malakas ang conversion
    
    // 1. Kukunin ang Fees Information
    const feeSnapshot = await db.collection('fees_information').where('enrollment_id', '==', numericEnrollmentId).limit(1).get();

    if (feeSnapshot.empty) {
        return null;
    }

    const feesData = feeSnapshot.docs[0].data();
    
    // 2. Kukunin ang COMPLETED transactions
    const transactionsSnapshot = await db.collection('payment_transactions')
                                       .where('enrollment_id', '==', numericEnrollmentId)
                                       .where('payment_status_id', '==', 2) // Only count COMPLETED payments
                                       .get();
    
    let totalPaid = 0;
    transactionsSnapshot.forEach(doc => {
        totalPaid += doc.data().amount;
    });

    const totalAssessed = feesData.total_assessed || 0;
    const remainingBalance = totalAssessed - totalPaid;
    let paymentStatus = 'Pending';
    if (totalPaid >= totalAssessed && totalAssessed > 0) {
        paymentStatus = 'Paid';
    } else if (totalPaid > 0) {
        paymentStatus = 'Partial';
    }

    // Simpleng pag-calculate ng Miscellaneous fees (para tugma sa output format)
    const miscellaneousFees = (feesData.cultural_fee || 0) + 
                              (feesData.internet_fee || 0) + 
                              (feesData.medical_dental_fee || 0) + 
                              (feesData.registration_fee || 0) + 
                              (feesData.school_pub_fee || 0) + 
                              (feesData.id_validation_fee || 0);

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
            "tuition_fee": feesData.tuition_fee || 0,
            "computer_lab_fee": feesData.computer_lab_fee || 0,
            "athletic_fee": feesData.athletic_fee || 0,
            "library_fee": feesData.library_fee || 0,
            "miscellaneous_fees": miscellaneousFees
        }
    };
};

// --- 2. ENDPOINTS IMPLEMENTATION ---

// GET /enrollment/{id}/fees_information
app.get('/enrollment/:id/fees_information', async (req, res) => {
    try {
        const feesInfo = await getFeesInfo(req.params.id);

        if (!feesInfo) {
            return res.status(404).json({ message: 'Enrollment or Fees information not found' });
        }
        
        res.status(200).json(feesInfo);
    } catch (error) {
        // Tiyakin na nagla-log tayo ng error sa console ng Render
        console.error("Error fetching fees information:", error.message, error.stack);
        res.status(500).json({ message: "Internal Server Error" });
    }
});

// POST /enrollment/{id}/payment_transactions (Initiate Payment)
app.post('/enrollment/:id/payment_transactions', async (req, res) => {
    try {
        const numericEnrollmentId = Number(req.params.id);
        const amount = Number(req.body.amount); // Siguraduhin na Number ang amount
        const { payment_method, description } = req.body;

        if (!amount || !payment_method) {
            return res.status(400).json({ message: "Missing required fields: amount and payment_method" });
        }
        
        // Gamitin ang auto-generated ID ng Firestore bilang transaction ID
        const newTransactionRef = db.collection('payment_transactions').doc();
        const transactionId = newTransactionRef.id;

        const transactionData = {
            transaction_id: transactionId,
            enrollment_id: numericEnrollmentId, 
            amount: amount,
            currency: "PHP",
            payment_method: payment_method,
            transaction_ref: null,
            payment_status_id: 1, // 'PENDING' status ID (Number)
            transaction_timestamp: new Date().toISOString(),
            description: description || "Payment",
        };

        await newTransactionRef.set(transactionData);
        
        res.status(202).json({
            "transaction_id": transactionId,
            "enrollment_id": numericEnrollmentId,
            "status": getStatusDescription(1),
            "amount_due": amount,
            "payment_gateway_url": `https://gateway.payment.com/checkout?token=${transactionId}`,
            "timestamp": transactionData.transaction_timestamp
        });
    } catch (error) {
        console.error("Error initiating transaction:", error.message, error.stack);
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

        // Tiyakin na ang ID na ipinasa ay galing sa URL parameter
        const transactionRef = db.collection('payment_transactions').doc(transactionId);
        const transactionDoc = await transactionRef.get();

        if (!transactionDoc.exists) {
            return res.status(404).json({ message: 'Transaction not found' });
        }
        
        let statusId;

        if(status_code === 'COMPLETED') {
            statusId = 2; // COMPLETED status ID 
        } else if (status_code === 'FAILED') {
            statusId = 3; // FAILED status ID 
        } else {
            statusId = 1; // Default to PENDING/UNKNOWN
        }

        await transactionRef.update({
            transaction_ref: gateway_reference,
            payment_status_id: statusId,
        });

        // Ito ay dapat kalkulahin base sa total fees at transactions (mocked for now)
        const updatedBalance = 0.00; 

        res.status(200).json({
            "transaction_id": transactionId,
            "status": getStatusDescription(statusId),
            "updated_balance": updatedBalance, 
            "message": "Payment successfully recorded."
        });
    } catch (error) {
        console.error("Error updating transaction status:", error.message, error.stack);
        res.status(500).json({ message: "Internal Server Error" });
    }
});

// GET /transactions/{transaction_id}
app.get('/transactions/:transaction_id', async (req, res) => {
    try {
        const transactionId = req.params.transaction_id;
        // Gumamit ng doc() para direktang kunin ang record gamit ang ID
        const transactionDoc = await db.collection('payment_transactions').doc(transactionId).get();

        if (!transactionDoc.exists) {
            return res.status(404).json({ message: 'Transaction not found' });
        }

        const data = transactionDoc.data();
        
        res.status(200).json({
            "transaction_id": data.transaction_id,
            "date": data.transaction_timestamp,
            "student_id": "S-2023-005",
            "amount_paid": data.amount,
            "payment_method": data.payment_method,
            "reference_number": data.transaction_ref || 'N/A',
            "status": getStatusDescription(data.payment_status_id)
        });
    } catch (error) {
        console.error("Error fetching transaction details:", error.message, error.stack);
        res.status(500).json({ message: "Internal Server Error" });
    }
});

// GET /enrollment/{id}/transaction_history
app.get('/enrollment/:id/transaction_history', async (req, res) => {
    try {
        const numericEnrollmentId = Number(req.params.id);
        
        const transactionsSnapshot = await db.collection('payment_transactions')
            .where('enrollment_id', '==', numericEnrollmentId) // Gamitin ang Number()
            .orderBy('transaction_timestamp', 'desc')
            .get();

        const transactions = [];
        let totalPaid = 0;

        transactionsSnapshot.forEach(doc => {
            const data = doc.data();
            
            // Only count COMPLETED payments to the total
            if (data.payment_status_id === 2) { 
                totalPaid += data.amount;
            }
            
            const transactionType = data.description && data.description.includes("Final") ? "Final Installment" : "Downpayment";

            transactions.push({
                "transaction_id": data.transaction_id,
                "date": data.transaction_timestamp.substring(0, 10),
                "amount": data.amount,
                "status": getStatusDescription(data.payment_status_id),
                "type": transactionType 
            });
        });

        res.status(200).json({
            "enrollment_id": numericEnrollmentId,
            "total_paid": totalPaid,
            "transactions": transactions
        });
    } catch (error) {
        console.error("Error fetching transaction history:", error.message, error.stack);
        res.status(500).json({ message: "Internal Server Error" });
    }
});


// Start Server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});