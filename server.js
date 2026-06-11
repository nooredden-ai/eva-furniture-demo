require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const multer = require('multer');

const productRepository = require('./backend/src/repositories/productRepository');
const categoryRepository = require('./backend/src/repositories/categoryRepository');
const orderRepository = require('./backend/src/repositories/orderRepository');
const userRepository = require('./backend/src/repositories/userRepository');
const couponRepository = require('./backend/src/repositories/couponRepository');
const settingsRepository = require('./backend/src/repositories/settingsRepository');
const permissionRepository = require('./backend/src/repositories/permissionRepository');
const jsonStore = require('./backend/src/core/jsonStore');
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');

const prisma = new PrismaClient();

let puppeteer = null;
try {
  puppeteer = require('puppeteer');
} catch (error) {
  console.warn('Puppeteer is not installed. PDF generation will be disabled.');
}

// ===== Crash Protection (Light Only) =====
process.on('uncaughtException', (err) => {
  console.error('[FATAL ERROR] Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL ERROR] Unhandled Rejection at:', promise, 'reason:', reason);
});

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ===== Optional Basic Auth for admin page =====
function basicAuthMiddleware(req, res, next) {
  try {
    if (req.path === '/admin.html') {
      const ADMIN_USER = process.env.ADMIN_USER || '';
      const ADMIN_PASS = process.env.ADMIN_PASS || '';
      // If not configured, do not require auth
      if (!ADMIN_USER) return next();

      const authHeader = req.headers.authorization || '';
      if (!authHeader.startsWith('Basic ')) {
        res.set('WWW-Authenticate', 'Basic realm="Admin"');
        return res.status(401).send('Authentication required.');
      }
      const base64 = authHeader.split(' ')[1] || '';
      const [user, pass] = Buffer.from(base64, 'base64').toString().split(':');
      if (user === ADMIN_USER && pass === ADMIN_PASS) return next();
      res.set('WWW-Authenticate', 'Basic realm="Admin"');
      return res.status(401).send('Authentication required.');
    }
  } catch (e) {
    // fallback to next on error
    return next();
  }
  return next();
}
app.use(basicAuthMiddleware);

// ===== UTF-8 Charset Headers (Arabic text fix) =====
app.use((req, res, next) => {
  if (req.path.endsWith('.html')) res.type('text/html; charset=utf-8');
  if (req.path.endsWith('.css'))  res.type('text/css; charset=utf-8');
  if (req.path.endsWith('.js'))   res.type('application/javascript; charset=utf-8');
  if (req.path.endsWith('.json')) res.type('application/json; charset=utf-8');
  next();
});// ===== Hybrid JWT Authentication Middleware =====
app.use(async (req, res, next) => {
  const authHeader = req.headers.authorization;
  const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-key';

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = {
        userId: decoded.userId,
        role: decoded.role,
        companyId: decoded.companyId
      };
      return next();
    } catch (err) {
      console.error('JWT verification failed:', err.message);
      return res.status(401).json({ success: false, message: 'Unauthorized: Invalid token' });
    }
  }

  // TODO: remove x-user-role fallback after frontend migration.
  const oldRole = req.headers['x-user-role'];
  if (oldRole) {
    let companyId = null;
    try {
      const company = await prisma.company.findFirst();
      if (company) companyId = company.id;
    } catch (e) {}

    req.user = {
      userId: null,
      role: oldRole,
      companyId: companyId
    };
  }

  next();
});


// ===== Ensure upload folders exist (SAFE) =====
const UPLOAD_DIR_PRODUCTS = path.join(__dirname, 'images', 'products');
const UPLOAD_DIR_BRANDING = path.join(__dirname, 'images', 'branding');
const UPLOAD_DIR_CATEGORIES = path.join(__dirname, 'images', 'categories');
if (!fs.existsSync(UPLOAD_DIR_PRODUCTS)) {
  fs.mkdirSync(UPLOAD_DIR_PRODUCTS, { recursive: true });
  console.log('📁 Created upload folder: images/products/');
}
if (!fs.existsSync(UPLOAD_DIR_BRANDING)) {
  fs.mkdirSync(UPLOAD_DIR_BRANDING, { recursive: true });
  console.log('📁 Created upload folder: images/branding/');
}
if (!fs.existsSync(UPLOAD_DIR_CATEGORIES)) {
  fs.mkdirSync(UPLOAD_DIR_CATEGORIES, { recursive: true });
  console.log('📁 Created upload folder: images/categories/');
}

// ===== Data helpers =====
const DATA_DIR = path.join(__dirname, 'data');
const PDF_STORAGE_DIR = path.join(__dirname, 'storage', 'pdfs');
const PUPPETEER_TIMEOUT = parseInt(process.env.PUPPETEER_TIMEOUT || '30000', 10);

function ensureDirectory(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
ensureDirectory(PDF_STORAGE_DIR);

function readJSON(filename) {
  return jsonStore.readJsonFile(filename);
}

function writeJSON(filename, data) {
  return jsonStore.writeJsonFile(filename, data);
}

function findOrderByIdOrNumber(orders, identifier) {
  const key = identifier !== undefined ? identifier : orders;
  return orderRepository.findByIdOrNumber(key);
}

async function createPdfFromPrintPage({ ids, type = 'invoice', saveToDisk = false, filename = null, port }) {
  if (!puppeteer) {
    throw new Error('Puppeteer is not available.');
  }
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 900 });
    const orderIds = ids.map(i => encodeURIComponent(i)).join(',');
    const printUrl = `http://127.0.0.1:${port}/print-order?ids=${orderIds}&type=${encodeURIComponent(type)}`;

    await page.goto(printUrl, {
      waitUntil: 'networkidle2',
      timeout: PUPPETEER_TIMEOUT,
    });
    await page.emulateMediaType('print');

    try {
      await page.waitForFunction('window.printOrderReady === true', { timeout: 10000 });
    } catch (err) {
      console.warn('[PDF] printOrderReady not detected in time, continuing anyway');
    }

    await page.waitForTimeout(600);

    const pdfOptions = {
      printBackground: true,
      preferCSSPageSize: true,
    };

    if (type === 'invoice' || type === 'packing') {
      pdfOptions.format = 'A4';
      pdfOptions.margin = { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' };
    } else if (type === 'label') {
      pdfOptions.width = '80mm';
      pdfOptions.margin = { top: '4mm', bottom: '4mm', left: '4mm', right: '4mm' };
    } else {
      pdfOptions.format = 'A4';
      pdfOptions.margin = { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' };
    }

    const buffer = await page.pdf(pdfOptions);
    if (saveToDisk && filename) {
      const safeName = filename.replace(/[\\/\s]+/g, '-').replace(/[^a-zA-Z0-9_.-]/g, '');
      const targetPath = path.join(PDF_STORAGE_DIR, safeName);
      fs.writeFileSync(targetPath, buffer);
      return { buffer, savedPath: targetPath };
    }
    return { buffer };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

function ensureBrandingFilesExist() {
  const settings = settingsRepository.findAll();
  const store = Array.isArray(settings) ? settings[0] : settings;
  if (!store || !store.branding) return;
  const assets = [];
  const b = store.branding;
  if (b.logo) assets.push(b.logo);
  if (b.favicon) assets.push(b.favicon);
  if (Array.isArray(b.heroBanners)) assets.push(...b.heroBanners);
  if (Array.isArray(b.promoBanners)) assets.push(...b.promoBanners);

  assets.forEach(assetPath => {
    if (!assetPath || !assetPath.startsWith('/images/branding/')) return;
    const fileName = path.basename(assetPath);
    const brandingPath = path.join(__dirname, 'images', 'branding', fileName);
    if (fs.existsSync(brandingPath)) return;

    const candidateDirs = ['products', 'categories'];
    for (const folder of candidateDirs) {
      const sourcePath = path.join(__dirname, 'images', folder, fileName);
      if (fs.existsSync(sourcePath)) {
        fs.copyFileSync(sourcePath, brandingPath);
        console.log(`🔁 Copied branding asset from images/${folder} to images/branding: ${fileName}`);
        break;
      }
    }
  });
}

ensureBrandingFilesExist();

// ===== Multer Storage Config =====
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (req.body.type === 'branding') {
      cb(null, UPLOAD_DIR_BRANDING);
    } else if (req.body.type === 'category') {
      cb(null, UPLOAD_DIR_CATEGORIES);
    } else {
      cb(null, UPLOAD_DIR_PRODUCTS);
    }
  },
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${safeName}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  }
});

// ===== Backend RBAC (Safe Perm Enforcement) =====

const DEFAULT_PERMISSIONS = {
  super_admin: [
    "view_products", "add_products", "edit_products", "delete_products",
    "view_categories", "manage_categories",
    "view_orders", "update_orders", "delete_orders", "add_order_notes",
    "view_coupons", "manage_coupons",
    "view_customers", "manage_customers",
    "view_users", "add_users", "edit_users", "delete_users", "manage_roles_permissions",
    "view_settings", "edit_store_info", "edit_branding", "edit_theme", "edit_colors", "edit_payment_settings", "edit_shipping_settings", "edit_legal_pages",
    "view_dashboard", "view_analytics"
  ],
  store_owner: [
    "view_dashboard", "view_analytics",
    "view_products", "add_products", "edit_products", "delete_products",
    "view_categories", "manage_categories",
    "view_orders", "update_orders", "delete_orders", "add_order_notes",
    "view_coupons", "manage_coupons",
    "view_customers", "manage_customers",
    "view_settings", "edit_store_info", "edit_branding", "edit_legal_pages"
  ],
  store_manager: [
    "view_dashboard", "view_analytics",
    "view_products", "add_products", "edit_products", "delete_products",
    "view_categories", "manage_categories",
    "view_orders", "update_orders", "delete_orders", "add_order_notes",
    "view_coupons", "manage_coupons",
    "view_customers", "manage_customers",
    "view_settings", "edit_store_info", "edit_branding", "edit_legal_pages"
  ],
  manager: [
    "view_dashboard", "view_analytics",
    "view_products", "add_products", "edit_products", "delete_products",
    "view_categories", "manage_categories",
    "view_orders", "update_orders", "add_order_notes",
    "view_coupons", "manage_coupons",
    "view_customers"
  ],
  employee: [
    "view_products", "view_categories", "view_coupons",
    "view_orders", "update_orders", "add_order_notes"
  ],
  support_agent: [
    "view_orders", "add_order_notes",
    "view_customers"
  ]
};

function getActivePermissions() {
  try {
    let data = permissionRepository.findAll();
    if (!data || Object.keys(data).length === 0) {
      data = { ...DEFAULT_PERMISSIONS };
      permissionRepository.saveAll(data);
    }
    data.super_admin = [...DEFAULT_PERMISSIONS.super_admin];
    return data;
  } catch (e) {
    console.error('Error reading permissions file:', e);
    return DEFAULT_PERMISSIONS;
  }
}

function requirePerm(perm) {
  return (req, res, next) => {
    const role = req.user ? req.user.role : null;
    if (!role) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    const currentPerms = getActivePermissions();
    const rolePerms = currentPerms[role] || DEFAULT_PERMISSIONS[role] || [];
    
    // super_admin always has everything, or check explicit perm
    if (role === 'super_admin' || rolePerms.includes(perm)) {
      return next();
    }
    return res.status(403).json({ success: false, message: 'Forbidden' });
  };
}

// ===== Countries (static) =====
const COUNTRIES = [
  { code: 'PS', name: 'فلسطين',               flag: '🇵🇸', currency: 'ILS', currencySymbol: '₪',  currencyName: 'شيكل إسرائيلي جديد' },
  { code: 'SA', name: 'المملكة العربية السعودية', flag: '🇸🇦', currency: 'SAR', currencySymbol: 'ر.س', currencyName: 'ريال سعودي' },
  { code: 'AE', name: 'الإمارات العربية المتحدة', flag: '🇦🇪', currency: 'AED', currencySymbol: 'د.إ', currencyName: 'درهم إماراتي' },
  { code: 'JO', name: 'الأردن',                flag: '🇯🇴', currency: 'JOD', currencySymbol: 'د.أ', currencyName: 'دينار أردني' },
  { code: 'EG', name: 'مصر',                  flag: '🇪🇬', currency: 'EGP', currencySymbol: 'ج.م', currencyName: 'جنيه مصري' },
  { code: 'KW', name: 'الكويت',               flag: '🇰🇼', currency: 'KWD', currencySymbol: 'د.ك', currencyName: 'دينار كويتي' },
  { code: 'QA', name: 'قطر',                  flag: '🇶🇦', currency: 'QAR', currencySymbol: 'ر.ق', currencyName: 'ريال قطري' },
  { code: 'BH', name: 'البحرين',              flag: '🇧🇭', currency: 'BHD', currencySymbol: 'د.ب', currencyName: 'دينار بحريني' },
  { code: 'OM', name: 'عُمان',               flag: '🇴🇲', currency: 'OMR', currencySymbol: 'ر.ع', currencyName: 'ريال عُماني' },
  { code: 'IQ', name: 'العراق',              flag: '🇮🇶', currency: 'IQD', currencySymbol: 'د.ع', currencyName: 'دينار عراقي' },
  { code: 'LB', name: 'لبنان',               flag: '🇱🇧', currency: 'LBP', currencySymbol: 'ل.ل', currencyName: 'ليرة لبنانية' },
  { code: 'MA', name: 'المغرب',              flag: '🇲🇦', currency: 'MAD', currencySymbol: 'د.م', currencyName: 'درهم مغربي' },
  { code: 'TN', name: 'تونس',               flag: '🇹🇳', currency: 'TND', currencySymbol: 'د.ت', currencyName: 'دينار تونسي' },
  { code: 'DZ', name: 'الجزائر',             flag: '🇩🇿', currency: 'DZD', currencySymbol: 'د.ج', currencyName: 'دينار جزائري' },
  { code: 'TR', name: 'تركيا',               flag: '🇹🇷', currency: 'TRY', currencySymbol: '₺',  currencyName: 'ليرة تركية' },
  { code: 'US', name: 'الولايات المتحدة',    flag: '🇺🇸', currency: 'USD', currencySymbol: '$',  currencyName: 'دولار أمريكي' },
  { code: 'GB', name: 'المملكة المتحدة',     flag: '🇬🇧', currency: 'GBP', currencySymbol: '£',  currencyName: 'جنيه إسترليني' },
  { code: 'EU', name: 'منطقة اليورو',        flag: '🇪🇺', currency: 'EUR', currencySymbol: '€',  currencyName: 'يورو' },
];

// Ensure orders.json exists
if (!fs.existsSync(path.join(DATA_DIR, 'orders.json'))) {
  writeJSON('orders.json', [
    {
      id: 'ORD-001', customer: 'فاطمة أحمد', phone: '0512345678',
      items: [{ name: 'كريم مضيء للوجه', emoji: '✨', qty: 2 }, { name: 'أحمر شفاه مطفي', emoji: '💄', qty: 1 }],
      total: 223, status: 'pending', date: '2026-05-20'
    },
    {
      id: 'ORD-002', customer: 'نورة العتيبي', phone: '0598765432',
      items: [{ name: 'عطر الورد الفاخر', emoji: '🌸', qty: 1 }],
      total: 175, status: 'processing', date: '2026-05-19'
    },
    {
      id: 'ORD-003', customer: 'ريم الحربي', phone: '0551234567',
      items: [{ name: 'شامبو الأرغان المغربي', emoji: '💆‍♀️', qty: 3 }],
      total: 174, status: 'delivered', date: '2026-05-18'
    }
  ]);
}

// Ensure coupons.json exists
if (!fs.existsSync(path.join(DATA_DIR, 'coupons.json'))) {
  writeJSON('coupons.json', [
    { code: 'WELCOME10', discountPercent: 10, maxUses: -1, usedCount: 0, active: true, expiryDate: '2026-12-31' },
    { code: 'SUMMER20', discountPercent: 20, maxUses: 100, usedCount: 15, active: true, expiryDate: '2026-08-31' }
  ]);
}

/* =========================
   API: PRODUCTS
========================= */
app.get('/api/products', (req, res) => {
  res.json(productRepository.findAll());
});

app.post('/api/products', requirePerm('add_products'), (req, res) => {
  const newProduct = productRepository.create(req.body);
  res.json(newProduct);
});

app.put('/api/products/:id', requirePerm('edit_products'), (req, res) => {
  const updated = productRepository.update(req.params.id, req.body);
  if (!updated) return res.status(404).json({ error: 'Product not found' });
  res.json(updated);
});

app.delete('/api/products/:id', requirePerm('delete_products'), (req, res) => {
  const deleted = productRepository.delete(req.params.id);
  if (!deleted) return res.status(404).json({ error: 'Product not found' });
  res.json({ ok: true });
});

/* =========================
   API: CATEGORIES
========================= */
app.get('/api/categories', (req, res) => {
  res.json(categoryRepository.findAll());
});

app.post('/api/categories', requirePerm('manage_categories'), (req, res) => {
  const newCategory = categoryRepository.create(req.body);
  res.json(newCategory);
});

app.put('/api/categories/:id', requirePerm('manage_categories'), (req, res) => {
  const updated = categoryRepository.update(req.params.id, req.body);
  if (!updated) return res.status(404).json({ error: 'Category not found' });
  res.json(updated);
});

app.delete('/api/categories/:id', requirePerm('manage_categories'), (req, res) => {
  const deleted = categoryRepository.delete(req.params.id);
  if (!deleted) return res.status(404).json({ error: 'Category not found' });
  res.json({ ok: true });
});

/* =========================
   API: ORDERS
========================= */
app.get('/api/orders', (req, res) => {
  res.json(orderRepository.findAll());
});

// Get single order by ID
app.get('/api/orders/:id', (req, res) => {
  const order = orderRepository.findByIdOrNumber(req.params.id);
  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
  return res.json(order);
});

app.post('/api/orders', (req, res) => {
  try {
    const { customer, phone, address, zone, zoneName, items, subtotal, shipping, total, notes, paymentMethod, couponCode, discount } = req.body;

    if (!customer || !phone || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'بيانات الطلب غير مكتملة' });
    }

    const newOrderPayload = {
      customer,
      phone,
      address: address || '',
      zone: zone || '',
      zoneName: zoneName || '',
      items,
      subtotal: subtotal || 0,
      shipping: shipping || 0,
      discount: discount || 0,
      couponCode: couponCode || '',
      total: total || 0,
      status: 'pending',
      date: new Date().toISOString().split('T')[0],
      notes: notes ? [notes] : [],
      internalComments: [],
      statusHistory: [],
      paymentMethod: paymentMethod || 'cod',
      lastUpdated: new Date().toISOString()
    };

    if (couponCode) {
      const coupon = couponRepository.findByCode(couponCode);
      if (coupon && coupon.maxUses !== 0) {
        if (coupon.maxUses > 0) coupon.usedCount = (coupon.usedCount || 0) + 1;
        couponRepository.saveAll(couponRepository.findAll());
      }
    }

    const newOrder = orderRepository.create(newOrderPayload);
    console.log(`[ORDER] New order created: ${newOrder.id}`);
    res.json({ success: true, data: newOrder, message: 'تم إنشاء الطلب بنجاح' });
  } catch (err) {
    console.error('[ORDER ERROR]', err);
    res.status(500).json({ success: false, message: 'فشل إنشاء الطلب' });
  }
});

app.get('/api/orders/:id/pdf', async (req, res) => {
  if (!puppeteer) {
    return res.status(503).json({
      success: false,
      message: 'PDF generation is currently unavailable because Puppeteer is not installed.'
    });
  }
  try {
    const orderId = String(req.params.id).trim();
    if (!orderId) return res.status(400).json({ success: false, message: 'Order id required' });

    const order = orderRepository.findByIdOrNumber(orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    const type = String(req.query.type || 'invoice').toLowerCase();
    const saveToDisk = String(req.query.save || 'false').toLowerCase() === 'true';
    const filename = `${type}-${orderId}.pdf`;

    const { buffer, savedPath } = await createPdfFromPrintPage({ ids: [orderId], type, saveToDisk, filename, port: PORT });
    if (saveToDisk && savedPath) {
      return res.json({ success: true, message: 'PDF generated and saved', path: `/storage/pdfs/${path.basename(savedPath)}` });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error('[PDF ERROR]', err);
    res.status(500).json({ success: false, message: 'فشل توليد PDF' });
  }
});

app.post('/api/orders/bulk-pdf', async (req, res) => {
  if (!puppeteer) {
    return res.status(503).json({
      success: false,
      message: 'PDF generation is currently unavailable because Puppeteer is not installed.'
    });
  }
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(String).map(i => i.trim()).filter(Boolean) : [];
    const type = String(req.body.type || 'invoice').toLowerCase();
    const saveToDisk = Boolean(req.body.save);
    if (!ids.length) return res.status(400).json({ success: false, message: 'Order ids required' });

    const validIds = ids.filter(id => Boolean(orderRepository.findByIdOrNumber(id)));
    if (!validIds.length) return res.status(404).json({ success: false, message: 'No valid orders found' });

    const filename = `bulk-${type}-orders.pdf`;
    const { buffer, savedPath } = await createPdfFromPrintPage({ ids: validIds, type, saveToDisk, filename, port: PORT });
    if (saveToDisk && savedPath) {
      return res.json({ success: true, message: 'Bulk PDF generated and saved', path: `/storage/pdfs/${path.basename(savedPath)}` });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error('[BULK PDF ERROR]', err);
    res.status(500).json({ success: false, message: 'فشل توليد PDF الجماعي' });
  }
});

app.put('/api/orders/:id/status', requirePerm('update_orders'), (req, res) => {
  const result = orderRepository.updateStatus(req.params.id, req.body.status, req.headers['x-user-role'] || 'system');
  if (result === null) return res.status(404).json({ success: false, message: 'Order not found' });
  if (result && result.error) return res.status(400).json({ success: false, message: result.error });
  res.json({ success: true, order: result });
});

app.put('/api/orders/:id/assign', requirePerm('update_orders'), (req, res) => {
  const updatedOrder = orderRepository.assign(req.params.id, req.body.userId);
  if (!updatedOrder) return res.status(404).json({ success: false, message: 'Order not found' });
  res.json({ success: true, order: updatedOrder });
});

app.delete('/api/orders/:id', requirePerm('delete_orders'), (req, res) => {
  const deleted = orderRepository.delete(req.params.id);
  if (!deleted) return res.status(404).json({ success: false, message: 'Order not found' });
  res.json({ success: true, message: 'Order deleted successfully' });
});

app.post('/api/orders/:id/note', requirePerm('add_order_notes'), (req, res) => {
  const updatedOrder = orderRepository.addNote(req.params.id, req.body.note, req.headers['x-user-role'] || 'system');
  if (!updatedOrder) return res.status(404).json({ success: false, message: 'Order not found' });
  res.json({ success: true, order: updatedOrder });
});

/* =========================
   API: DIRECT SALE (Stock Deduction)
========================= */
app.post('/api/direct-sale', (req, res) => {
  console.log('[DIRECT-SALE-ROUTE] Hit!');
  try {
    const { productId, quantity, salePrice, note, customerName, customerPhone, customerAddress } = req.body;

    // Validation
    if (productId == null || quantity == null || salePrice == null) {
      return res.status(400).json({ success: false, message: 'معرف المنتج والكمية وسعر البيع مطلوبان' });
    }

    const qty = Number(quantity);
    const price = Number(salePrice);
    if (!Number.isInteger(qty) || qty <= 0) {
      return res.status(400).json({ success: false, message: 'الكمية يجب أن تكون رقم أكبر من 0' });
    }
    if (Number.isNaN(price) || price <= 0) {
      return res.status(400).json({ success: false, message: 'سعر البيع الفعلي يجب أن يكون رقم أكبر من 0' });
    }

    // Get product
    const products = productRepository.findAll();
    const productIdx = products.findIndex(p => String(p.id) === String(productId));
    if (productIdx === -1) {
      return res.status(404).json({ success: false, message: 'المنتج غير موجود' });
    }

    const product = products[productIdx];
    const currentStock = Number(product.stock) || 0;

    // Check stock availability
    if (currentStock < qty) {
      return res.status(400).json({
        success: false,
        message: `المخزون غير كافٍ. المتاح: ${currentStock}، المطلوب: ${qty}`
      });
    }

    // Deduct stock
    product.stock = currentStock - qty;
    productRepository.saveAll(products);

    const directSales = readJSON('direct-sales.json');
    const nextId = directSales.reduce((max, item) => {
      const idNum = Number(item.id);
      return Number.isFinite(idNum) ? Math.max(max, idNum) : max;
    }, 0) + 1;

    const listedPrice = Number(product.price) || 0;
    const total = price * qty;
    const saleRecord = {
      id: nextId,
      productId: product.id,
      productName: product.name,
      quantity: qty,
      listedPrice,
      salePrice: price,
      total,
      customerName: typeof customerName === 'string' ? customerName.trim() : '',
      customerPhone: typeof customerPhone === 'string' ? customerPhone.trim() : '',
      customerAddress: typeof customerAddress === 'string' ? customerAddress.trim() : '',
      note: typeof note === 'string' ? note.trim() : '',
      saleStatus: 'completed',
      createdAt: new Date().toISOString()
    };

    directSales.push(saleRecord);
    writeJSON('direct-sales.json', directSales);

    console.log(`[DIRECT-SALE] ${product.name}: ${qty} unit(s) sold at ${price}. Stock: ${currentStock} → ${product.stock}`);

    res.json({
      success: true,
      message: 'تم تسجيل البيع بنجاح',
      productName: product.name,
      soldQuantity: qty,
      newStock: product.stock,
      saleRecord
    });
  } catch (err) {
    console.error('[DIRECT-SALE ERROR]', err);
    res.status(500).json({ success: false, message: 'فشل تسجيل البيع' });
  }
});

app.get('/api/direct-sales', (req, res) => {
  try {
    const directSales = readJSON('direct-sales.json');
    res.json(Array.isArray(directSales) ? directSales : []);
  } catch (err) {
    console.error('[DIRECT-SALES GET ERROR]', err);
    res.status(500).json({ success: false, message: 'فشل تحميل مبيعات مباشرة' });
  }
});

app.put('/api/direct-sales/:id', (req, res) => {
  try {
    const saleId = Number(req.params.id);
    const { customerName, customerPhone, customerAddress, note } = req.body;

    const directSales = readJSON('direct-sales.json');
    const saleIdx = directSales.findIndex(s => Number(s.id) === saleId);
    
    if (saleIdx === -1) {
      return res.status(404).json({ success: false, message: 'عملية البيع غير موجودة' });
    }

    const sale = directSales[saleIdx];

    // Allowed fields to update: customerName, customerPhone, customerAddress, note
    if (customerName !== undefined) sale.customerName = typeof customerName === 'string' ? customerName.trim() : '';
    if (customerPhone !== undefined) sale.customerPhone = typeof customerPhone === 'string' ? customerPhone.trim() : '';
    if (customerAddress !== undefined) sale.customerAddress = typeof customerAddress === 'string' ? customerAddress.trim() : '';
    if (note !== undefined) sale.note = typeof note === 'string' ? note.trim() : '';

    writeJSON('direct-sales.json', directSales);

    res.json({
      success: true,
      message: 'تم تحديث بيانات الزبون بنجاح',
      saleRecord: sale
    });
  } catch (err) {
    console.error('[DIRECT-SALE UPDATE ERROR]', err);
    res.status(500).json({ success: false, message: 'فشل تحديث بيانات الزبون' });
  }
});

app.put('/api/direct-sales/:id/cancel', (req, res) => {
  try {
    const saleId = Number(req.params.id);
    const { cancelReason } = req.body;

    if (!cancelReason || typeof cancelReason !== 'string' || !cancelReason.trim()) {
      return res.status(400).json({ success: false, message: 'سبب الإلغاء مطلوب' });
    }

    const directSales = readJSON('direct-sales.json');
    const saleIdx = directSales.findIndex(s => Number(s.id) === saleId);
    
    if (saleIdx === -1) {
      return res.status(404).json({ success: false, message: 'عملية البيع غير موجودة' });
    }

    const sale = directSales[saleIdx];

    if (sale.saleStatus === 'cancelled') {
      return res.status(400).json({ success: false, message: 'عملية البيع ملغية بالفعل' });
    }

    // Get the product to restore stock
    const products = productRepository.findAll();
    const productIdx = products.findIndex(p => String(p.id) === String(sale.productId));
    
    if (productIdx !== -1) {
      const product = products[productIdx];
      const currentStock = Number(product.stock) || 0;
      product.stock = currentStock + Number(sale.quantity);
      productRepository.saveAll(products);
      console.log(`[DIRECT-SALE CANCEL] restored ${sale.quantity} to ${product.name}. Stock: ${currentStock} → ${product.stock}`);
    } else {
      console.warn(`[DIRECT-SALE CANCEL] Product ID ${sale.productId} not found to restore stock.`);
    }

    // Update sale record
    sale.saleStatus = 'cancelled';
    sale.cancelReason = cancelReason.trim();
    sale.cancelledAt = new Date().toISOString();
    sale.cancelledBy = req.user?.role || 'admin';

    writeJSON('direct-sales.json', directSales);

    res.json({
      success: true,
      message: 'تم إلغاء عملية البيع بنجاح وإعادة المخزون',
      saleRecord: sale
    });
  } catch (err) {
    console.error('[DIRECT-SALE CANCEL ERROR]', err);
    res.status(500).json({ success: false, message: 'فشل إلغاء عملية البيع' });
  }
});

/* =========================
   API: STOCK RECEIPTS (Inventory Receiving)
========================= */
app.post('/api/stock-receipts', (req, res) => {
  console.log('[STOCK-RECEIPT-ROUTE] Hit!');
  try {
    const { productId, quantity, unitCost, supplier, note } = req.body;

    // Validation
    if (productId == null || quantity == null || unitCost == null) {
      return res.status(400).json({ success: false, message: 'معرف المنتج والكمية والتكلفة مطلوبان' });
    }

    const qty = Number(quantity);
    const cost = Number(unitCost);
    if (!Number.isInteger(qty) || qty <= 0) {
      return res.status(400).json({ success: false, message: 'الكمية يجب أن تكون رقم أكبر من 0' });
    }
    if (Number.isNaN(cost) || cost < 0) {
      return res.status(400).json({ success: false, message: 'تكلفة الوحدة يجب أن تكون رقم غير سالب' });
    }

    // Get product
    const products = productRepository.findAll();
    const productIdx = products.findIndex(p => String(p.id) === String(productId));
    if (productIdx === -1) {
      return res.status(404).json({ success: false, message: 'المنتج غير موجود' });
    }

    const product = products[productIdx];
    const oldStock = Number(product.stock) || 0;
    const oldCostPrice = Number(product.costPrice) || 0;

    // Calculate weighted average cost price
    // newCostPrice = ((oldStock × oldCost) + (newQty × newUnitCost)) / (oldStock + newQty)
    const newCostPrice = ((oldStock * oldCostPrice) + (qty * cost)) / (oldStock + qty);

    // Update product
    product.stock = oldStock + qty;
    product.costPrice = newCostPrice;
    productRepository.saveAll(products);

    // Record stock receipt
    const stockReceipts = readJSON('stock-receipts.json');
    const nextId = 'REC-' + String(stockReceipts.length + 1).padStart(4, '0');

    const receipt = {
      id: nextId,
      productId: product.id,
      productName: product.name,
      quantity: qty,
      unitCost: cost,
      supplier: typeof supplier === 'string' ? supplier.trim() : '',
      note: typeof note === 'string' ? note.trim() : '',
      createdAt: new Date().toISOString()
    };

    stockReceipts.push(receipt);
    writeJSON('stock-receipts.json', stockReceipts);

    console.log(`[STOCK-RECEIPT] ${product.name}: ${qty} unit(s) received at cost ${cost}. Stock: ${oldStock} → ${product.stock}, CostPrice: ${oldCostPrice} → ${newCostPrice}`);

    res.json({
      success: true,
      message: 'تم تسجيل التوريد بنجاح',
      productName: product.name,
      newStock: product.stock,
      newCostPrice,
      receipt
    });
  } catch (err) {
    console.error('[STOCK-RECEIPT ERROR]', err);
    res.status(500).json({ success: false, message: 'فشل تسجيل التوريد' });
  }
});

app.get('/api/stock-receipts', (req, res) => {
  try {
    const stockReceipts = readJSON('stock-receipts.json');
    res.json(Array.isArray(stockReceipts) ? stockReceipts : []);
  } catch (err) {
    console.error('[STOCK-RECEIPTS GET ERROR]', err);
    res.status(500).json({ success: false, message: 'فشل تحميل التوريدات' });
  }
});

/* =========================
   API: COUPONS
========================= */
app.get('/api/coupons', requirePerm('view_coupons'), (req, res) => {
  res.json(couponRepository.findAll());
});

app.post('/api/coupons/validate', (req, res) => {
  try {
    const { code } = req.body;
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ success: false, message: 'رمز الخصم غير صحيح' });
    }

    const coupon = couponRepository.findByCode(code);

    if (!coupon) {
      return res.json({ success: false, message: 'رمز الخصم غير موجود' });
    }

    if (!coupon.active) {
      return res.json({ success: false, message: 'رمز الخصم غير نشط' });
    }

    if (coupon.expiryDate && new Date(coupon.expiryDate) < new Date()) {
      return res.json({ success: false, message: 'انتهت صلاحية رمز الخصم' });
    }

    if (coupon.maxUses > 0 && coupon.usedCount >= coupon.maxUses) {
      return res.json({ success: false, message: 'تم استخدام رمز الخصم بالكامل' });
    }

    res.json({ success: true, data: coupon, message: 'تم تطبيق الخصم بنجاح' });
  } catch (err) {
    console.error('[COUPON ERROR]', err);
    res.status(500).json({ success: false, message: 'خطأ في التحقق من الخصم' });
  }
});

app.post('/api/coupons', requirePerm('manage_coupons'), (req, res) => {
  try {
    const { code, discountPercent, maxUses, expiryDate } = req.body;
    if (!code || !discountPercent) {
      return res.status(400).json({ success: false, message: 'بيانات الخصم غير مكتملة' });
    }

    if (couponRepository.findByCode(code)) {
      return res.status(400).json({ success: false, message: 'رمز الخصم موجود بالفعل' });
    }

    const newCoupon = couponRepository.create({
      code,
      discountPercent,
      maxUses,
      expiryDate
    });
    res.json({ success: true, data: newCoupon });
  } catch (err) {
    console.error('[COUPON CREATE ERROR]', err);
    res.status(500).json({ success: false, message: 'فشل إنشاء الخصم' });
  }
});

app.put('/api/coupons/:code', requirePerm('manage_coupons'), (req, res) => {
  try {
    const updated = couponRepository.update(req.params.code, req.body);
    if (!updated) {
      return res.status(404).json({ success: false, message: 'الخصم غير موجود' });
    }
    res.json({ success: true, data: updated });
  } catch (err) {
    console.error('[COUPON UPDATE ERROR]', err);
    res.status(500).json({ success: false, message: 'فشل تحديث الخصم' });
  }
});

app.delete('/api/coupons/:code', requirePerm('manage_coupons'), (req, res) => {
  try {
    const deleted = couponRepository.delete(req.params.code);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'الخصم غير موجود' });
    }
    res.json({ success: true, message: 'تم حذف الخصم' });
  } catch (err) {
    console.error('[COUPON DELETE ERROR]', err);
    res.status(500).json({ success: false, message: 'فشل حذف الخصم' });
  }
});

/* =========================
   API: AUTHENTICATION (NO AUTH REQUIRED)
========================= */
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'اسم المستخدم وكلمة المرور مطلوبان' });
  }

  const user = userRepository.findByUsername(username);

  if (!user) {
    return res.status(401).json({ success: false, message: 'اسم المستخدم غير موجود' });
  }

  if (user.password !== password) {
    return res.status(401).json({ success: false, message: 'كلمة المرور غير صحيحة' });
  }

  if (!user.active) {
    return res.status(403).json({ success: false, message: 'الحساب موقوف. تواصل مع المسؤول' });
  }

  // --- JWT issuance ---
  // TODO: replace with authenticated user's companyId later.
  const company = await prisma.company.findFirst();
  const payload = {
    userId: user.id,
    role: user.role,
    companyId: company ? company.id : null,
  };
  const token = jwt.sign(payload, process.env.JWT_SECRET || 'fallback-secret-key', { expiresIn: '24h' });

  // Return user without password and include JWT
  const { password: _, ...userWithoutPassword } = user;
  res.json({ success: true, data: userWithoutPassword, token });
});

/* =========================
   API: USERS
========================= */
app.get('/api/users', requirePerm('view_users'), (req, res) => {
  res.json(userRepository.findAll());
});

app.post('/api/users', requirePerm('add_users'), (req, res) => {
  const newUser = userRepository.create(req.body);
  res.json(newUser);
});

app.put('/api/users/:id', requirePerm('edit_users'), (req, res) => {
  const users = userRepository.findAll();
  const targetUser = users.find(u => String(u.id) === String(req.params.id));
  if (!targetUser) return res.status(404).json({ success: false, message: 'User not found' });
  
  const isSuperAdmin = targetUser.role === 'super_admin';
  const isDeactivating = req.body.active === false || (req.body.role && req.body.role !== 'super_admin');
  
  if (isSuperAdmin && isDeactivating) {
    const activeSuperAdmins = users.filter(u => u.role === 'super_admin' && u.active);
    if (activeSuperAdmins.length <= 1) {
      return res.status(400).json({ success: false, message: 'لا يمكن إلغاء تنشيط أو تغيير دور آخر مدير عام (Super Admin) في النظام!' });
    }
  }

  const updated = userRepository.update(req.params.id, req.body);
  res.json(updated);
});

app.delete('/api/users/:id', requirePerm('delete_users'), (req, res) => {
  const users = userRepository.findAll();
  const targetUser = users.find(u => String(u.id) === String(req.params.id));
  if (!targetUser) return res.status(404).json({ success: false, message: 'User not found' });

  if (targetUser.role === 'super_admin') {
    const superAdmins = users.filter(u => u.role === 'super_admin');
    if (superAdmins.length <= 1) {
      return res.status(400).json({ success: false, message: 'لا يمكن حذف آخر مدير عام (Super Admin) في النظام!' });
    }
  }

  const deleted = userRepository.delete(req.params.id);
  if (!deleted) return res.status(404).json({ success: false, message: 'User not found' });
  res.json({ success: true });
});

/* =========================
   API: PERMISSIONS (RBAC)
========================= */
app.get('/api/permissions', (req, res) => {
  res.json(getActivePermissions());
});

app.put('/api/permissions', requirePerm('manage_roles_permissions'), (req, res) => {
  const newPerms = req.body;
  // Ensure super_admin always has all permissions
  newPerms.super_admin = [...DEFAULT_PERMISSIONS.super_admin];
  permissionRepository.saveAll(newPerms);
  res.json({ success: true, permissions: newPerms });
});

/* =========================
   API: STORE SETTINGS
========================= */
app.get('/api/settings', (req, res) => {
  res.json(settingsRepository.findFirst() || {});
});

app.put('/api/settings', requirePerm('view_settings'), (req, res) => {
  const role = req.headers['x-user-role'];
  const currentPerms = getActivePermissions();
  const rolePerms = currentPerms[role] || DEFAULT_PERMISSIONS[role] || [];
  
  if (role !== 'super_admin') {
    // Check if modifying payment options
    if ('paymentGateways' in req.body && !rolePerms.includes('edit_payment_settings')) {
      return res.status(403).json({ success: false, message: 'Forbidden: No payment edit permissions' });
    }
    // Check if modifying theme
    if ('theme' in req.body && !rolePerms.includes('edit_theme')) {
      return res.status(403).json({ success: false, message: 'Forbidden: No theme edit permissions' });
    }
    // Check if modifying colors
    if (('primaryColor' in req.body || 'secondaryColor' in req.body || 'textColor' in req.body || 'subTextColor' in req.body) && !rolePerms.includes('edit_colors')) {
      return res.status(403).json({ success: false, message: 'Forbidden: No color edit permissions' });
    }
    // Check if modifying branding images
    if (('logoImage' in req.body || 'bannerImage' in req.body || 'branding' in req.body) && !rolePerms.includes('edit_branding')) {
      return res.status(403).json({ success: false, message: 'Forbidden: No branding edit permissions' });
    }
    // Check if modifying legal content
    if (('termsText' in req.body || 'privacyText' in req.body || 'aboutText' in req.body) && !rolePerms.includes('edit_legal_pages')) {
      return res.status(403).json({ success: false, message: 'Forbidden: No legal content edit permissions' });
    }
    // Check if modifying basic store info
    if (('name' in req.body || 'subtitle' in req.body || 'description' in req.body || 'phone' in req.body || 'email' in req.body || 'address' in req.body) && !rolePerms.includes('edit_store_info')) {
      return res.status(403).json({ success: false, message: 'Forbidden: No store info edit permissions' });
    }
  }

  const updatedSettings = settingsRepository.update(req.body);
  res.json(updatedSettings);
});

/* =========================
   API: COUNTRIES
========================= */
app.get('/api/countries', (req, res) => {
  res.json(COUNTRIES);
});

/* =========================
   API: IMAGE UPLOAD
========================= */
app.post('/api/upload', (req, res) => {
  upload.single('image')(req, res, (err) => {
    if (err) {
      console.error('[UPLOAD ERROR]', err.message);
      return res.status(400).json({ success: false, message: err.message || 'Upload failed', data: null });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file received', data: null });
    }
    const type = req.body.type === 'branding' ? 'branding' : req.body.type === 'category' ? 'categories' : 'products';
    const filePath = `/images/${type}/${req.file.filename}`;
    console.log(`[UPLOAD OK] Saved: ${filePath}`);
    res.json({ success: true, data: { path: filePath } });
  });
});

/* =========================
   API: ACCOUNTING CUSTOMERS
========================= */
app.get('/api/accounting/customers', async (req, res) => {
  console.log('[ACCOUNTING CUSTOMERS] GET route hit');
  try {
    const company = await prisma.company.findFirst();
    if (!company) {
      return res.status(404).json({ success: false, message: 'No company found in the database.' });
    }

    const customers = await prisma.customer.findMany({
      where: {
        companyId: company.id,
        deletedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(customers.map((customer) => ({
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
      address: customer.billingAddress,
      isActive: customer.active,
    })));
  } catch (error) {
    console.error('[ACCOUNTING CUSTOMERS GET]', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve customers.' });
  }
});

app.post('/api/accounting/customers', async (req, res) => {
  try {
    const company = await prisma.company.findFirst();
    if (!company) {
      return res.status(404).json({ success: false, message: 'No company found in the database.' });
    }

    const { name, phone, email, address, isActive } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Customer name is required.' });
    }

    const customer = await prisma.customer.create({
      data: {
        companyId: company.id,
        name: name.trim(),
        phone: phone ? String(phone).trim() : null,
        email: email ? String(email).trim() : null,
        billingAddress: address ? String(address).trim() : null,
        active: typeof isActive === 'boolean' ? isActive : true,
      },
    });

    res.status(201).json({ success: true, data: {
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
      address: customer.billingAddress,
      isActive: customer.active,
    }});
  } catch (error) {
    console.error('[ACCOUNTING CUSTOMERS POST]', error);
    res.status(500).json({ success: false, message: 'Failed to create customer.' });
  }
});

app.put('/api/accounting/customers/:id', async (req, res) => {
  try {
    const company = await prisma.company.findFirst();
    if (!company) {
      return res.status(404).json({ success: false, message: 'No company found in the database.' });
    }

    const { id } = req.params;
    const { name, phone, email, address, isActive } = req.body;

    const existingCustomer = await prisma.customer.findFirst({
      where: {
        id,
        companyId: company.id,
        deletedAt: null,
      },
    });

    if (!existingCustomer) {
      return res.status(404).json({ success: false, message: 'Customer not found.' });
    }

    const updatedCustomer = await prisma.customer.update({
      where: { id },
      data: {
        name: typeof name === 'string' ? name.trim() : existingCustomer.name,
        phone: phone === undefined ? existingCustomer.phone : (phone ? String(phone).trim() : null),
        email: email === undefined ? existingCustomer.email : (email ? String(email).trim() : null),
        billingAddress: address === undefined ? existingCustomer.billingAddress : (address ? String(address).trim() : null),
        active: typeof isActive === 'boolean' ? isActive : existingCustomer.active,
      },
    });

    res.json({ success: true, data: {
      id: updatedCustomer.id,
      name: updatedCustomer.name,
      phone: updatedCustomer.phone,
      email: updatedCustomer.email,
      address: updatedCustomer.billingAddress,
      isActive: updatedCustomer.active,
    }});
  } catch (error) {
    console.error('[ACCOUNTING CUSTOMERS PUT]', error);
    res.status(500).json({ success: false, message: 'Failed to update customer.' });
  }
});

/* =========================
   API: ACCOUNTING SUPPLIERS
========================= */
app.get('/api/accounting/suppliers', async (req, res) => {
  console.log('[ACCOUNTING SUPPLIERS] GET route hit');
  try {
    const company = await prisma.company.findFirst();
    if (!company) {
      return res.status(404).json({ success: false, message: 'No company found in the database.' });
    }

    const suppliers = await prisma.supplier.findMany({
      where: {
        companyId: company.id,
        deletedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(suppliers.map((supplier) => ({
      id: supplier.id,
      name: supplier.name,
      phone: supplier.phone,
      email: supplier.email,
      address: supplier.billingAddress,
      isActive: supplier.active,
    })));
  } catch (error) {
    console.error('[ACCOUNTING SUPPLIERS GET]', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve suppliers.' });
  }
});

app.post('/api/accounting/suppliers', async (req, res) => {
  try {
    const company = await prisma.company.findFirst();
    if (!company) {
      return res.status(404).json({ success: false, message: 'No company found in the database.' });
    }

    const { name, phone, email, address, isActive } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Supplier name is required.' });
    }

    const supplier = await prisma.supplier.create({
      data: {
        companyId: company.id,
        name: name.trim(),
        phone: phone ? String(phone).trim() : null,
        email: email ? String(email).trim() : null,
        billingAddress: address ? String(address).trim() : null,
        active: typeof isActive === 'boolean' ? isActive : true,
      },
    });

    res.status(201).json({ success: true, data: {
      id: supplier.id,
      name: supplier.name,
      phone: supplier.phone,
      email: supplier.email,
      address: supplier.billingAddress,
      isActive: supplier.active,
    }});
  } catch (error) {
    console.error('[ACCOUNTING SUPPLIERS POST]', error);
    res.status(500).json({ success: false, message: 'Failed to create supplier.' });
  }
});

app.put('/api/accounting/suppliers/:id', async (req, res) => {
  try {
    const company = await prisma.company.findFirst();
    if (!company) {
      return res.status(404).json({ success: false, message: 'No company found in the database.' });
    }

    const { id } = req.params;
    const { name, phone, email, address, isActive } = req.body;

    const existingSupplier = await prisma.supplier.findFirst({
      where: {
        id,
        companyId: company.id,
        deletedAt: null,
      },
    });

    if (!existingSupplier) {
      return res.status(404).json({ success: false, message: 'Supplier not found.' });
    }

    const updatedSupplier = await prisma.supplier.update({
      where: { id },
      data: {
        name: typeof name === 'string' ? name.trim() : existingSupplier.name,
        phone: phone === undefined ? existingSupplier.phone : (phone ? String(phone).trim() : null),
        email: email === undefined ? existingSupplier.email : (email ? String(email).trim() : null),
        billingAddress: address === undefined ? existingSupplier.billingAddress : (address ? String(address).trim() : null),
        active: typeof isActive === 'boolean' ? isActive : existingSupplier.active,
      },
    });

    res.json({ success: true, data: {
      id: updatedSupplier.id,
      name: updatedSupplier.name,
      phone: updatedSupplier.phone,
      email: updatedSupplier.email,
      address: updatedSupplier.billingAddress,
      isActive: updatedSupplier.active,
    }});
  } catch (error) {
    console.error('[ACCOUNTING SUPPLIERS PUT]', error);
    res.status(500).json({ success: false, message: 'Failed to update supplier.' });
  }
});

/* =========================
   API: ACCOUNTING ACCOUNTS
========================= */
app.get('/api/accounting/accounts', async (req, res) => {
  console.log('[ACCOUNTING ACCOUNTS] GET route hit');
  try {
    const company = await prisma.company.findFirst();
    if (!company) {
      return res.status(404).json({ success: false, message: 'No company found in the database.' });
    }

    const accounts = await prisma.accountingAccount.findMany({
      where: {
        companyId: company.id,
        deletedAt: null,
      },
      orderBy: { accountCode: 'asc' },
    });

    res.json(accounts.map((a) => ({
      id: a.id,
      accountCode: a.accountCode,
      accountName: a.name,
      accountType: a.accountType,
      isActive: a.isActive,
    })));
  } catch (error) {
    console.error('[ACCOUNTING ACCOUNTS GET]', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve accounts.' });
  }
});

app.post('/api/accounting/accounts', async (req, res) => {
  try {
    const company = await prisma.company.findFirst();
    if (!company) {
      return res.status(404).json({ success: false, message: 'No company found in the database.' });
    }

    const { accountCode, accountName, accountType, isActive } = req.body;
    if (!accountCode || typeof accountCode !== 'string' || !accountCode.trim()) {
      return res.status(400).json({ success: false, message: 'Account code is required.' });
    }
    if (!accountName || typeof accountName !== 'string' || !accountName.trim()) {
      return res.status(400).json({ success: false, message: 'Account name is required.' });
    }

    const validTypes = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'];
    if (!accountType || !validTypes.includes(accountType)) {
      return res.status(400).json({ success: false, message: `Account type must be one of: ${validTypes.join(', ')}` });
    }

    // Check for duplicate accountCode within the same company
    const existing = await prisma.accountingAccount.findFirst({
      where: {
        companyId: company.id,
        accountCode: accountCode.trim(),
        deletedAt: null,
      },
    });
    if (existing) {
      return res.status(409).json({ success: false, message: 'رمز الحساب مستخدم بالفعل.' });
    }

    const account = await prisma.accountingAccount.create({
      data: {
        companyId: company.id,
        accountCode: accountCode.trim(),
        name: accountName.trim(),
        accountType: accountType,
        isActive: typeof isActive === 'boolean' ? isActive : true,
      },
    });

    res.status(201).json({ success: true, data: {
      id: account.id,
      accountCode: account.accountCode,
      accountName: account.name,
      accountType: account.accountType,
      isActive: account.isActive,
    }});
  } catch (error) {
    console.error('[ACCOUNTING ACCOUNTS POST]', error);
    if (error.code === 'P2002') {
      return res.status(409).json({ success: false, message: 'رمز الحساب مستخدم بالفعل.' });
    }
    res.status(500).json({ success: false, message: 'Failed to create account.' });
  }
});

app.put('/api/accounting/accounts/:id', async (req, res) => {
  try {
    const company = await prisma.company.findFirst();
    if (!company) {
      return res.status(404).json({ success: false, message: 'No company found in the database.' });
    }

    const { id } = req.params;
    const { accountCode, accountName, accountType, isActive } = req.body;

    const existingAccount = await prisma.accountingAccount.findFirst({
      where: {
        id,
        companyId: company.id,
        deletedAt: null,
      },
    });

    if (!existingAccount) {
      return res.status(404).json({ success: false, message: 'Account not found.' });
    }

    const validTypes = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'];
    if (accountType && !validTypes.includes(accountType)) {
      return res.status(400).json({ success: false, message: `Account type must be one of: ${validTypes.join(', ')}` });
    }

    // If accountCode is changing, check for duplicates
    const newCode = accountCode !== undefined ? accountCode.trim() : existingAccount.accountCode;
    if (newCode !== existingAccount.accountCode) {
      const duplicate = await prisma.accountingAccount.findFirst({
        where: {
          companyId: company.id,
          accountCode: newCode,
          deletedAt: null,
          id: { not: id },
        },
      });
      if (duplicate) {
        return res.status(409).json({ success: false, message: 'رمز الحساب مستخدم بالفعل.' });
      }
    }

    const updatedAccount = await prisma.accountingAccount.update({
      where: { id },
      data: {
        accountCode: newCode,
        name: typeof accountName === 'string' ? accountName.trim() : existingAccount.name,
        accountType: accountType || existingAccount.accountType,
        isActive: typeof isActive === 'boolean' ? isActive : existingAccount.isActive,
      },
    });

    res.json({ success: true, data: {
      id: updatedAccount.id,
      accountCode: updatedAccount.accountCode,
      accountName: updatedAccount.name,
      accountType: updatedAccount.accountType,
      isActive: updatedAccount.isActive,
    }});
  } catch (error) {
    console.error('[ACCOUNTING ACCOUNTS PUT]', error);
    if (error.code === 'P2002') {
      return res.status(409).json({ success: false, message: 'رمز الحساب مستخدم بالفعل.' });
    }
    res.status(500).json({ success: false, message: 'Failed to update account.' });
  }
});

// =========================
// API: ACCOUNTING SETTINGS
// =========================
app.get('/api/accounting/settings', async (req, res) => {
  try {
    // Determine companyId from JWT or fallback
    let companyId = req.user?.companyId;
    if (!companyId) {
      const fallbackCompany = await prisma.company.findFirst();
      if (!fallbackCompany) {
        return res.status(404).json({ success: false, message: 'No company found in the database.' });
      }
      companyId = fallbackCompany.id;
      // TODO: remove company.findFirst fallback after full JWT company migration.
    }

    const settings = await prisma.accountingSettings.findUnique({
      where: { companyId },
    });

    if (!settings) {
      return res.json({
        defaultCashAccountId: null,
        defaultBankAccountId: null,
        defaultSalesAccountId: null,
        defaultPurchasesAccountId: null,
        defaultInventoryAccountId: null,
        defaultCOGSAccountId: null,
      });
    }

    const { defaultCashAccountId, defaultBankAccountId, defaultSalesAccountId, defaultPurchasesAccountId, defaultInventoryAccountId, defaultCOGSAccountId } = settings;
    res.json({ defaultCashAccountId, defaultBankAccountId, defaultSalesAccountId, defaultPurchasesAccountId, defaultInventoryAccountId, defaultCOGSAccountId });
  } catch (error) {
    console.error('[ACCOUNTING SETTINGS GET]', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve accounting settings.' });
  }
});

app.patch('/api/accounting/settings', async (req, res) => {
  try {
    // Determine companyId from JWT or fallback
    let companyId = req.user?.companyId;
    if (!companyId) {
      const fallbackCompany = await prisma.company.findFirst();
      if (!fallbackCompany) {
        return res.status(404).json({ success: false, message: 'No company found in the database.' });
      }
      companyId = fallbackCompany.id;
      // TODO: remove company.findFirst fallback after full JWT company migration.
    }

    const allowedFields = [
      'defaultCashAccountId',
      'defaultBankAccountId',
      'defaultSalesAccountId',
      'defaultPurchasesAccountId',
      'defaultInventoryAccountId',
      'defaultCOGSAccountId',
    ];
    const data = {};
    for (const field of allowedFields) {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        data[field] = req.body[field];
      }
    }

    // Validate any provided account IDs belong to the same company
    for (const [key, accountId] of Object.entries(data)) {
      if (accountId) {
        const account = await prisma.accountingAccount.findFirst({
          where: { id: accountId, companyId, deletedAt: null },
        });
        if (!account) {
          return res.status(400).json({ success: false, message: `${key} does not reference a valid account for this company.` });
        }
      }
    }

    const upserted = await prisma.accountingSettings.upsert({
      where: { companyId },
      update: {
        ...data,
        updatedBy: req.user?.userId || null,
      },
      create: {
        companyId,
        ...data,
        updatedBy: req.user?.userId || null,
      },
    });

    const { defaultCashAccountId, defaultBankAccountId, defaultSalesAccountId, defaultPurchasesAccountId, defaultInventoryAccountId, defaultCOGSAccountId } = upserted;
    res.json({ defaultCashAccountId, defaultBankAccountId, defaultSalesAccountId, defaultPurchasesAccountId, defaultInventoryAccountId, defaultCOGSAccountId });
  } catch (error) {
    console.error('[ACCOUNTING SETTINGS PATCH]', error);
    res.status(500).json({ success: false, message: 'Failed to update accounting settings.' });
  }
});

// =========================
// API: BANK DEPOSIT (Phase 12A)
// =========================
app.post('/api/accounting/bank-deposit', async (req, res) => {
  try {
    const company = await prisma.company.findFirst();
    if (!company) {
      return res.status(404).json({ success: false, message: 'لا توجد شركة في قاعدة البيانات.' });
    }

    // Get AccountingSettings
    const settings = await prisma.accountingSettings.findUnique({
      where: { companyId: company.id },
    });

    if (!settings || !settings.defaultCashAccountId || !settings.defaultBankAccountId) {
      return res.status(400).json({
        success: false,
        message: 'يرجى ضبط الحساب النقدي والحساب البنكي الافتراضي من إعدادات المحاسبة.'
      });
    }

    // Validate input
    const { amount, description, date } = req.body;

    if (!amount || typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({ success: false, message: 'المبلغ يجب أن يكون رقماً موجباً.' });
    }

    if (typeof description !== 'string' || !description.trim()) {
      return res.status(400).json({ success: false, message: 'البيان مطلوب.' });
    }

    const entryDate = date ? new Date(date) : new Date();
    if (isNaN(entryDate.getTime())) {
      return res.status(400).json({ success: false, message: 'التاريخ غير صحيح.' });
    }

    // Verify both accounts exist
    const [cashAccount, bankAccount] = await Promise.all([
      prisma.accountingAccount.findUnique({ where: { id: settings.defaultCashAccountId } }),
      prisma.accountingAccount.findUnique({ where: { id: settings.defaultBankAccountId } }),
    ]);

    if (!cashAccount) {
      return res.status(400).json({ success: false, message: 'الحساب النقدي الافتراضي غير موجود.' });
    }
    if (!bankAccount) {
      return res.status(400).json({ success: false, message: 'الحساب البنكي الافتراضي غير موجود.' });
    }

    // Generate journal entry number
    const lastEntry = await prisma.journalEntry.findFirst({
      where: { companyId: company.id },
      orderBy: { createdAt: 'desc' },
    });
    const nextNumber = lastEntry ? parseInt(lastEntry.entryNumber.split('-').pop() || '0') + 1 : 1;
    const entryNumber = `JE-${company.id.substring(0, 6)}-${String(nextNumber).padStart(4, '0')}`;

    // Create JournalEntry
    const journalEntry = await prisma.journalEntry.create({
      data: {
        companyId: company.id,
        entryNumber,
        entryDate,
        description: description.trim(),
        sourceType: 'PAYMENT',
        sourceId: 'BANK_DEPOSIT',
        isPosted: true,
        createdById: req.user?.userId || null,
      },
    });

    // Create JournalEntryLines (Debit: Bank, Credit: Cash)
    const [debitLine, creditLine] = await Promise.all([
      prisma.journalEntryLine.create({
        data: {
          journalEntryId: journalEntry.id,
          accountId: settings.defaultBankAccountId,
          debit: amount,
          credit: 0,
          description: `إيداع بنكي: ${description.trim()}`,
        },
      }),
      prisma.journalEntryLine.create({
        data: {
          journalEntryId: journalEntry.id,
          accountId: settings.defaultCashAccountId,
          debit: 0,
          credit: amount,
          description: `إيداع بنكي: ${description.trim()}`,
        },
      }),
    ]);

    // Fetch the complete entry with lines
    const completeEntry = await prisma.journalEntry.findUnique({
      where: { id: journalEntry.id },
      include: { lines: true },
    });

    res.status(201).json({
      success: true,
      message: 'تم تسجيل الإيداع البنكي بنجاح.',
      data: {
        journalEntry: {
          id: completeEntry.id,
          entryNumber: completeEntry.entryNumber,
          entryDate: completeEntry.entryDate,
          description: completeEntry.description,
          isPosted: completeEntry.isPosted,
        },
        lines: completeEntry.lines.map((line) => ({
          id: line.id,
          accountId: line.accountId,
          accountCode: line.accountId === settings.defaultBankAccountId ? bankAccount.accountCode : cashAccount.accountCode,
          accountName: line.accountId === settings.defaultBankAccountId ? bankAccount.name : cashAccount.name,
          debit: parseFloat(line.debit),
          credit: parseFloat(line.credit),
          description: line.description,
        })),
      },
    });
  } catch (error) {
    console.error('[BANK DEPOSIT]', error);
    res.status(500).json({ success: false, message: 'فشل تسجيل الإيداع البنكي.' });
  }
});

/* =========================
   API: PING
========================= */
app.get('/api/ping', (req, res) => {
  res.json({ ok: true, status: 'online' });
});

/* =========================
   PAGES
========================= */
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// Print page route: serve the print HTML and validate requested order IDs when provided
app.get('/print-order', (req, res) => {
  try {
    const id = req.query.id;
    const ids = req.query.ids;
    if (id || ids) {
      const list = ids ? String(ids).split(',').map(s => s.trim()).filter(Boolean) : [String(id)];
      const missing = list.filter(i => !orderRepository.findByIdOrNumber(i));
      if (missing.length === list.length) {
        res.status(404);
        return res.send(`<html><head><meta charset="utf-8"><title>Not Found</title></head><body style="font-family:Arial,Helvetica,sans-serif;padding:24px;direction:rtl"><h2>الطلب/الطلبات غير موجودة</h2><p>الطلبات التالية لم يتم العثور عليها: ${list.join(', ')}</p></body></html>`);
      }
      // If some missing but not all, still serve the page and client will show missing items
    }
  } catch (err) {
    console.error('[PRINT ROUTE ERROR]', err);
  }
  return res.sendFile(path.join(__dirname, 'print-order.html'));
});

/* =========================
   STATIC FILES (After all API routes)
========================= */
app.use('/images', express.static(path.join(__dirname, 'images')));
app.use('/storage/pdfs', express.static(PDF_STORAGE_DIR));
app.use(express.static(__dirname));

const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'production';

const server = app.listen(PORT, () => {
  console.log(`✅ Server successfully started!`);
  console.log(`📡 Port: ${PORT}`);
  console.log(`⚙️  Environment Mode: ${NODE_ENV}`);
  console.log(`🏪 Storefront: http://localhost:${PORT}`);
  console.log(`⚙️  Admin Panel: http://localhost:${PORT}/admin.html`);
});

// ===== Graceful Shutdown (Minimal) =====
const shutdown = () => {
  console.log('⏳ Received kill signal, shutting down server...');
  server.close(() => {
    console.log('✅ Closed out remaining connections.');
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);