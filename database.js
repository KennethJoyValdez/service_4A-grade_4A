const sqlite3 = require('sqlite3').verbose();

// Connect to a file-based database. 
// If it doesn't exist, it will be created automatically.
const db = new sqlite3.Database('./payments.db', (err) => {
    if (err) {
        console.error('Error opening database ' + err.message);
    } else {
        console.log('Connected to the SQLite database.');
    }
});

// Initialize Tables
db.serialize(() => {
    // 1. Payment Status Table
    db.run(`CREATE TABLE IF NOT EXISTS payment_status (
        status_id INTEGER PRIMARY KEY,
        status_code TEXT UNIQUE,
        description TEXT
    )`);

    // 2. Fees Information Table
    db.run(`CREATE TABLE IF NOT EXISTS fees_information (
        fee_record_id INTEGER PRIMARY KEY AUTOINCREMENT,
        enrollment_id INTEGER UNIQUE,
        student_id TEXT,
        term TEXT,
        currency TEXT,
        tuition_fee REAL,
        computer_lab_fee REAL,
        athletic_fee REAL,
        cultural_fee REAL,
        internet_fee REAL,
        library_fee REAL,
        medical_dental_fee REAL,
        registration_fee REAL,
        school_pub_fee REAL,
        id_validation_fee REAL,
        total_assessed REAL
    )`);

    // 3. Payment Transactions Table
    db.run(`CREATE TABLE IF NOT EXISTS payment_transactions (
        transaction_id TEXT PRIMARY KEY,
        enrollment_id INTEGER,
        amount REAL,
        currency TEXT,
        payment_method TEXT,
        transaction_ref TEXT,
        status_code TEXT, 
        transaction_timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        description TEXT,
        FOREIGN KEY (enrollment_id) REFERENCES fees_information(enrollment_id)
    )`);

    // --- SEED DATA (So the API has data to show) ---
    
    // Seed Statuses
    const insertStatus = db.prepare("INSERT OR IGNORE INTO payment_status (status_id, status_code, description) VALUES (?, ?, ?)");
    insertStatus.run(1, 'PENDING', 'Transaction initiated, waiting for payment');
    insertStatus.run(2, 'COMPLETED', 'Payment successful');
    insertStatus.run(3, 'FAILED', 'Payment failed');
    insertStatus.finalize();

    // Seed Enrollment 1001 (Matches your prompt example)
    db.get("SELECT * FROM fees_information WHERE enrollment_id = 1001", (err, row) => {
        if (!row) {
            console.log("Seeding Enrollment 1001 data...");
            const insertFee = db.prepare(`INSERT INTO fees_information (
                enrollment_id, student_id, term, currency,
                tuition_fee, computer_lab_fee, athletic_fee, cultural_fee, internet_fee,
                library_fee, medical_dental_fee, registration_fee, school_pub_fee, id_validation_fee,
                total_assessed
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            
            // Total is 15000 based on your example
            insertFee.run(
                1001, 'S-2023-005', 'Fall 2024', 'PHP',
                10000.00, // Tuition
                500.00,   // Comp Lab
                200.00,   // Athletic
                500.00,   // Cultural (Misc)
                500.00,   // Internet (Misc)
                300.00,   // Library
                1000.00,  // Medical (Misc)
                1000.00,  // Registration (Misc)
                500.00,   // Pub (Misc)
                500.00,   // ID (Misc)
                15000.00  // Total Assessed
            );
            insertFee.finalize();

            // Seed one past transaction (The "Downpayment" in your history example)
            db.run(`INSERT INTO payment_transactions 
                (transaction_id, enrollment_id, amount, currency, payment_method, transaction_ref, status_code, transaction_timestamp, description)
                VALUES ('TXN-112233', 1001, 10000.00, 'PHP', 'Over Counter', 'REF-OLD-1', 'COMPLETED', '2024-08-15 09:00:00', 'Downpayment')`);
        }
    });
});

module.exports = db;