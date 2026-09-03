const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// Handle CORS Preflight for Vercel
app.options('*', cors());

// Serve Admin Panel Static Folder
app.use(express.static(path.join(__dirname, 'publicm')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'publicm', 'admin.html'));
});

const DB_FILE = '/tmp/db.json';
let memoryDB = { users: {} };

async function readDB() {
    try {
        const data = await fs.readFile(DB_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return memoryDB || { users: {} }; 
    }
}

async function writeDB(db) {
    memoryDB = db;
    try {
        await fs.writeFile(DB_FILE, JSON.stringify(db, null, 4), 'utf8');
    } catch (e) {
        console.log("DB Storage Warning:", e.message);
    }
}

function findUser(db, username) {
    if (!username || !db || !db.users) return null;
    const cleanName = String(username).trim().toLowerCase();
    const key = Object.keys(db.users).find(k => k.toLowerCase() === cleanName);
    return key ? db.users[key] : null;
}

// Extract data from URL Query (GET) or JSON Body (POST)
function getRequestData(req) {
    return { ...req.query, ...req.body };
}

// 1. REGISTER USER (Supports both GET & POST)
app.all('/api/auth/register', async (req, res) => {
    try {
        const data = getRequestData(req);
        const username = data.username ? String(data.username).trim() : '';
        const password = data.password ? String(data.password).trim() : '';
        const device_id = data.device_id ? String(data.device_id).trim() : '';

        if (!username || !password || !device_id) {
            return res.status(400).json({ error: "Required fields missing in URL" });
        }

        const db = await readDB();
        if (findUser(db, username)) {
            return res.status(400).json({ error: "Username already exists." });
        }

        const existingDeviceUser = Object.values(db.users).find(u => u.device_id === device_id);
        if (existingDeviceUser) {
            return res.status(400).json({ error: `Only 1 account allowed per device!` });
        }

        const newUser = {
            username, password, device_id,
            credits: 2, plan: "Trial", is_pro: false,
            account_status: "Active", created_at: new Date().toISOString()
        };
        db.users[username] = newUser;
        await writeDB(db);
        
        const { password: _, ...userSafeData } = newUser;
        return res.json(userSafeData);
    } catch (e) {
        return res.status(500).json({ error: e.message || "Registration failed" });
    }
});

// 2. LOGIN USER (Supports both GET & POST)
app.all('/api/auth/login', async (req, res) => {
    try {
        const data = getRequestData(req);
        const username = data.username ? String(data.username).trim() : '';
        const password = data.password ? String(data.password).trim() : '';
        const device_id = data.device_id ? String(data.device_id).trim() : '';

        if (!username || !password || !device_id) {
            return res.status(400).json({ error: "Required fields missing in URL" });
        }

        const db = await readDB();
        const user = findUser(db, username);

        if (!user) return res.status(404).json({ error: "User not found" });
        if (user.password !== password) return res.status(401).json({ error: "Incorrect password" });
        if (user.account_status === "Blocked") return res.status(403).json({ error: "Account is Blocked by Admin." });

        if (!user.device_id || user.device_id === "") {
            user.device_id = device_id;
            await writeDB(db);
        } else if (user.device_id !== device_id) {
            return res.status(403).json({ error: "Device Locked! Account belongs to another phone." });
        }

        const { password: _, ...userSafeData } = user;
        return res.json(userSafeData);
    } catch (e) {
        return res.status(500).json({ error: e.message || "Login failed" });
    }
});

// 3. DEDUCT CREDIT (Supports both GET & POST)
app.all('/api/deduct', async (req, res) => {
    try {
        const data = getRequestData(req);
        const username = data.username ? String(data.username).trim() : '';
        const db = await readDB();
        const user = findUser(db, username);

        if (!user) return res.status(404).json({ error: "User not found" });
        if (user.account_status === "Blocked") return res.status(403).json({ error: "Blocked." });
        if (user.is_pro) return res.json({ success: true, credits: user.credits, message: "PRO User" });

        if (user.credits > 0) {
            user.credits -= 1;
            await writeDB(db);
            return res.json({ success: true, credits: user.credits });
        } else {
            return res.status(400).json({ error: "0 Credits." });
        }
    } catch (e) {
        return res.status(500).json({ error: e.message || "Deduct failed" });
    }
});

// ADMIN PANEL APIS
const ADMIN_PASSWORD = "admin";
function requireAdminAuth(req, res, next) {
    const pass = req.headers['x-admin-password'] || req.query.admin_pass;
    if (pass === ADMIN_PASSWORD) next();
    else res.status(401).json({ error: "Unauthorized. Incorrect Admin Password." });
}

app.get('/api/admin/users', requireAdminAuth, async (req, res) => {
    const db = await readDB();
    res.json(db.users);
});
app.post('/api/admin/create', requireAdminAuth, async (req, res) => {
    // Keep Admin creations as POST
    const { username, password, credits, plan, is_pro, account_status, device_id } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: "Username and password required" });
    const db = await readDB();
    if (findUser(db, username)) return res.status(400).json({ error: "Username already exists" });
    const newUser = {
        username: String(username).trim(), password: String(password).trim(),
        device_id: device_id ? String(device_id).trim() : "",
        credits: credits !== undefined ? Number(credits) : 2, plan: plan || "Trial",
        is_pro: String(is_pro) === "true", account_status: account_status || "Active",
        created_at: new Date().toISOString()
    };
    db.users[newUser.username] = newUser;
    await writeDB(db);
    res.json({ success: true, message: "User created successfully!", user: newUser });
});

if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
}
module.exports = app;
