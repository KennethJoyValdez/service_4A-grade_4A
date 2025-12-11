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

const getStatusDescription = (statusId) => {
    const id = Number(statusId) || 0; 
    switch (id) {
        case 1: return "PENDING";
        case 2: return "COMPLETED";
        case 3: return "FAILED";
        default: return "UNKNOWN/DRAFT"; 
    }
}

// Helper function to get Fees Info data (Hindi na natin ito gagalawin)
const getFeesInfo = async (enrollmentId) => {
    const numericEnrollmentId = Number(enrollmentId); 
    const feeSnapshot = await db.collection('fees_information').where('enrollment_id', '==', numericEnrollmentId).limit(1).get();
    if (feeSnapshot.empty) return null;

    const feesData = feesSnapshot.docs[0].data();
    const transactionsSnapshot = await db.collection('payment_transactions')
                                       .where('enrollment_id', '==', numericEnrollmentId)
                                       .where('payment_status_id', '==', 2) 
                                       .get();
    
    let totalPaid = 0;
    transactionsSnapshot.forEach(doc => { totalPaid += doc.data().amount || 0; });

    const totalAssessed = feesData.total_assessed || 0;
    const remainingBalance = totalAssessed - totalPaid;
    let paymentStatus = totalPaid >= totalAssessed && totalAssessed > 0 ? 'Paid' : (totalPaid > 0 ? 'Partial' : 'Pending');

    const miscellaneousFees = (feesData.cultural_fee || 0) + (feesData.internet_fee || 0) + (feesData.medical_dental_fee || 0) + 
                              (feesData.registration_fee || 0) + (feesData.school_pub_fee || 0) + (feesData.id_validation_fee || 0);

    return {
        "enrollment_id": numericEnrollmentId,
        "student_id": "S-2023-005", "term": "Fall 2024", "currency": "PHP",
        "summary": { total_assessed_fees: totalAssessed, total_amount_paid: totalPaid, remaining_balance: remainingBalance, payment_status: paymentStatus },
        "fees_details": { tuition_fee: feesData.tuition_fee || 0, computer_lab_fee: feesData.computer_lab_fee || 0, athletic_fee: feesData.athletic_fee || 0, library_fee: feesData.library_fee || 0, miscellaneous_fees: miscellaneousFees }
    };
};

// GET /enrollment/{id}/fees_information
app.get('/enrollment/:id/fees_information', async (req, res) => {
    try {
        const feesInfo = await getFeesInfo(req.params.id);
        if (!feesInfo) return res.status(404).json({ message: 'Enrollment or Fees information not found' });
        res.status(200).json(feesInfo);
    } catch (error) {
        console.error("Error fetching fees information:", error.message, error.stack);
        res.status(500).json({ message: "Internal Server Error" });
    }
});

// POST /enrollment/{id}/payment_transactions
app.post('/enrollment/:id/payment_transactions', async (req, res) => {
    try {
        const numericEnrollmentId = Number(req.params.id);
        const { amount, payment_method, description } = req.body;
        const numericAmount = Number(amount) || 0; 
        if (!numericAmount || !payment_method) return res.status(400).json({ message: "Missing required fields: amount and payment_method" });
        
        const newTransactionRef = db.collection('payment_transactions').doc();
        const transactionId = newTransactionRef.id;

        const transactionData = {
            transaction_id: transactionId, enrollment_id: numericEnrollmentId, amount: numericAmount, currency: "PHP",
            payment_method: payment_method || null, transaction_ref: null, payment_status_id: 1, 
            transaction_timestamp: new Date().toISOString(), description: description || null, 
        };

        await newTransactionRef.set(transactionData);
        
        res.status(202).json({
            "transaction_id": transactionId, "enrollment_id": numericEnrollmentId, status: getStatusDescription(1),
            "amount_due": numericAmount, "payment_gateway_url": `https://gateway.payment.com/checkout?token=${transactionId}`,
            "timestamp": transactionData.transaction_timestamp
        });
    } catch (error) {
        console.error("Error initiating transaction (500):", error.message, error.stack);
        res.status(500).json({ message: "Internal Server Error" });
    }
});

// POST /transactions/{transaction_id}
app.post('/transactions/:transaction_id', async (req, res) => {
    try {
        const transactionId = req.params.transaction_id;
        const { gateway_reference, status_code } = req.body; 

        if (!gateway_reference || !status_code) return res.status(400).json({ message: "Missing required fields: gateway_reference, status_code" }); 

        const transactionRef = db.collection('payment_transactions').doc(transactionId);
        const transactionDoc = await transactionRef.get();
        if (!transactionDoc.exists) return res.status(404).json({ message: 'Transaction not found' });
        
        let statusId = status_code === 'COMPLETED' ? 2 : (status_code === 'FAILED' ? 3 : 1); 

        await transactionRef.update({
            transaction_ref: gateway_reference, payment_status_id: statusId,
        });

        res.status(200).json({
            "transaction_id": transactionId, status: getStatusDescription(statusId),
            "updated_balance": 0.00, "message": "Payment successfully recorded."
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
        const transactionDoc = await db.collection('payment_transactions').doc(transactionId).get();
        if (!transactionDoc.exists) return res.status(404).json({ message: 'Transaction not found' });

        const data = transactionDoc.data();
        
        res.status(200).json({
            "transaction_id": data.transaction_id, date: data.transaction_timestamp || 'N/A', 
            "student_id": "S-2023-005", "amount_paid": data.amount || 0, payment_method: data.payment_method || 'N/A', 
            "reference_number": data.transaction_ref || 'N/A', status: getStatusDescription(data.payment_status_id)
        });
    } catch (error) {
        console.error("Error fetching transaction details:", error.message, error.stack);
        res.status(500).json({ message: "Internal Server Error" });
    }
});

// GET /enrollment/{id}/transaction_history (Ito ang inayos na walang orderBy)
app.get('/enrollment/:id/transaction_history', async (req, res) => {
    try {
        const numericEnrollmentId = Number(req.params.id);
        
        // --- KEY FIX: Removed orderBy('transaction_timestamp', 'desc') ---
        const transactionsSnapshot = await db.collection('payment_transactions')
            .where('enrollment_id', '==', numericEnrollmentId)
            .get(); 

        const transactions = [];
        let totalPaid = 0;

        transactionsSnapshot.forEach(doc => {
            const data = doc.data();
            
            const transactionAmount = data.amount && typeof data.amount === 'number' ? data.amount : 0;
            const statusId = Number(data.payment_status_id) || 0; 

            if (statusId === 2) totalPaid += transactionAmount;
            
            const desc = String(data.description || '').toLowerCase();
            const transactionType = desc.includes("final") ? "Final Installment" : "Downpayment/Partial Payment";
            
            const dateString = data.transaction_timestamp || '';

            transactions.push({
                "transaction_id": data.transaction_id,
                "date": dateString.substring(0, 10) || '1970-01-01', // Default date para sa sorting
                "amount": transactionAmount,
                "status": getStatusDescription(statusId), 
                "type": transactionType 
            });
        });

        // Manu-manong i-sort ang transactions sa Node.js
        transactions.sort((a, b) => {
            const dateA = new Date(a.date);
            const dateB = new Date(b.date);
            return dateB.getTime() - dateA.getTime(); // Descending
        });

        res.status(200).json({
            "enrollment_id": numericEnrollmentId,
            "total_paid": totalPaid,
            "transactions": transactions
        });
    } catch (error) {
        console.error("CRITICAL ERROR in transaction_history (After Fix):", error.message, error.stack);
        res.status(500).json({ message: "Internal Server Error" });
    }
});


// GET /transactions (NEW LIST ENDPOINT)
app.get('/transactions', async (req, res) => {
    try {
        // Kukunin lang ang lahat ng records (walang complex filtering o sorting)
        const transactionsSnapshot = await db.collection('payment_transactions').get();

        const transactionsList = [];
        transactionsSnapshot.forEach(doc => {
            const data = doc.data();
            
            const transactionAmount = data.amount && typeof data.amount === 'number' ? data.amount : 0;
            const statusId = Number(data.payment_status_id) || 0; 
            
            transactionsList.push({
                "transaction_id": data.transaction_id,
                "enrollment_id": data.enrollment_id || 'N/A',
                "date": data.transaction_timestamp?.substring(0, 10) || 'N/A',
                "amount": transactionAmount,
                "status": getStatusDescription(statusId)
            });
        });

        res.status(200).json({
            "total_transactions_found": transactionsList.length,
            "transactions": transactionsList.sort((a, b) => new Date(b.date) - new Date(a.date)) // Manual sort
        });
    } catch (error) {
        console.error("CRITICAL ERROR in /transactions list:", error.message, error.stack);
        res.status(500).json({ message: "Internal Server Error in fetching transaction list." });
    }
});

// **Tiyakin na ang getStatusDescription ay nasa code mo**
const getStatusDescription = (statusId) => {
    const id = Number(statusId) || 0; 
    switch (id) {
        case 1: return "PENDING";
        case 2: return "COMPLETED";
        case 3: return "FAILED";
        default: return "UNKNOWN/DRAFT"; 
    }
}

// FINAL LIST ENDPOINT: GET /transactions
app.get('/transactions', async (req, res) => {
    try {
        // Kukunin ang lahat ng records (walang complex filtering o sorting sa database)
        const transactionsSnapshot = await db.collection('payment_transactions').get();

        const transactionsList = [];
        transactionsSnapshot.forEach(doc => {
            const data = doc.data();
            
            const transactionAmount = data.amount && typeof data.amount === 'number' ? data.amount : 0;
            const statusId = Number(data.payment_status_id) || 0; 
            
            transactionsList.push({
                "transaction_id": data.transaction_id,
                "enrollment_id": data.enrollment_id || 'N/A',
                "date": data.transaction_timestamp?.substring(0, 10) || '1970-01-01', // Safe date for sorting
                "amount": transactionAmount,
                "status": getStatusDescription(statusId)
            });
        });

        // Manu-manong i-sort ang transactions sa Node.js
        transactionsList.sort((a, b) => {
            const dateA = new Date(a.date);
            const dateB = new Date(b.date);
            return dateB.getTime() - dateA.getTime(); // Descending
        });

        res.status(200).json({
            "message": "List of all transactions (Replaced failing history endpoint)",
            "total_transactions_found": transactionsList.length,
            "transactions": transactionsList
        });
    } catch (error) {
        console.error("CRITICAL ERROR in /transactions list:", error.message, error.stack);
        res.status(500).json({ message: "Internal Server Error in fetching transaction list." });
    }
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});