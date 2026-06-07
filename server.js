require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const multer = require('multer');

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
  const filepath = path.join(DATA_DIR, filename);
  try {
    return JSON.parse(fs.readFileSync(filepath, 'utf8'));
  } catch (e) {
    console.error(`Error reading ${filename}:`, e.message);
    return [];
  }
}

function writeJSON(filename, data) {
  const filepath = path.join(DATA_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf8');
}

function findOrderByIdOrNumber(orders, identifier) {
  const key = String(identifier || '').trim();
  return orders.find(o => String(o.id || '').trim() === key || String(o.orderNumber || '').trim() === key);
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
  const settings = readJSON('settings.json');
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
const PERMISSIONS_FILE = path.join(DATA_DIR, 'permissions.json');

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
    if (fs.existsSync(PERMISSIONS_FILE)) {
      const data = JSON.parse(fs.readFileSync(PERMISSIONS_FILE, 'utf8'));
      // Ensure super_admin always has all permissions to prevent locking out
      data.super_admin = [...DEFAULT_PERMISSIONS.super_admin];
      return data;
    }
  } catch (e) {
    console.error("Error reading permissions file:", e);
  }
  // Initialize file if not present
  try {
    fs.writeFileSync(PERMISSIONS_FILE, JSON.stringify(DEFAULT_PERMISSIONS, null, 2), 'utf8');
  } catch (e) {
    console.error("Error writing default permissions file:", e);
  }
  return DEFAULT_PERMISSIONS;
}

function requirePerm(perm) {
  return (req, res, next) => {
    const role = req.headers['x-user-role'];
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
  res.json(readJSON('products.json'));
});

app.post('/api/products', requirePerm('add_products'), (req, res) => {
  const products = readJSON('products.json');
  const maxId = products.reduce((m, p) => Math.max(m, p.id || 0), 0);
  const newProduct = { id: maxId + 1, ...req.body, active: req.body.active !== false };
  products.push(newProduct);
  writeJSON('products.json', products);
  res.json(newProduct);
});

app.put('/api/products/:id', requirePerm('edit_products'), (req, res) => {
  const products = readJSON('products.json');
  const idx = products.findIndex(p => p.id == req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Product not found' });
  products[idx] = { ...products[idx], ...req.body };
  writeJSON('products.json', products);
  res.json(products[idx]);
});

app.delete('/api/products/:id', requirePerm('delete_products'), (req, res) => {
  let products = readJSON('products.json');
  products = products.filter(p => p.id != req.params.id);
  writeJSON('products.json', products);
  res.json({ ok: true });
});

/* =========================
   API: CATEGORIES
========================= */
app.get('/api/categories', (req, res) => {
  res.json(readJSON('categories.json'));
});

app.post('/api/categories', requirePerm('manage_categories'), (req, res) => {
  const categories = readJSON('categories.json');
  const id = (req.body.name || 'cat').replace(/\s+/g, '-').toLowerCase() + '-' + Date.now().toString(36);
  const newCat = {
    id,
    name: req.body.name,
    emoji: req.body.emoji || '🛍️',
    image: req.body.image || ''
  };
  categories.push(newCat);
  writeJSON('categories.json', categories);
  res.json(newCat);
});

app.put('/api/categories/:id', requirePerm('manage_categories'), (req, res) => {
  const categories = readJSON('categories.json');
  const idx = categories.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Category not found' });
  categories[idx] = { ...categories[idx], ...req.body };
  writeJSON('categories.json', categories);
  res.json(categories[idx]);
});

app.delete('/api/categories/:id', requirePerm('manage_categories'), (req, res) => {
  let categories = readJSON('categories.json');
  categories = categories.filter(c => c.id !== req.params.id);
  writeJSON('categories.json', categories);
  res.json({ ok: true });
});

/* =========================
   API: ORDERS
========================= */
app.get('/api/orders', (req, res) => {
  res.json(readJSON('orders.json'));
});

// Get single order by ID
app.get('/api/orders/:id', (req, res) => {
  const orders = readJSON('orders.json');
  const order = findOrderByIdOrNumber(orders, req.params.id);
  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
  return res.json(order);
});

app.post('/api/orders', (req, res) => {
  try {
    const orders = readJSON('orders.json');
    const { customer, phone, address, zone, zoneName, items, subtotal, shipping, total, notes, paymentMethod, couponCode, discount } = req.body;

    if (!customer || !phone || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'بيانات الطلب غير مكتملة' });
    }

    const maxNum = orders.reduce((max, o) => {
      const match = String(o.id).match(/ORD-(\d+)/);
      return match ? Math.max(max, parseInt(match[1])) : max;
    }, 0);
    const newId = `ORD-${String(maxNum + 1).padStart(3, '0')}`;

    const newOrder = {
      id: newId,
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
      const coupons = readJSON('coupons.json');
      const coupon = coupons.find(c => c.code.toUpperCase() === couponCode.toUpperCase());
      if (coupon && coupon.maxUses !== 0) {
        if (coupon.maxUses > 0) coupon.usedCount = (coupon.usedCount || 0) + 1;
        writeJSON('coupons.json', coupons);
      }
    }

    orders.push(newOrder);
    writeJSON('orders.json', orders);
    console.log(`[ORDER] New order created: ${newId}`);
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

    const orders = readJSON('orders.json');
    const order = findOrderByIdOrNumber(orders, orderId);
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

    const orders = readJSON('orders.json');
    const validIds = ids.filter(id => Boolean(findOrderByIdOrNumber(orders, id)));
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
  const orders = readJSON('orders.json');
  const idx = orders.findIndex(o => String(o.id) === String(req.params.id));
  if (idx === -1) return res.status(404).json({ success: false, message: 'Order not found' });
  
  const order = orders[idx];
  const newStatus = req.body.status;
  
  order.status = newStatus;
  order.lastUpdated = new Date().toISOString();
  
  if (!Array.isArray(order.statusHistory)) order.statusHistory = [];
  
  order.statusHistory.push({
    status: newStatus,
    changedBy: req.headers['x-user-role'] || 'system',
    date: order.lastUpdated
  });
  
  writeJSON('orders.json', orders);
  res.json({ success: true, order });
});

app.put('/api/orders/:id/assign', requirePerm('update_orders'), (req, res) => {
  const orders = readJSON('orders.json');
  const idx = orders.findIndex(o => String(o.id) === String(req.params.id));
  if (idx === -1) return res.status(404).json({ success: false, message: 'Order not found' });
  
  orders[idx].assignedTo = req.body.userId;
  orders[idx].lastUpdated = new Date().toISOString();
  
  writeJSON('orders.json', orders);
  res.json({ success: true, order: orders[idx] });
});

app.delete('/api/orders/:id', requirePerm('delete_orders'), (req, res) => {
  let orders = readJSON('orders.json');
  const exists = orders.some(o => String(o.id) === String(req.params.id));
  if (!exists) return res.status(404).json({ success: false, message: 'Order not found' });
  orders = orders.filter(o => String(o.id) !== String(req.params.id));
  writeJSON('orders.json', orders);
  res.json({ success: true, message: 'Order deleted successfully' });
});

app.post('/api/orders/:id/note', requirePerm('add_order_notes'), (req, res) => {
  const orders = readJSON('orders.json');
  const idx = orders.findIndex(o => String(o.id) === String(req.params.id));
  if (idx === -1) return res.status(404).json({ success: false, message: 'Order not found' });
  
  const order = orders[idx];
  if (!Array.isArray(order.internalComments)) order.internalComments = [];
  
  order.internalComments.push({
    text: req.body.note,
    addedBy: req.headers['x-user-role'] || 'system',
    date: new Date().toISOString()
  });
  order.lastUpdated = new Date().toISOString();
  
  writeJSON('orders.json', orders);
  res.json({ success: true, order });
});

/* =========================
   API: COUPONS
========================= */
app.get('/api/coupons', requirePerm('view_coupons'), (req, res) => {
  res.json(readJSON('coupons.json'));
});

app.post('/api/coupons/validate', (req, res) => {
  try {
    const { code } = req.body;
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ success: false, message: 'رمز الخصم غير صحيح' });
    }

    const coupons = readJSON('coupons.json');
    const coupon = coupons.find(c => c.code.toUpperCase() === code.toUpperCase());

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

    const coupons = readJSON('coupons.json');
    if (coupons.find(c => c.code.toUpperCase() === code.toUpperCase())) {
      return res.status(400).json({ success: false, message: 'رمز الخصم موجود بالفعل' });
    }

    const newCoupon = {
      code: code.toUpperCase(),
      discountPercent,
      maxUses: maxUses || -1,
      usedCount: 0,
      active: true,
      expiryDate: expiryDate || '2099-12-31'
    };
    coupons.push(newCoupon);
    writeJSON('coupons.json', coupons);
    res.json({ success: true, data: newCoupon });
  } catch (err) {
    console.error('[COUPON CREATE ERROR]', err);
    res.status(500).json({ success: false, message: 'فشل إنشاء الخصم' });
  }
});

app.put('/api/coupons/:code', requirePerm('manage_coupons'), (req, res) => {
  try {
    const coupons = readJSON('coupons.json');
    const idx = coupons.findIndex(c => c.code.toUpperCase() === req.params.code.toUpperCase());
    if (idx === -1) {
      return res.status(404).json({ success: false, message: 'الخصم غير موجود' });
    }

    coupons[idx] = { ...coupons[idx], ...req.body };
    writeJSON('coupons.json', coupons);
    res.json({ success: true, data: coupons[idx] });
  } catch (err) {
    console.error('[COUPON UPDATE ERROR]', err);
    res.status(500).json({ success: false, message: 'فشل تحديث الخصم' });
  }
});

app.delete('/api/coupons/:code', requirePerm('manage_coupons'), (req, res) => {
  try {
    let coupons = readJSON('coupons.json');
    coupons = coupons.filter(c => c.code.toUpperCase() !== req.params.code.toUpperCase());
    writeJSON('coupons.json', coupons);
    res.json({ success: true, message: 'تم حذف الخصم' });
  } catch (err) {
    console.error('[COUPON DELETE ERROR]', err);
    res.status(500).json({ success: false, message: 'فشل حذف الخصم' });
  }
});

/* =========================
   API: AUTHENTICATION (NO AUTH REQUIRED)
========================= */
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'اسم المستخدم وكلمة المرور مطلوبان' });
  }
  
  const users = readJSON('users.json');
  const normalized = String(username).trim().toLowerCase();
  const user = users.find(u => 
    String(u.username || '').toLowerCase() === normalized || 
    String(u.email || '').toLowerCase() === normalized
  );
  
  if (!user) {
    return res.status(401).json({ success: false, message: 'اسم المستخدم غير موجود' });
  }
  
  if (user.password !== password) {
    return res.status(401).json({ success: false, message: 'كلمة المرور غير صحيحة' });
  }
  
  if (!user.active) {
    return res.status(403).json({ success: false, message: 'الحساب موقوف. تواصل مع المسؤول' });
  }
  
  // Return user without password
  const { password: _, ...userWithoutPassword } = user;
  res.json({ success: true, data: userWithoutPassword });
});

/* =========================
   API: USERS
========================= */
app.get('/api/users', requirePerm('view_users'), (req, res) => {
  res.json(readJSON('users.json'));
});

app.post('/api/users', requirePerm('add_users'), (req, res) => {
  const users = readJSON('users.json');
  const newUser = { 
    id: 'u' + Date.now().toString(36), 
    ...req.body, 
    active: req.body.active !== false,
    createdAt: new Date().toISOString().split('T')[0]
  };
  users.push(newUser);
  writeJSON('users.json', users);
  res.json(newUser);
});

app.put('/api/users/:id', requirePerm('edit_users'), (req, res) => {
  const users = readJSON('users.json');
  const idx = users.findIndex(u => String(u.id) === String(req.params.id));
  if (idx === -1) return res.status(404).json({ success: false, message: 'User not found' });
  
  const targetUser = users[idx];
  // Check if we are deactivating or changing role of the last active super_admin
  const isSuperAdmin = targetUser.role === 'super_admin';
  const isDeactivating = req.body.active === false || (req.body.role && req.body.role !== 'super_admin');
  
  if (isSuperAdmin && isDeactivating) {
    const activeSuperAdmins = users.filter(u => u.role === 'super_admin' && u.active);
    if (activeSuperAdmins.length <= 1) {
      return res.status(400).json({ success: false, message: 'لا يمكن إلغاء تنشيط أو تغيير دور آخر مدير عام (Super Admin) في النظام!' });
    }
  }

  users[idx] = { ...users[idx], ...req.body };
  writeJSON('users.json', users);
  res.json(users[idx]);
});

app.delete('/api/users/:id', requirePerm('delete_users'), (req, res) => {
  const users = readJSON('users.json');
  const idx = users.findIndex(u => String(u.id) === String(req.params.id));
  if (idx === -1) return res.status(404).json({ success: false, message: 'User not found' });

  const targetUser = users[idx];
  if (targetUser.role === 'super_admin') {
    const superAdmins = users.filter(u => u.role === 'super_admin');
    if (superAdmins.length <= 1) {
      return res.status(400).json({ success: false, message: 'لا يمكن حذف آخر مدير عام (Super Admin) في النظام!' });
    }
  }

  const filtered = users.filter(u => String(u.id) !== String(req.params.id));
  writeJSON('users.json', filtered);
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
  writeJSON('permissions.json', newPerms);
  res.json({ success: true, permissions: newPerms });
});

/* =========================
   API: STORE SETTINGS
========================= */
app.get('/api/settings', (req, res) => {
  const settings = readJSON('settings.json');
  res.json(settings[0] || {});
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

  const settings = readJSON('settings.json');
  if (settings.length > 0) {
    settings[0] = { ...settings[0], ...req.body };
  } else {
    settings.push({ id: 'loulo-beauty', ...req.body });
  }
  writeJSON('settings.json', settings);
  res.json(settings[0]);
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
      const orders = readJSON('orders.json');
      const list = ids ? String(ids).split(',').map(s => s.trim()).filter(Boolean) : [String(id)];
      const missing = list.filter(i => !findOrderByIdOrNumber(orders, i));
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