const express = require('express');
const path = require('path');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
app.use(express.json());
app.use(cors());
app.options('*', cors());

app.use(express.static(path.join(__dirname, 'publicm')));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'publicm', 'admin.html'));
});

// ==========================================
// 1. MONGODB CONNECTION
// ==========================================
const MONGO_URI = process.env.MONGODB_URI; // NOTE: ab sirf env var se aayega, hardcode hata di

let cached = global.mongoose;
if (!cached) cached = global.mongoose = { conn: null, promise: null };
async function connectToDatabase() {
  if (cached.conn) return cached.conn;
  if (!cached.promise) {
    cached.promise = mongoose.connect(MONGO_URI, { bufferCommands: false }).then((m) => {
      console.log("✅ MongoDB Connected!");
      return m;
    }).catch(err => { console.log("❌ MongoDB Error:", err.message); throw err; });
  }
  cached.conn = await cached.promise;
  return cached.conn;
}

// ==========================================
// 2. SCHEMAS
// ==========================================
const userSchema = new mongoose.Schema({
    name: { type: String, default: "" },
    username: { type: String, required: true, unique: true, trim: true, lowercase: true },
    password: { type: String, required: true },
    phone_number: { type: String, default: "" },
    device_id: { type: String, default: "" },
    credits: { type: Number, default: 2 },
    plan: { type: String, default: "Trial" },
    is_pro: { type: Boolean, default: false },
    account_status: { type: String, default: "Active" }
}, { timestamps: { createdAt: 'created_at', updatedAt: false } });
const User = mongoose.models.User || mongoose.model('User', userSchema);

const notificationSchema = new mongoose.Schema({
    target: { type: String, required: true, lowercase: true, trim: true }, // "all" ya specific username
    title: { type: String, required: true },
    message: { type: String, required: true },
    read_by: { type: [String], default: [] }
}, { timestamps: { createdAt: 'created_at', updatedAt: false } });
const Notification = mongoose.models.Notification || mongoose.model('Notification', notificationSchema);

const supportMessageSchema = new mongoose.Schema({
    username: { type: String, required: true, lowercase: true, trim: true },
    sender: { type: String, required: true, enum: ['user', 'admin'] },
    message: { type: String, required: true },
    read_by_admin: { type: Boolean, default: false },
    read_by_user: { type: Boolean, default: false }
}, { timestamps: { createdAt: 'created_at', updatedAt: false } });
const SupportMessage = mongoose.models.SupportMessage || mongoose.model('SupportMessage', supportMessageSchema);

function getRequestData(req) {
    return { ...req.query, ...req.body };
}

// ==========================================
// 3. AUTH ROUTES
// ==========================================

// REGISTER (name + username + password + confirm_password + phone_number)
app.all('/api/auth/register', async (req, res) => {
    try {
        await connectToDatabase();
        const data = getRequestData(req);
        const name = data.name ? String(data.name).trim() : '';
        const username = data.username ? String(data.username).trim().toLowerCase() : '';
        const password = data.password ? String(data.password).trim() : '';
        const confirm_password = data.confirm_password ? String(data.confirm_password).trim() : '';
        const phone_number = data.phone_number ? String(data.phone_number).trim() : '';
        const device_id = data.device_id ? String(data.device_id).trim() : '';

        if (!name || !username || !password || !confirm_password || !phone_number || !device_id) {
            return res.status(400).json({ error: "Sab fields required hain (name, username, password, confirm_password, phone_number)" });
        }
        if (password !== confirm_password) {
            return res.status(400).json({ error: "Password aur Confirm Password match nahi ho rahe" });
        }
        if (password.length < 4) {
            return res.status(400).json({ error: "Password kam se kam 4 characters ka ho" });
        }

        const existingUser = await User.findOne({ username });
        if (existingUser) return res.status(400).json({ error: "Username already exists." });

        const existingDeviceUser = await User.findOne({ device_id });
        if (existingDeviceUser && device_id !== "") {
            return res.status(400).json({ error: "Only 1 account allowed per device!" });
        }

        const newUser = new User({ name, username, password, phone_number, device_id, credits: 2, plan: "Trial", is_pro: false, account_status: "Active" });
        await newUser.save();

        const userObj = newUser.toObject();
        delete userObj.password;
        return res.json(userObj);
    } catch (e) {
        return res.status(500).json({ error: e.message || "Registration failed" });
    }
});

// LOGIN
app.all('/api/auth/login', async (req, res) => {
    try {
        await connectToDatabase();
        const data = getRequestData(req);
        const username = data.username ? String(data.username).trim().toLowerCase() : '';
        const password = data.password ? String(data.password).trim() : '';
        const device_id = data.device_id ? String(data.device_id).trim() : '';

        if (!username || !password || !device_id) return res.status(400).json({ error: "Required fields missing" });

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

// ==========================================
// 4. NOTIFICATIONS (App users ke liye — polling + inbox)
// ==========================================

// GET NOTIFICATIONS FOR A USER
app.get('/api/notifications', async (req, res) => {
    try {
        await connectToDatabase();
        const username = req.query.username ? String(req.query.username).trim().toLowerCase() : '';
        if (!username) return res.status(400).json({ error: "username required" });

        const notifications = await Notification.find({
            $or: [{ target: 'all' }, { target: username }]
        }).sort({ created_at: -1 }).limit(100);

        const result = notifications.map(n => ({
            id: n._id,
            title: n.title,
            message: n.message,
            created_at: n.created_at,
            is_read: n.read_by.includes(username)
        }));

        return res.json({ notifications: result, unread_count: result.filter(n => !n.is_read).length });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
});

// MARK NOTIFICATION AS READ
app.post('/api/notifications/read', async (req, res) => {
    try {
        await connectToDatabase();
        const data = getRequestData(req);
        const username = data.username ? String(data.username).trim().toLowerCase() : '';
        const notification_id = data.notification_id;
        if (!username || !notification_id) return res.status(400).json({ error: "username aur notification_id required" });

        await Notification.updateOne({ _id: notification_id }, { $addToSet: { read_by: username } });
        return res.json({ success: true });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
});

// ==========================================
// 5. SUPPORT CHAT (User <-> Admin)
// ==========================================

// USER -> ADMIN MESSAGE
app.post('/api/support/send', async (req, res) => {
    try {
        await connectToDatabase();
        const data = getRequestData(req);
        const username = data.username ? String(data.username).trim().toLowerCase() : '';
        const message = data.message ? String(data.message).trim() : '';
        if (!username || !message) return res.status(400).json({ error: "username aur message required" });

        const user = await User.findOne({ username });
        if (!user) return res.status(404).json({ error: "User not found" });

        const newMsg = new SupportMessage({ username, sender: 'user', message, read_by_user: true, read_by_admin: false });
        await newMsg.save();
        return res.json({ success: true, data: newMsg });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
});

// USER APNI CONVERSATION FETCH KARE
app.get('/api/support/messages', async (req, res) => {
    try {
        await connectToDatabase();
        const username = req.query.username ? String(req.query.username).trim().toLowerCase() : '';
        if (!username) return res.status(400).json({ error: "username required" });

        const messages = await SupportMessage.find({ username }).sort({ created_at: 1 });
        await SupportMessage.updateMany({ username, sender: 'admin', read_by_user: false }, { read_by_user: true });

        return res.json({ messages });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
});

// ==========================================
// 6. ADMIN AUTH + PANEL APIS
// ==========================================
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "*Ptagdam-+"; // env var use karo, weak default sirf fallback
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
    } catch(e) { res.status(500).json({error: e.message}); }
});

app.post('/api/admin/create', requireAdminAuth, async (req, res) => {
    try {
        await connectToDatabase();
        const { name, username, password, credits, plan, is_pro, account_status, device_id, phone_number } = req.body || {};
        if (!username || !password) return res.status(400).json({ error: "Username and password required" });

        const cleanUsername = String(username).trim().toLowerCase();
        const existingUser = await User.findOne({ username: cleanUsername });
        if (existingUser) return res.status(400).json({ error: "Username already exists" });

        const newUser = new User({
            name: name || "", username: cleanUsername, password: String(password).trim(),
            phone_number: phone_number || "",
            device_id: device_id ? String(device_id).trim() : "",
            credits: credits !== undefined ? Number(credits) : 2, plan: plan || "Trial",
            is_pro: String(is_pro) === "true", account_status: account_status || "Active"
        });

        await newUser.save();
        res.json({ success: true, message: "User created successfully!", user: newUser });
    } catch (e) { res.status(500).json({error: e.message}); }
});

app.post('/api/admin/update', requireAdminAuth, async (req, res) => {
    try {
        await connectToDatabase();
        const { username, credits, plan, is_pro, account_status, device_id, password, name, phone_number } = req.body || {};
        if (!username) return res.status(400).json({ error: "Username is required" });

        const cleanUsername = String(username).trim().toLowerCase();
        const user = await User.findOne({ username: cleanUsername });
        if (!user) return res.status(404).json({ error: "User not found" });

        if (name !== undefined) user.name = name;
        if (phone_number !== undefined) user.phone_number = phone_number;
        if (credits !== undefined) user.credits = Number(credits);
        if (plan !== undefined) user.plan = plan;
        if (is_pro !== undefined) user.is_pro = String(is_pro) === "true" || is_pro === true;
        if (account_status !== undefined) user.account_status = account_status;
        if (device_id !== undefined) user.device_id = String(device_id).trim();
        if (password !== undefined && password.trim() !== "") user.password = String(password).trim();

        await user.save();
        res.json({ success: true, message: "User updated successfully!", user });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/delete', requireAdminAuth, async (req, res) => {
    try {
        await connectToDatabase();
        const { username } = req.body || {};
        if (!username) return res.status(400).json({ error: "Username is required" });
        await User.deleteOne({ username: String(username).trim().toLowerCase() });
        res.json({ success: true, message: "User deleted successfully!" });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ADMIN: NOTIFICATION BHEJNA (all users ya specific username)
app.post('/api/admin/notify', requireAdminAuth, async (req, res) => {
    try {
        await connectToDatabase();
        const { target, title, message } = req.body || {};
        if (!title || !message) return res.status(400).json({ error: "Title aur message required hain" });

        const cleanTarget = target ? String(target).trim().toLowerCase() : 'all';
        const newNotif = new Notification({ target: cleanTarget, title, message });
        await newNotif.save();
        return res.json({ success: true, data: newNotif });
    } catch (e) { return res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/notifications', requireAdminAuth, async (req, res) => {
    try {
        await connectToDatabase();
        const notifications = await Notification.find({}).sort({ created_at: -1 }).limit(200);
        return res.json(notifications);
    } catch (e) { return res.status(500).json({ error: e.message }); }
});

// ADMIN: SAB SUPPORT CONVERSATIONS (list, latest message + unread count)
app.get('/api/admin/support', requireAdminAuth, async (req, res) => {
    try {
        await connectToDatabase();
        const conversations = await SupportMessage.aggregate([
            { $sort: { created_at: -1 } },
            { $group: {
                _id: "$username",
                last_message: { $first: "$message" },
                last_sender: { $first: "$sender" },
                last_time: { $first: "$created_at" },
                unread_count: { $sum: { $cond: [{ $and: [{ $eq: ["$sender", "user"] }, { $eq: ["$read_by_admin", false] }] }, 1, 0] } }
            }},
            { $sort: { last_time: -1 } }
        ]);
        return res.json(conversations);
    } catch (e) { return res.status(500).json({ error: e.message }); }
});

// ADMIN: EK USER KI POORI CONVERSATION
app.get('/api/admin/support/:username', requireAdminAuth, async (req, res) => {
    try {
        await connectToDatabase();
        const username = String(req.params.username).trim().toLowerCase();
        const messages = await SupportMessage.find({ username }).sort({ created_at: 1 });
        await SupportMessage.updateMany({ username, sender: 'user', read_by_admin: false }, { read_by_admin: true });
        return res.json(messages);
    } catch (e) { return res.status(500).json({ error: e.message }); }
});

// ADMIN: USER KO REPLY
app.post('/api/admin/support/reply', requireAdminAuth, async (req, res) => {
    try {
        await connectToDatabase();
        const { username, message } = req.body || {};
        if (!username || !message) return res.status(400).json({ error: "username aur message required" });

        const cleanUsername = String(username).trim().toLowerCase();
        const newMsg = new SupportMessage({ username: cleanUsername, sender: 'admin', message, read_by_admin: true, read_by_user: false });
        await newMsg.save();
        return res.json({ success: true, data: newMsg });
    } catch (e) { return res.status(500).json({ error: e.message }); }
});

if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
}
module.exports = app;
