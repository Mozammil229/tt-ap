const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// Safety Body Parser for Vercel Serverless
app.use((req, res, next) => {
    if (typeof req.body === 'string') {
        try {
            req.body = JSON.parse(req.body);
        } catch (e) {
            console.log("Body parse error:", e.message);
        }
    }
    next();
});

// Serve Admin Panel Static Folder
app.use(express.static(path.join(__dirname, 'publicm')));

// Root route directly opens Admin Panel
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'publicm', 'admin.html'));
});

// Vercel /tmp directory for file storage (Read/Write Allowed)
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

const ADMIN_PASSWORD = "admin";

function requireAdminAuth(req, res, next) {
    const pass = req.headers['x-admin-password'];
    if (pass === ADMIN_PASSWORD) {
        next();
    } else {
        res.status(401).json({ error: "Unauthorized. Incorrect Admin Password." });
    }
}

// 1. REGISTER USER (1 Device = 1 Account)
app.post('/api/auth/register', async (req, res) => {
    try {
        const body = req.body || {};
        const username = body.username ? String(body.username).trim() : '';
        const password = body.password ? String(body.password).trim() : '';
        const device_id = body.device_id ? String(body.device_id).trim() : '';

        if (!username || !password || !device_id) {
            return res.status(400).json({ error: "Required fields missing" });
        }

        const db = await readDB();
        if (db.users[username]) {
            return res.status(400).json({ error: "Username already exists." });
        }

        // Check 1 Account Per Device
        const existingDeviceUser = Object.values(db.users).find(u => u.device_id === device_id);
        if (existingDeviceUser) {
            return res.status(400).json({ error: `Only 1 account allowed per device! Registered to: ${existingDeviceUser.username}` });
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

// 2. LOGIN USER (Permanent Device Lock)
app.post('/api/auth/login', async (req, res) => {
    try {
        const body = req.body || {};
        const username = body.username ? String(body.username).trim() : '';
        const password = body.password ? String(body.password).trim() : '';
        const device_id = body.device_id ? String(body.device_id).trim() : '';

        if (!username || !password || !device_id) {
            return res.status(400).json({ error: "Required fields missing" });
        }

        const db = await readDB();
        const user = db.users[username];

        if (!user) return res.status(404).json({ error: "User not found" });
        if (user.password !== password) return res.status(401).json({ error: "Incorrect password" });
        if (user.account_status === "Blocked") return res.status(403).json({ error: "Account is Blocked by Admin." });

        // Bind permanently to first logging phone
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

// 3. DEDUCT CREDIT
app.post('/api/deduct', async (req, res) => {
    try {
        const { username } = req.body || {};
        const db = await readDB();
        const user = db.users[username];

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
app.get('/api/admin/users', requireAdminAuth, async (req, res) => {
    const db = await readDB();
    res.json(db.users);
});

app.post('/api/admin/create', requireAdminAuth, async (req, res) => {
    const { username, password, credits, plan, is_pro, account_status, device_id } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: "Username and password required" });

    const db = await readDB();
    if (db.users[username]) return res.status(400).json({ error: "Username already exists" });

    const newUser = {
        username, password,
        device_id: device_id || "",
        credits: credits !== undefined ? Number(credits) : 2,
        plan: plan || "Trial",
        is_pro: String(is_pro) === "true",
        account_status: account_status || "Active",
        created_at: new Date().toISOString()
    };

    db.users[username] = newUser;
    await writeDB(db);
    res.json({ success: true, message: "User created successfully!", user: newUser });
});

app.post('/api/admin/update', requireAdminAuth, async (req, res) => {
    const { username, password, credits, plan, is_pro, account_status, device_id } = req.body || {};
    const db = await readDB();
    if (!db.users[username]) return res.status(404).json({ error: "User not found" });

    let user = db.users[username];
    if (password) user.password = password;
    if (credits !== undefined) user.credits = Number(credits);
    if (plan !== undefined) user.plan = plan;
    if (is_pro !== undefined) user.is_pro = String(is_pro) === "true"; 
    if (account_status !== undefined) user.account_status = account_status;
    if (device_id !== undefined) user.device_id = device_id;
    
    await writeDB(db);
    res.json({ success: true });
});

app.post('/api/admin/delete', requireAdminAuth, async (req, res) => {
    const { username } = req.body || {};
    const db = await readDB();
    if (!db.users[username]) return res.status(404).json({ error: "User not found" });

    delete db.users[username];
    await writeDB(db);
    res.json({ success: true, message: `User ${username} deleted` });
});

if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
}

module.exports = app;
