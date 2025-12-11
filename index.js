const express = require('express');
const bodyParser = require('body-parser');
const admin = require('firebase-admin');

// --- 1. FIREBASE SETUP ---
const serviceAccountString = process.env.SERVICE_ACCOUNT_KEY;

let db;
try {
    if (!serviceAccountString) {
        throw new Error("SERVICE_ACCOUNT_KEY environment variable is missing.");
    }
    
    const serviceAccount = JSON.parse(serviceAccountString);
    
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    db = admin.firestore();
    console.log("Firebase initialized successfully using Environment Variable.");

} catch (e) {
    console.error("CRITICAL ERROR: Firebase Initialization Failed.", e.message);
    process.exit(1); 
}

const app = express();
const PORT = process.env.PORT || 3000; 

app.use(bodyParser.json());

// Helper function to convert transaction status ID to description
const getStatusDescription = (statusId) => {
    const id = Number(statusId) || 0; 
    switch (id) {
        case 1:
            return "PENDING";
        case 2:
            return "COMPLETED";
        case 3:
            return "FAILED";
        default:
            return "UNKNOWN/DRAFT"; 
    }
}

// Helper function to get Fees Info data (Hindi na natin ito gagalawin dahil gumagana na)
const getFeesInfo = async (enrollmentId) => {
    const numericEnrollmentId = Number(enrollmentId); 
    
    const feeSnapshot = await db.collection('fees_information').where('enrollment_id', '==', numericEnrollmentId).limit(1).get();

    if (feeSnapshot.empty) {
        return null;
    }

    const feesData = feeSnapshot.docs[0].data();
    
    const transactionsSnapshot = await db.collection('payment_transactions')
                                       .where('enrollment_id', '==', numericEnrollmentId)
                                       .where('payment_status_id', '==', 2) 
                                       .get();
    
    let totalPaid = 0;
    transactionsSnapshot.forEach(doc => {
        totalPaid += doc.data().amount || 0; 
    });

    const totalAssessed = feesData.total_assessed || 0;
    const remainingBalance = totalAssessed - totalPaid;
    let paymentStatus = 'Pending';
    if (totalPaid >= totalAssessed && totalAssessed > 0) {
        paymentStatus = 'Paid';
    } else if (totalPaid > 0) {
        paymentStatus = 'Partial';
    }

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

// POST /enrollment/{id}/payment_transactions (Gumagana na ito)
app.post('/enrollment/:id/payment_transactions', async (req, res) => {
    try {
        const numericEnrollmentId = Number(req.params.id);
        const { amount, payment_method, description } = req.body;
        const numericAmount = Number(amount) || 0; 

        if (!numericAmount || !payment_method) {
            return res.status(400).json({ message: "Missing required fields: amount and payment_method" });
        }
        
        const newTransactionRef = db.collection('payment_transactions').doc();
        const transactionId = newTransactionRef.id;

        const transactionData = {
            transaction_id: transactionId,
            enrollment_id: numericEnrollmentId, 
            amount: numericAmount,
            currency: "PHP",
            payment_method: payment_method || null, 
            transaction_ref: null, 
            payment_status_id: 1, // PENDING (Number)
            transaction_timestamp: new Date().toISOString(),
            description: description || null, 
        };

        await newTransactionRef.set(transactionData);
        
        res.status(202).json({
            "transaction_id": transactionId,
            "enrollment_id": numericEnrollmentId,
            "status": getStatusDescription(1),
            "amount_due": numericAmount,
            "payment_gateway_url": `https://gateway.payment.com/checkout?token=${transactionId}`,
            "timestamp": transactionData.transaction_timestamp
        });
    } catch (error) {
        console.error("Error initiating transaction (500):", error.message, error.stack);
        res.status(500).json({ message: "Internal Server Error" });
    }
});

// POST /transactions/{transaction_id} (Gumagana na ito)
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

        if(status_code === 'COMPLETED') {
            statusId = 2; 
        } else if (status_code === 'FAILED') {
            statusId = 3; 
        } else {
            statusId = 1; 
        }

        await transactionRef.update({
            transaction_ref: gateway_reference,
            payment_status_id: statusId,
        });

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

// GET /transactions/{transaction_id} (Gumagana na ito)
app.get('/transactions/:transaction_id', async (req, res) => {
    try {
        const transactionId = req.params.transaction_id;
        const transactionDoc = await db.collection('payment_transactions').doc(transactionId).get();

        if (!transactionDoc.exists) {
            return res.status(404).json({ message: 'Transaction not found' });
        }

        const data = transactionDoc.data();
        
        res.status(200).json({
            "transaction_id": data.transaction_id,
            "date": data.transaction_timestamp || 'N/A', 
            "student_id": "S-2023-005",
            "amount_paid": data.amount || 0, 
            "payment_method": data.payment_method || 'N/A', 
            "reference_number": data.transaction_ref || 'N/A',
            "status": getStatusDescription(data.payment_status_id)
        });
    } catch (error) {
        console.error("Error fetching transaction details:", error.message, error.stack);
        res.status(500).json({ message: "Internal Server Error" });
    }
});

// GET /enrollment/{id}/transaction_history (ITO ANG INAYOS)
app.get('/enrollment/:id/transaction_history', async (req, res) => {
    try {
        const numericEnrollmentId = Number(req.params.id);
        
        // TINANGGAL ANG .orderBy('transaction_timestamp', 'desc')
        // PARA HINDI MAG-CRASH SA MGA RECORD NA WALANG TIMESTAMP.
        const transactionsSnapshot = await db.collection('payment_transactions')
            .where('enrollment_id', '==', numericEnrollmentId)
            .get(); 

        const transactions = [];
        let totalPaid = 0;

        transactionsSnapshot.forEach(doc => {
            const data = doc.data();
            
            const transactionAmount = data.amount && typeof data.amount === 'number' ? data.amount : 0;
            const statusId = Number(data.payment_status_id) || 0; 

            if (statusId === 2) { 
                totalPaid += transactionAmount;
            }
            
            const desc = String(data.description || '').toLowerCase();
            const transactionType = desc.includes("final") ? "Final Installment" : "Downpayment/Partial Payment";
            
            const dateString = data.transaction_timestamp || '';

            transactions.push({
                "transaction_id": data.transaction_id,
                "date": dateString.substring(0, 10) || 'N/A', 
                "amount": transactionAmount,
                "status": getStatusDescription(statusId), 
                "type": transactionType 
            });
        });

        // Manu-manong i-sort ang transactions sa Node.js bago i-send
        transactions.sort((a, b) => {
            const dateA = new Date(a.date);
            const dateB = new Date(b.date);
            // I-sort pababa (descending) para mas bago ang nasa taas
            return dateB.getTime() - dateA.getTime(); 
        });

        res.status(200).json({
            "enrollment_id": numericEnrollmentId,
            "total_paid": totalPaid,
            "transactions": transactions
        });
    } catch (error) {
        console.error("CRITICAL ERROR in transaction_history:", error.message, error.stack);
        res.status(500).json({ message: "Internal Server Error" });
    }
});


// Start Server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});