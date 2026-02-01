const fs = require('fs');
const Database = require('better-sqlite3');
const path = require('path');

// Ensure data directory exists for persistent storage if needed
const dbDir = process.env.IS_RENDER ? '/opt/render/project/src/data' : __dirname;
if (process.env.IS_RENDER && !fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = process.env.IS_RENDER ? path.join(dbDir, 'chat.db') : path.join(__dirname, 'chat.db');
const db = new Database(dbPath);

// Initialize database with new schema
function initDb() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY,
            username TEXT,
            full_name TEXT,
            phone TEXT,
            gender TEXT, -- 'male', 'female'
            xp INTEGER DEFAULT 0,
            dico_balance INTEGER DEFAULT 0,
            warnings INTEGER DEFAULT 0,
            ban_until DATETIME DEFAULT NULL,
            status TEXT DEFAULT 'idle', -- idle, searching, chatting, onboarding
            partner_id INTEGER DEFAULT NULL,
            last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            amount_dico INTEGER,
            screenshot_id TEXT,
            status TEXT DEFAULT 'pending', -- pending, approved, rejected
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `);
}

function getUser(id) {
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function createUser(id, username, fullName) {
    const user = getUser(id);
    if (!user) {
        db.prepare("INSERT INTO users (id, username, full_name, status) VALUES (?, ?, ?, 'onboarding')").run(id, username, fullName);
    }
}

function updatePhone(id, phone) {
    db.prepare('UPDATE users SET phone = ? WHERE id = ?').run(phone, id);
}

function updateGender(id, gender) {
    db.prepare("UPDATE users SET gender = ?, status = 'idle' WHERE id = ?").run(gender, id);
}

function updateStatus(id, status, partnerId = null) {
    db.prepare('UPDATE users SET status = ?, partner_id = ?, last_activity = CURRENT_TIMESTAMP WHERE id = ?')
        .run(status, partnerId, id);
}

function findPartner(id, myGender) {
    // Priority: Opposite gender
    const targetGender = myGender === 'male' ? 'female' : 'male';

    // Try to find opposite gender first
    let partner = db.prepare("SELECT * FROM users WHERE status = 'searching' AND id != ? AND gender = ? ORDER BY last_activity ASC LIMIT 1").get(id, targetGender);

    // If not found, find anyone
    if (!partner) {
        partner = db.prepare("SELECT * FROM users WHERE status = 'searching' AND id != ? ORDER BY last_activity ASC LIMIT 1").get(id);
    }

    return partner;
}

function addXP(id, amount) {
    db.prepare('UPDATE users SET xp = xp + ? WHERE id = ?').run(amount, id);
}

function addWarning(id) {
    const user = getUser(id);
    const newWarnings = (user.warnings || 0) + 1;
    if (newWarnings >= 3) {
        const banUntil = new Date();
        banUntil.setDate(banUntil.getDate() + 1); // 1 day ban
        db.prepare('UPDATE users SET warnings = 0, ban_until = ? WHERE id = ?').run(banUntil.toISOString(), id);
        return true; // Banned
    } else {
        db.prepare('UPDATE users SET warnings = ? WHERE id = ?').run(newWarnings, id);
        return false;
    }
}

function isBanned(id) {
    const user = getUser(id);
    if (user && user.ban_until) {
        const banDate = new Date(user.ban_until);
        if (banDate > new Date()) return true;
        // Ban expired
        db.prepare('UPDATE users SET ban_until = NULL WHERE id = ?').run(id);
    }
    return false;
}

function addDico(id, amount) {
    db.prepare('UPDATE users SET dico_balance = dico_balance + ? WHERE id = ?').run(amount, id);
}

function subtractDico(id, amount) {
    db.prepare('UPDATE users SET dico_balance = dico_balance - ? WHERE id = ?').run(amount, id);
}

function createTransaction(userId, amountDico, screenshotId) {
    return db.prepare('INSERT INTO transactions (user_id, amount_dico, screenshot_id) VALUES (?, ?, ?)').run(userId, amountDico, screenshotId).lastInsertRowid;
}

function updateTransaction(id, status) {
    const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
    if (tx && status === 'approved') {
        addDico(tx.user_id, tx.amount_dico);
    }
    db.prepare('UPDATE transactions SET status = ? WHERE id = ?').run(status, id);
    return tx;
}

function getTopUsers(limit = 10) {
    return db.prepare('SELECT * FROM users ORDER BY xp DESC LIMIT ?').all(limit);
}

module.exports = {
    initDb,
    getUser,
    createUser,
    updatePhone,
    updateGender,
    updateStatus,
    findPartner,
    addXP,
    addWarning,
    isBanned,
    addDico,
    subtractDico,
    createTransaction,
    updateTransaction,
    getTopUsers
};
