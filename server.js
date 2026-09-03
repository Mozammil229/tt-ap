const express = require('express');
const path = require('path');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
app.use(express.json());
app.use(cors());

// Handle CORS Preflight
app.options('*', cors());

// Serve Admin Panel Static Folder
app.use(express.static(path.join(__dirname, 'publicm')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'publicm', 'admin.html'));
});

// ==========================================
// 1. MONGODB CONNECTION (Vercel Fix)
// ==========================================
const MONGO_URI = process.env.MONGODB_URI || "mongodb+srv://pukathub_db_user:AWiAL8UUwrOQ6h33@cluster0.y2lzfvn.mongodb.net/MyUsersDB?retryWrites=true&w=majority";

// Vercel cache connection fix
let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

async function connectToDatabase() {
  if (cached.conn) {
    return cached.conn;
  }

  if (!cached.promise) {
    const opts = {
      bufferCommands: false,
    };

    cached.promise = mongoose.connect(MONGO_URI, opts).then((mongoose) => {
      console.log("✅ Successfully Connected to MongoDB!");
      return mongoose;
    }).catch(err => {
      console.log("❌ MongoDB Connection Error:", err.message);
      throw err;
    });
  }
  cached.conn = await cached.promise;
  return cached.conn;
}


// ==========================================
// 2. USER DATABASE SCHEMA (Design)
// ==========================================
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, trim: true, lowercase: true },
    password: { type: String, required: true },
    device_id: { type: String, default: "" },
    credits: { type: Number, default: 2 },
    plan: { type: String, default: "Trial" },
    is_pro: { type: Boolean, default: false },
    account_status: { type: String, default: "Active" }
}, { timestamps: { createdAt: 'created_at', updatedAt: false } });

const User = mongoose.models.User || mongoose.model('User', userSchema);


// ==========================================
// 3. API ROUTES
// ==========================================

function getRequestData(req) {
    return { ...req.query, ...req.body };
}

// REGISTER USER
app.all('/api/auth/register', async (req, res) => {
    try {
        await connectToDatabase(); // Ensure DB is connected before query
        const data = getRequestData(req);
        const username = data.username ? String(data.username).trim().toLowerCase() : '';
        const password = data.password ? String(data.password).trim() : '';
        const device_id = data.device_id ? String(data.device_id).trim() : '';

        if (!username || !password || !device_id) {
            return res.status(400).json({ error: "Required fields missing" });
        }

        const existingUser = await User.findOne({ username });
        if (existingUser) {
            return res.status(400).json({ error: "Username already exists." });
        }

        const existingDeviceUser = await User.findOne({ device_id });
        if (existingDeviceUser && device_id !== "") {
            return res.status(400).json({ error: `Only 1 account allowed per device!` });
        }

        const newUser = new User({
            username, password, device_id,
            credits: 2, plan: "Trial", is_pro: false, account_status: "Active"
        });

        await newUser.save();
        
        const userObj = newUser.toObject();
        delete userObj.password;
        return res.json(userObj);
    } catch (e) {
        return res.status(500).json({ error: e.message || "Registration failed" });
    }
});

// LOGIN USER
app.all('/api/auth/login', async (req, res) => {
    try {
        await connectToDatabase();
        const data = getRequestData(req);
        const username = data.username ? String(data.username).trim().toLowerCase() : '';
        const password = data.password ? String(data.password).trim() : '';
        const device_id = data.device_id ? String(data.device_id).trim() : '';

        if (!username || !password || !device_id) {
            return res.status(400).json({ error: "Required fields missing" });
        }

        const user = await User.findOne({ username });

        if (!user) return res.status(404).json({ error: "User not found" });
        if (user.password !== password) return res.status(401).json({ error: "Incorrect password" });
        if (user.account_status === "Blocked") return res.status(403).json({ error: "Account is Blocked by Admin." });

        if (!user.device_id || user.device_id === "") {
            user.device_id = device_id;
            await user.save();
        } else if (user.device_id !== device_id) {
            return res.status(403).json({ error: "Device Locked! Account belongs to another phone." });
        }

        const userObj = user.toObject();
        delete userObj.password;
        return res.json(userObj);
    } catch (e) {
        return res.status(500).json({ error: e.message || "Login failed" });
    }
});

// DEDUCT CREDIT
app.all('/api/deduct', async (req, res) => {
    try {
        await connectToDatabase();
        const data = getRequestData(req);
        const username = data.username ? String(data.username).trim().toLowerCase() : '';
        const user = await User.findOne({ username });

        if (!user) return res.status(404).json({ error: "User not found" });
        if (user.account_status === "Blocked") return res.status(403).json({ error: "Blocked." });
        if (user.is_pro) return res.json({ success: true, credits: user.credits, message: "PRO User" });

        if (user.credits > 0) {
            user.credits -= 1;
            await user.save();
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
    try {
        await connectToDatabase();
        const users = await User.find({});
        const userMap = {};
        users.forEach(u => { userMap[u.username] = u; });
        res.json(userMap);
    } catch(e) {
        res.status(500).json({error: e.message});
    }
});

app.post('/api/admin/create', requireAdminAuth, async (req, res) => {
    try {
        await connectToDatabase();
        const { username, password, credits, plan, is_pro, account_status, device_id } = req.body || {};
        if (!username || !password) return res.status(400).json({ error: "Username and password required" });
        
        const cleanUsername = String(username).trim().toLowerCase();
        const existingUser = await User.findOne({ username: cleanUsername });
        if (existingUser) return res.status(400).json({ error: "Username already exists" });
        
        const newUser = new User({
            username: cleanUsername, password: String(password).trim(),
            device_id: device_id ? String(device_id).trim() : "",
            credits: credits !== undefined ? Number(credits) : 2, plan: plan || "Trial",
            is_pro: String(is_pro) === "true", account_status: account_status || "Active"
        });
        
        await newUser.save();
        res.json({ success: true, message: "User created successfully!", user: newUser });
    } catch (e) {
        res.status(500).json({error: e.message});
    }
});

// Start Server
if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
}
module.exports = app;
