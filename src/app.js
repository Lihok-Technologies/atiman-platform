/**
 * Atiman Application
 * Main Express application setup
 */

const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const expressLayouts = require('express-ejs-layouts');
require('dotenv').config();

const routes = require('./routes');
const { errorHandler, notFound } = require('./middleware/error-handler');
const { testConnection } = require('./config/database');
const { optionalAuth } = require('./middleware/auth');

const app = express();

const trustProxy = process.env.TRUST_PROXY;
if (trustProxy === 'loopback' || /^\d+$/.test(trustProxy || '')) {
  app.set('trust proxy', trustProxy === 'loopback' ? 'loopback' : Number(trustProxy));
}

// View engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

// Layouts setup
app.use(expressLayouts);
app.set('layout', false); // Disable default layout

// Middleware
app.use(express.json({ limit: process.env.REQUEST_BODY_LIMIT || '1mb' }));
app.use(express.urlencoded({ extended: true, limit: process.env.REQUEST_BODY_LIMIT || '1mb' }));
app.use(cookieParser());

// Static files with cache-busting in development
const staticOptions = process.env.NODE_ENV === 'production' 
  ? { maxAge: '1d' } 
  : { maxAge: 0, etag: false };
app.use(express.static(path.join(__dirname, '../public'), staticOptions));
app.use('/import-templates', express.static(path.join(__dirname, '../import-templates')));

// Disable caching for HTML/EJS views in development
app.use((req, res, next) => {
  if (process.env.NODE_ENV !== 'production') {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});

// CORS: only explicitly trusted browser origins may make credentialed requests.
// Same-origin requests do not need CORS headers. Only actual CORS preflights
// (OPTIONS with Origin and Access-Control-Request-Method) are intercepted.
const allowedCorsOrigins = new Set(
  (process.env.CORS_ALLOWED_ORIGINS || process.env.CORS_ORIGIN || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  const isAllowedOrigin = origin && allowedCorsOrigins.has(origin);
  const isCorsPreflight = req.method === 'OPTIONS' && origin && req.headers['access-control-request-method'];

  if (isAllowedOrigin) {
    res.header('Access-Control-Allow-Origin', origin);
    res.vary('Origin');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  }

  if (isCorsPreflight) {
    return isAllowedOrigin ? res.sendStatus(204) : res.sendStatus(403);
  }

  next();
});

// Request logger
app.use((req, res, next) => {
  if (req.originalUrl !== '/favicon.ico') {
    console.log('[REQ]', req.method, req.originalUrl);
  }
  next();
});

// API routes
app.use('/api', routes);
console.log('[APP] Routes mounted at /api');

// Atiman-native application shell (ATM-002-I1). Task-first work navigation,
// capability-composed, and independent of the legacy mobile router.
app.use('/atiman', require('./routes/atiman.routes'));

// Mobile UI routes (separate from API)
app.use('/mobile', require('./routes/mobile.routes'));

// Web routes - apply optional auth to set req.user
app.use(optionalAuth);

// Web routes (render views)
app.get('/', (req, res) => {
  res.render('index', { 
    title: 'Atiman',
    user: req.user 
  });
});

app.get('/login', (req, res) => {
  res.render('login', { 
    title: 'Login - Atiman',
    error: null 
  });
});

app.get('/signup', (req, res) => {
  res.render('signup', { 
    title: 'Sign Up - Atiman',
    error: null 
  });
});

// ========================================
// ODM DUPLICATE UI REDIRECTS (to Mobile App)
// These routes redirect to /mobile/* equivalents
// Old views archived in /archive/views/
// ========================================

// ATM-002-I1 entry-point reconciliation: Today is the canonical authenticated
// work entry. The legacy Today and home entries redirect to it so there is one
// landing concept and existing bookmarks keep working.
app.get('/today', require('./routes/atiman.routes'));
app.get('/dashboard', (req, res) => res.redirect('/mobile/dashboard'));
app.get('/work-orders', (req, res) => res.redirect('/mobile/work-orders'));
app.get('/work-orders/:id', (req, res) => res.redirect(`/mobile/work-orders/${req.params.id}`));
app.get('/equipment', (req, res) => res.redirect('/mobile/equipment'));
app.get('/profile', (req, res) => res.redirect('/mobile/profile'));
app.get('/inspection/:workOrderId', (req, res) => res.redirect(`/mobile/inspection/${req.params.workOrderId}`));

// Admin route protection middleware
const requireAdminWeb = (req, res, next) => {
  if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'supervisor')) {
    return res.redirect('/mobile/today');
  }
  next();
};

// ========================================
// ADMIN DUPLICATE UI REDIRECTS (to Mobile App)
// Old admin views archived in /archive/views/admin/
// ========================================

app.get('/admin', requireAdminWeb, (req, res) => res.redirect('/mobile/admin'));
app.get('/admin/equipment', requireAdminWeb, (req, res) => res.redirect('/mobile/admin/assets'));
app.get('/admin/tasks', requireAdminWeb, (req, res) => res.redirect('/mobile/admin/templates'));
app.get('/admin/schedules', requireAdminWeb, (req, res) => res.redirect('/mobile/calendar'));
app.get('/admin/reports', requireAdminWeb, (req, res) => res.redirect('/mobile/dashboard'));
app.get('/admin/facilities', requireAdminWeb, (req, res) => res.redirect('/mobile/admin/facilities'));
app.get('/admin/users', requireAdminWeb, (req, res) => res.redirect('/mobile/admin'));

// Health check alias (not just under /api)
app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'API is running',
    timestamp: new Date().toISOString()
  });
});

// Favicon handler - prevents 404 errors from browser requests
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Error handling
app.use(notFound);
app.use(errorHandler);

// Initialize database connection
testConnection();

module.exports = app;
