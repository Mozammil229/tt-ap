/**
 * ============================================================================
 * KAMAAL STUDIO - ENTERPRISE BACKEND SERVER
 * ============================================================================
 * Features:
 * - 1-Device = 1-Account Hardware Binding & Lock Management
 * - Pre-Patch Server-Side Credit Authorization (/api/authorize-patch)
 * - Dynamic Gemini AI Video Optimizer Proxy & Custom System Prompt (/api/ai/*)
 * - Full Admin Control Hub & REST APIs (/api/admin/*)
 * - Glassmorphic Tailwind Admin Dashboard (/admin)
 * ============================================================================
 */

require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/auth');
const patchRoutes = require('./routes/patch');
const aiRoutes = require('./routes/ai');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/kamaal_studio';

// Core Middlewares
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-key']
}));
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Serve Admin Dashboard (Accessible at both /admin and /)
app.get(['/admin', '/dashboard'], (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// Mount Modular API Routes
app.use('/api/auth', authRoutes);
app.use('/api', patchRoutes);        // Exposes POST /api/authorize-patch
app.use('/api/ai', aiRoutes);          // Exposes POST /api/ai/chat, GET /api/ai/system-prompt
app.use('/api/admin', adminRoutes);    // Exposes /api/admin/users, /api/admin/system-prompt, etc.

// Server Health & Status endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'online',
        service: 'Kamaal Studio Enterprise Backend',
        version: '3.2.0',
        mongoConnected: mongoose.connection.readyState === 1,
        timestamp: new Date().toISOString()
    });
});

// Root route redirect or status
app.get('/', (req, res) => {
    const accept = req.headers.accept || '';
    if (accept.includes('text/html')) {
        return res.sendFile(path.join(__dirname, 'admin.html'));
    }
    return res.json({
        service: 'Kamaal Studio API',
        status: 'active',
        version: '3.2.0',
        adminPanel: '/admin'
    });
});

// Database Connection with non-blocking graceful fallback
if (process.env.MONGODB_URI) {
    mongoose.connect(MONGODB_URI, {
        serverSelectionTimeoutMS: 3000
    }).then(() => {
        console.log('✅ MongoDB connected successfully to database.');
    }).catch((err) => {
        console.warn(`⚠️ MongoDB connection skipped (${err.message}). In-memory & JSON config active.`);
    });
} else {
    console.log('ℹ️ MONGODB_URI not set; using persistent local storage and in-memory ledger.');
}

// Global 404 Handler for API
app.use('/api/*', (req, res) => {
    res.status(404).json({
        success: false,
        error: `Endpoint '${req.originalUrl}' not found on Kamaal Studio server.`
    });
});

// Global Error Handler
app.use((err, req, res, next) => {
    console.error('Unhandled server error:', err);
    res.status(500).json({
        success: false,
        error: err.message || 'Internal Server Error'
    });
});

// Start Server when run directly (node server.js)
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`🌊 Kamaal Studio Backend active on port ${PORT}`);
        console.log(`🔒 Hardware Lock & Pre-Patch Credit Authorization enabled`);
        console.log(`🤖 AI Chatbot Dynamic System Prompt enabled`);
        console.log(`📊 Admin Panel live at http://localhost:${PORT}/admin`);
    });
}

// Export app instance for Vercel / serverless environments
module.exports = app;
