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
const invoiceRepository = require('./backend/src/repositories/invoiceRepository');
const invoiceService = require('./backend/src/services/invoiceService');
const receiptRepository = require('./backend/src/repositories/receiptRepository');
const expenseRepository = require('./backend/src/repositories/expenseRepository');
const statementService = require('./backend/src/services/statementService');
const jwt = require('jsonwebtoken');

let prisma = null;
try {
  const { PrismaClient } = require('@prisma/client');
  prisma = new PrismaClient();
} catch (err) {
  console.warn('Prisma not available (DATABASE_URL missing or @prisma/client not installed). Proceeding with JSON-based features only.');
}

let puppeteer = null;
try {
  puppeteer = require('puppeteer');
} catch (error) {
  console.warn('Puppeteer is not installed. PDF generation will be disabled.');
}

function getPuppeteerExecutablePath() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    console.log('[PDF] Using PUPPETEER_EXECUTABLE_PATH:', process.env.PUPPETEER_EXECUTABLE_PATH);
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  if (process.env.CHROME_PATH) {
    console.log('[PDF] Using CHROME_PATH:', process.env.CHROME_PATH);
    return process.env.CHROME_PATH;
  }
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        console.log('[PDF] Found browser at:', candidate);
        return candidate;
      }
    } catch (_) {}
  }
  return null;
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

  // x-user-role bypass removed in Security Phase 1 — see tag before-security-phase-1

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

// Shared Puppeteer PDF helper — renders HTML to PDF buffer
async function generatePdfFromHtml(html, options = {}) {
  if (!puppeteer) throw new Error('Puppeteer is not available.');
  const execPath = getPuppeteerExecutablePath();
  const launchOpts = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  };
  if (execPath) launchOpts.executablePath = execPath;
  const browser = await puppeteer.launch(launchOpts);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 900 });
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: PUPPETEER_TIMEOUT });
    await page.emulateMediaType('print');
    const buffer = await page.pdf({
      format: options.format || 'A4',
      margin: options.margin || { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' },
      printBackground: true,
      preferCSSPageSize: true,
    });
    return buffer;
  } finally {
    if (browser) await browser.close();
  }
}

// Shared PDF style block
function pdfStyles() {
  return `
<style>
  @page { size: A4; margin: 12mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; color: #222; font-size: 13px; line-height: 1.5; direction: rtl; background: #fff; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; }
  .store { text-align: right; }
  .store-logo { max-height: 70px; margin-bottom: 10px; display: block; }
  .store-name { font-size: 22px; font-weight: 700; color: #111; margin-bottom: 4px; }
  .store-info { font-size: 12px; color: #555; line-height: 1.6; }
  .meta { text-align: left; }
  .doc-title { font-size: 20px; font-weight: 700; color: #111; margin-bottom: 6px; }
  .doc-info { font-size: 12px; color: #555; line-height: 1.6; }
  .status-badge { display: inline-block; margin-top: 6px; padding: 3px 12px; border-radius: 12px; font-size: 12px; font-weight: 600; }
  .status-badge.active { background: #dcfce7; color: #166534; }
  .status-badge.cancelled { background: #fee2e2; color: #991b1b; }
  .divider { height: 1px; background: #ddd; margin: 16px 0; }
  .section-title { font-size: 14px; font-weight: 700; color: #333; margin-bottom: 8px; }
  .info-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .info-table td { padding: 3px 0; border: none; }
  .info-table td.lbl { width: 120px; font-weight: 600; color: #555; }
  .data-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .data-table th { background: #f5f5f5; padding: 8px 6px; font-weight: 600; color: #333; border-bottom: 2px solid #ddd; text-align: center; }
  .data-table td { padding: 8px 6px; border-bottom: 1px solid #eee; text-align: center; }
  .signature-area { margin-top: 50px; display: flex; justify-content: space-between; }
  .signature-box { text-align: center; }
  .signature-line { width: 200px; height: 1px; background: #333; margin: 40px auto 6px; }
  .signature-label { font-size: 12px; color: #555; }
  .footer { text-align: center; margin-top: 40px; padding-top: 16px; border-top: 1px solid #ddd; }
  .footer-text { font-size: 16px; font-weight: 600; color: #333; margin-bottom: 4px; }
  .footer-sub { font-size: 11px; color: #888; }
  .summary-box { margin-top: 16px; padding: 12px; background: #f9f9f9; border-radius: 6px; border: 1px solid #ddd; }
  .summary-box table { width: 100%; }
  .summary-box td { padding: 4px 8px; font-size: 13px; }
  .summary-box td.lbl { font-weight: 600; color: #555; width: 160px; }
  .summary-box td.val { font-weight: 700; }
  .payment-info { margin-top: 12px; padding: 12px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; }
  .payment-info td.lbl { color: #166534; }
  .payment-info td.val { color: #166534; }
</style>`;
}

// Shared PDF header (store info right, doc meta left)
function pdfHeader(settings, docTitle, docMeta) {
  const logoUrl = settings?.logo || settings?.logoImage || (settings?.branding && settings.branding.logo) || '';
  return `<div class="header">
    <div class="store">
      ${logoUrl ? `<img src="${logoUrl}" class="store-logo" />` : ''}
      <div class="store-name">${settings?.storeName || settings?.name || ''}</div>
      <div class="store-info">${settings?.phone || ''}</div>
      <div class="store-info">${settings?.email || ''}</div>
      <div class="store-info">${settings?.address || ''}</div>
    </div>
    <div class="meta">
      <div class="doc-title">${docTitle}</div>
      ${Object.entries(docMeta || {}).map(([k, v]) => `<div class="doc-info">${k}: ${v}</div>`).join('')}
    </div>
  </div>`;
}

// Shared PDF footer
function pdfFooter() {
  return `<div class="footer"><div class="footer-text">شكراً لتعاملكم معنا</div><div class="footer-sub">Generated by EVA System</div></div>`;
}

async function createPdfFromPrintPage({ ids, type = 'invoice', saveToDisk = false, filename = null, port }) {
  if (!puppeteer) {
    throw new Error('Puppeteer is not available.');
  }
  const execPath = getPuppeteerExecutablePath();
  const launchOpts = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  };
  if (execPath) {
    launchOpts.executablePath = execPath;
  }
  const browser = await puppeteer.launch(launchOpts);

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

    await new Promise(r => setTimeout(r, 600));

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
    "view_settings", "edit_store_info", "edit_branding", "edit_legal_pages",
    "edit_payment_settings", "edit_shipping_settings"
  ],
  store_manager: [
    "view_dashboard", "view_analytics",
    "view_products", "add_products", "edit_products", "delete_products",
    "view_categories", "manage_categories",
    "view_orders", "update_orders", "delete_orders", "add_order_notes",
    "view_coupons", "manage_coupons",
    "view_customers", "manage_customers",
    "view_settings", "edit_store_info", "edit_branding", "edit_legal_pages",
    "edit_payment_settings", "edit_shipping_settings"
  ],
  manager: [
    "view_dashboard", "view_analytics",
    "view_products", "add_products", "edit_products", "delete_products",
    "view_categories", "manage_categories",
    "view_orders", "update_orders", "add_order_notes",
    "view_coupons", "manage_coupons",
    "view_customers",
    "view_settings"
  ],
  employee: [
    "view_products", "view_categories", "view_coupons",
    "view_orders", "update_orders", "add_order_notes",
    "view_settings"
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
    // Merge defaults for all roles so new permissions are always present
    Object.keys(DEFAULT_PERMISSIONS).forEach(role => {
      const defaults = DEFAULT_PERMISSIONS[role] || [];
      const existing = data[role] || [];
      data[role] = [...new Set([...defaults, ...existing])];
    });
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

app.get('/api/products/:id', (req, res) => {
  const product = productRepository.findById(req.params.id);
  if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
  res.json(product);
});

app.get('/api/products/:id/label/pdf', requirePerm('view_products'), async (req, res) => {
  if (!puppeteer) {
    return res.status(503).json({ success: false, message: 'PDF generation unavailable - Puppeteer not installed.' });
  }
  try {
    const product = productRepository.findById(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
    const productId = String(product.id).replace(/[^a-zA-Z0-9_-]/g, '');
    const filename = `PRODUCT-LABEL-${productId}.pdf`;
    const printUrl = `http://127.0.0.1:${PORT}/product-label?id=${encodeURIComponent(req.params.id)}`;
    const execPath = getPuppeteerExecutablePath();
    const launchOpts = { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] };
    if (execPath) launchOpts.executablePath = execPath;
    const browser = await puppeteer.launch(launchOpts);
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 800, height: 600 });
      await page.goto(printUrl, { waitUntil: 'networkidle2', timeout: PUPPETEER_TIMEOUT });
      await page.emulateMediaType('print');
      await new Promise(r => setTimeout(r, 600));
      const buffer = await page.pdf({
        width: '70mm', height: '40mm',
        margin: { top: '0mm', bottom: '0mm', left: '0mm', right: '0mm' },
        printBackground: true,
        preferCSSPageSize: true,
      });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(buffer);
    } finally {
      await browser.close();
    }
  } catch (err) {
    console.error('[PRODUCT LABEL PDF ERROR]', err);
    res.status(500).json({ success: false, message: 'فشل توليد PDF ليبل المنتج' });
  }
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
  const { parentId } = req.body;
  if (parentId && String(parentId).trim() !== '') {
    if (String(parentId) === String(req.params.id)) {
      return res.status(400).json({ error: 'لا يمكن أن يكون التصنيف أباً لنفسه' });
    }
    const allCategories = categoryRepository.findAll();
    const visited = new Set();
    let current = String(parentId);
    while (current) {
      if (current === String(req.params.id)) {
        return res.status(400).json({ error: 'لا يمكن أن يكون التصنيف فرعاً من تصنيف فرعي تابع له' });
      }
      if (visited.has(current)) break;
      visited.add(current);
      const parent = allCategories.find(c => String(c.id) === current);
      current = parent && parent.parentId ? String(parent.parentId) : null;
    }
  }
  const updated = categoryRepository.update(req.params.id, req.body);
  if (!updated) return res.status(404).json({ error: 'Category not found' });
  res.json(updated);
});

app.delete('/api/categories/:id', requirePerm('manage_categories'), (req, res) => {
  const children = categoryRepository.findChildren(req.params.id);
  if (children.length > 0) {
    categoryRepository.reassignChildrenToRoot(req.params.id);
  }
  const deleted = categoryRepository.delete(req.params.id);
  if (!deleted) return res.status(404).json({ error: 'Category not found' });
  res.json({ ok: true, childrenReassigned: children.length });
});

/* =========================
   API: INVOICES
========================= */
app.get('/api/invoices', requirePerm('view_dashboard'), (req, res) => {
  try {
    const invoices = invoiceRepository.findAll();
    res.json({ success: true, invoices });
  } catch (err) {
    console.error('[INVOICES GET ERROR]', err);
    res.status(500).json({ success: false, message: 'فشل تحميل الفواتير' });
  }
});

app.get('/api/invoices/:id', requirePerm('view_orders'), (req, res) => {
  try {
    const invoice = invoiceRepository.findById(req.params.id);
    if (!invoice) return res.status(404).json({ success: false, message: 'الفاتورة غير موجودة' });
    res.json(invoice);
  } catch (err) {
    console.error('[INVOICE GET SINGLE ERROR]', err);
    res.status(500).json({ success: false, message: 'فشل تحميل تفاصيل الفاتورة' });
  }
});

app.get('/api/invoices/:id/pdf', requirePerm('view_orders'), async (req, res) => {
  if (!puppeteer) {
    return res.status(503).json({
      success: false,
      message: 'PDF generation is currently unavailable because Puppeteer is not installed.'
    });
  }
  try {
    const invoice = invoiceRepository.findById(req.params.id);
    if (!invoice) return res.status(404).json({ success: false, message: 'الفاتورة غير موجودة' });

    const { snapshot, customer, items, total, status, createdAt, sourceType, sourceId, cancelledAt, cancelReason } = invoice;
    const currency = snapshot?.currency || '';
    const sourceLabel = sourceType === 'order' ? 'طلب إلكتروني' : 'بيع مباشر';
    const statusLabel = status === 'cancelled' ? 'ملغاة' : 'نشطة';
    const subtotal = invoice.subtotal ?? (items || []).reduce((sum, item) => sum + Number(item.total || (item.price * item.qty)), 0);
    const shipping = invoice.shipping ?? 0;
    const discount = invoice.discount ?? 0;
    const invPayment = computeInvoicePaymentStatus(invoice, receiptRepository.findAll());
    const payLabels = { paid: 'مدفوعة', partial: 'مدفوعة جزئياً', unpaid: 'غير مدفوعة', cancelled: 'ملغاة' };
    const payBadgeColors = { paid: '#166534', partial: '#d97706', unpaid: '#991b1b', cancelled: '#888' };
    const payBgColors = { paid: '#dcfce7', partial: '#fef3c7', unpaid: '#fee2e2', cancelled: '#f5f5f5' };
    const badgeStyle = `display:inline-block;padding:3px 12px;border-radius:12px;font-size:12px;font-weight:600;background:${payBgColors[invPayment._paymentStatus]};color:${payBadgeColors[invPayment._paymentStatus]}`;

    const html = `<!DOCTYPE html>
<html dir="rtl">
<head><meta charset="utf-8"><title>${invoice.id}</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; color: #222; font-size: 13px; line-height: 1.5; direction: rtl; background: #fff; }
  .invoice-print-watermark { position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%) rotate(-30deg); font-size: 80px; font-weight: 900; color: rgba(220,38,38,0.1); white-space: nowrap; pointer-events: none; z-index: 0; }
  .invoice-print-watermark.active { display: none; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; position: relative; z-index: 1; }
  .store { text-align: right; }
  .store-logo { max-height: 70px; margin-bottom: 10px; display: block; }
  .store-name { font-size: 22px; font-weight: 700; color: #111; margin-bottom: 4px; }
  .store-info { font-size: 12px; color: #555; line-height: 1.6; }
  .meta { text-align: left; }
  .inv-id { font-size: 20px; font-weight: 700; color: #111; margin-bottom: 6px; }
  .inv-info { font-size: 12px; color: #555; line-height: 1.6; }
  .status-badge { display: inline-block; margin-top: 6px; padding: 3px 12px; border-radius: 12px; font-size: 12px; font-weight: 600; }
  .status-badge.active { background: #dcfce7; color: #166534; }
  .status-badge.cancelled { background: #fee2e2; color: #991b1b; }
  .divider { height: 1px; background: #ddd; margin: 16px 0; }
  .section-title { font-size: 14px; font-weight: 700; color: #333; margin-bottom: 8px; }
  .cust-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .cust-table td { padding: 3px 0; border: none; }
  .cust-table td.lbl { width: 100px; font-weight: 600; color: #555; }
  .items-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .items-table th { background: #f5f5f5; padding: 8px 6px; font-weight: 600; color: #333; border-bottom: 2px solid #ddd; text-align: center; }
  .items-table td { padding: 8px 6px; border-bottom: 1px solid #eee; text-align: center; }
  .items-table .col-product { text-align: right; font-weight: 600; }
  .totals { display: flex; justify-content: flex-end; margin-top: 16px; }
  .totals-table { width: 260px; border-collapse: collapse; font-size: 13px; }
  .totals-table td { padding: 4px 8px; border: none; }
  .totals-table td.lbl { text-align: right; color: #555; }
  .totals-table td.val { text-align: left; font-weight: 600; }
  .totals-table .grand td { border-top: 2px solid #333; padding-top: 8px; font-size: 15px; font-weight: 700; }
  .cancel-info { margin-top: 20px; padding: 12px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; }
  .footer { text-align: center; margin-top: 40px; padding-top: 16px; border-top: 1px solid #ddd; }
  .footer-text { font-size: 16px; font-weight: 600; color: #333; margin-bottom: 4px; }
  .footer-sub { font-size: 11px; color: #888; }
</style></head>
<body>
  <div class="invoice-print-watermark ${status}">${status === 'cancelled' ? 'فاتورة ملغاة' : ''}</div>
  <div class="header">
    <div class="store">
      ${snapshot?.logo ? `<img src="${snapshot.logo}" class="store-logo" />` : ''}
      <div class="store-name">${snapshot?.storeName || ''}</div>
      <div class="store-info">${snapshot?.phone || ''}</div>
      <div class="store-info">${snapshot?.email || ''}</div>
      <div class="store-info">${snapshot?.address || ''}</div>
    </div>
    <div class="meta">
      <div class="inv-id">${invoice.id}</div>
      <div class="inv-info">${new Date(createdAt).toLocaleString('ar-EG')}</div>
      <div class="inv-info">${sourceLabel}</div>
      <div class="status-badge ${status}">${statusLabel}</div>
    </div>
  </div>
  <div class="divider"></div>
  <div class="section-title">بيانات العميل</div>
  <table class="cust-table">
    <tr><td class="lbl">الاسم</td><td>${customer?.name || '—'}</td></tr>
    <tr><td class="lbl">الهاتف</td><td>${customer?.phone || '—'}</td></tr>
    <tr><td class="lbl">العنوان</td><td>${customer?.address || '—'}</td></tr>
  </table>
  <div class="divider"></div>
  <div class="section-title">التفاصيل</div>
  <table class="items-table">
    <thead><tr><th class="col-product">المنتج</th><th>سعر الوحدة</th><th>الكمية</th><th>المجموع</th></tr></thead>
    <tbody>${(items || []).map(item => `<tr><td class="col-product">${item.name}</td><td>${Number(item.price).toFixed(2)} ${currency}</td><td>${item.qty}</td><td>${Number(item.total || (item.price * item.qty)).toFixed(2)} ${currency}</td></tr>`).join('')}</tbody>
  </table>
  <div class="totals">
    <table class="totals-table">
      <tr><td class="lbl">المجموع الفرعي</td><td class="val">${Number(subtotal).toFixed(2)} ${currency}</td></tr>
      <tr><td class="lbl">الخصم</td><td class="val">${Number(discount).toFixed(2)} ${currency}</td></tr>
      <tr><td class="lbl">الشحن</td><td class="val">${Number(shipping).toFixed(2)} ${currency}</td></tr>
      <tr class="grand"><td class="lbl">الإجمالي</td><td class="val">${Number(total).toFixed(2)} ${currency}</td></tr>
    </table>
  </div>
  ${status !== 'cancelled' ? `<div class="divider"></div><div class="section-title">حالة الدفع</div><div style="margin-top:8px;padding:12px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;"><table class="cust-table"><tr><td class="lbl">المدفوع</td><td style="font-weight:700;color:#166534">${Number(invPayment._totalPaid).toFixed(2)} ${currency}</td></tr><tr><td class="lbl">المتبقي</td><td style="font-weight:700;color:${invPayment._remaining > 0 ? '#991b1b' : '#166534'}">${Number(invPayment._remaining).toFixed(2)} ${currency}</td></tr><tr><td class="lbl">الحالة</td><td><span style="${badgeStyle}">${payLabels[invPayment._paymentStatus]}</span></td></tr></table></div>` : ''}
  ${status === 'cancelled' ? `<div class="cancel-info"><div class="section-title">معلومات الإلغاء</div><table class="cust-table"><tr><td class="lbl">تاريخ الإلغاء</td><td>${cancelledAt ? new Date(cancelledAt).toLocaleString('ar-EG') : '—'}</td></tr><tr><td class="lbl">السبب</td><td>${cancelReason || '—'}</td></tr></table></div>` : ''}
  <div class="footer"><div class="footer-text">شكراً لتعاملكم معنا</div><div class="footer-sub">Generated by EVA System</div></div>
</body></html>`;

    const execPath = getPuppeteerExecutablePath();
    const launchOpts = {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    };
    if (execPath) {
      launchOpts.executablePath = execPath;
    }
    const browser = await puppeteer.launch(launchOpts);
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1200, height: 900 });
      await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });
      await page.emulateMediaType('print');
      const buffer = await page.pdf({
        format: 'A4',
        margin: { top: '0mm', bottom: '0mm', left: '0mm', right: '0mm' },
        printBackground: true,
        preferCSSPageSize: true,
      });
      const filename = `${invoice.id}.pdf`;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(buffer);
    } finally {
      if (browser) await browser.close();
    }
  } catch (err) {
    console.error('[INVOICE PDF ERROR]', err);
    res.status(500).json({ success: false, message: 'فشل توليد PDF الفاتورة' });
  }
});

// ===== Receipt PDF =====
app.get('/api/receipts/:id/pdf', requirePerm('view_orders'), async (req, res) => {
  if (!puppeteer) return res.status(503).json({ success: false, message: 'PDF غير متاح حالياً' });
  try {
    const receipt = receiptRepository.findById(req.params.id);
    if (!receipt) return res.status(404).json({ success: false, message: 'سند القبض غير موجود' });
    const settings = settingsRepository.findFirst() || {};
    const currency = settings.currencySymbol || '₪';
    const isCancelled = receipt.status === 'cancelled';
    const methodLabels = { cash: 'نقداً', cheque: 'شيك', bank_transfer: 'تحويل بنكي', visa: 'بطاقة ائتمان' };
    const html = `<!DOCTYPE html>
<html dir="rtl"><head><meta charset="utf-8"><title>${receipt.voucherNumber || receipt.id}</title>${pdfStyles()}</head>
<body>
  ${pdfHeader(settings, 'سند قبض', {'الرقم': receipt.voucherNumber || receipt.id, 'التاريخ': new Date(receipt.date || receipt.createdAt).toLocaleString('ar-EG')})}
  <div class="divider"></div>
  <div class="section-title">بيانات العميل</div>
  <table class="info-table">
    <tr><td class="lbl">الاسم</td><td>${receipt.customerName || '—'}</td></tr>
    <tr><td class="lbl">الهاتف</td><td>${receipt.customerPhone || '—'}</td></tr>
  </table>
  <div class="divider"></div>
  <div class="section-title">تفاصيل السند</div>
  <table class="info-table">
    <tr><td class="lbl">المبلغ</td><td style="font-weight:700;font-size:15px">${Number(receipt.amount).toFixed(2)} ${currency}</td></tr>
    <tr><td class="lbl">طريقة الدفع</td><td>${methodLabels[receipt.paymentMethod] || receipt.paymentMethod}</td></tr>
    ${receipt.referenceNumber ? `<tr><td class="lbl">رقم المرجع</td><td>${receipt.referenceNumber}</td></tr>` : ''}
    ${receipt.linkedTo === 'invoice' && receipt.linkedId ? `<tr><td class="lbl">مرتبط بفاتورة</td><td>${receipt.linkedId}</td></tr>` : ''}
    ${receipt.chequeNumber ? `<tr><td class="lbl">رقم الشيك</td><td>${receipt.chequeNumber}</td></tr>` : ''}
    ${receipt.bankName ? `<tr><td class="lbl">البنك</td><td>${receipt.bankName}</td></tr>` : ''}
    ${receipt.dueDate ? `<tr><td class="lbl">تاريخ الاستحقاق</td><td>${new Date(receipt.dueDate).toLocaleDateString('ar-EG')}</td></tr>` : ''}
    ${receipt.paymentMethod === 'cheque' && receipt.chequeStatus ? `<tr><td class="lbl">حالة الشيك</td><td>${chequeNoteLabel(receipt.chequeStatus)}</td></tr>` : ''}
    ${receipt.notes ? `<tr><td class="lbl">ملاحظات</td><td>${receipt.notes}</td></tr>` : ''}
  </table>
  ${isCancelled ? `<div class="divider"></div><div class="cancel-info" style="margin-top:12px;padding:12px;background:#fef2f2;border:1px solid #fecaca;border-radius:6px;"><div class="section-title">ملغي</div><table class="info-table"><tr><td class="lbl">تاريخ الإلغاء</td><td>${receipt.cancelledAt ? new Date(receipt.cancelledAt).toLocaleString('ar-EG') : '—'}</td></tr><tr><td class="lbl">السبب</td><td>${receipt.cancelReason || '—'}</td></tr></table></div>` : ''}
  <div class="signature-area">
    <div class="signature-box"><div class="signature-line"></div><div class="signature-label">التوقيع</div></div>
    <div class="signature-box"><div class="signature-line"></div><div class="signature-label">ختم الشركة</div></div>
  </div>
  ${pdfFooter()}
</body></html>`;
    const buffer = await generatePdfFromHtml(html);
    const filename = `${receipt.voucherNumber || receipt.id}.pdf`;
    const safeFilename = filename.replace(/[^\x00-\x7F]/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
    res.send(buffer);
  } catch (err) {
    console.error('[RECEIPT PDF ERROR]', err);
    res.status(500).json({ success: false, message: 'فشل توليد PDF سند القبض' });
  }
});

// ===== Expense PDF =====
app.get('/api/expenses/:id/pdf', requirePerm('view_orders'), async (req, res) => {
  if (!puppeteer) return res.status(503).json({ success: false, message: 'PDF غير متاح حالياً' });
  try {
    const expense = expenseRepository.findById(req.params.id);
    if (!expense) return res.status(404).json({ success: false, message: 'سند الصرف غير موجود' });
    const settings = settingsRepository.findFirst() || {};
    const currency = settings.currencySymbol || '₪';
    const catLabels = { rent: 'إيجار', salaries: 'رواتب', marketing: 'تسويق', shipping: 'شحن', inventory_purchase: 'مشتريات مخزون', maintenance: 'صيانة', utilities: 'فواتير خدمات', other: 'أخرى' };
    const methodLabels = { cash: 'نقداً', cheque: 'شيك', bank_transfer: 'تحويل بنكي', visa: 'بطاقة ائتمان' };
    const html = `<!DOCTYPE html>
<html dir="rtl"><head><meta charset="utf-8"><title>${expense.voucherNumber || expense.id}</title>${pdfStyles()}</head>
<body>
  ${pdfHeader(settings, 'سند صرف', {'الرقم': expense.voucherNumber || expense.id, 'التاريخ': new Date(expense.date || expense.createdAt).toLocaleString('ar-EG')})}
  <div class="divider"></div>
  <div class="section-title">تفاصيل السند</div>
  <table class="info-table">
    <tr><td class="lbl">المدفوع له</td><td>${expense.payee || '—'}</td></tr>
    <tr><td class="lbl">التصنيف</td><td>${catLabels[expense.category] || expense.category}</td></tr>
    <tr><td class="lbl">المبلغ</td><td style="font-weight:700;font-size:15px">${Number(expense.amount).toFixed(2)} ${currency}</td></tr>
    <tr><td class="lbl">طريقة الدفع</td><td>${methodLabels[expense.paymentMethod] || expense.paymentMethod}</td></tr>
    ${expense.notes ? `<tr><td class="lbl">ملاحظات</td><td>${expense.notes}</td></tr>` : ''}
  </table>
  <div class="signature-area">
    <div class="signature-box"><div class="signature-line"></div><div class="signature-label">التوقيع</div></div>
  </div>
  ${pdfFooter()}
</body></html>`;
    const buffer = await generatePdfFromHtml(html);
    const filename = `${expense.voucherNumber || expense.id}.pdf`;
    const safeFilename = filename.replace(/[^\x00-\x7F]/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
    res.send(buffer);
  } catch (err) {
    console.error('[EXPENSE PDF ERROR]', err);
    res.status(500).json({ success: false, message: 'فشل توليد PDF سند الصرف' });
  }
});

/* =========================
   API: RECEIPTS (سندات قبض)
========================= */

function computeInvoicePaymentStatus(invoice, allReceipts) {
  if (!invoice || invoice.status === 'cancelled') {
    return { _paymentStatus: 'cancelled', _totalPaid: 0, _remaining: 0, _receiptCount: 0 };
  }
  const linked = (allReceipts || []).filter(r =>
    r.linkedTo === 'invoice' && String(r.linkedId) === String(invoice.id) && r.status !== 'cancelled'
  );
  const totalPaid = linked.reduce((s, r) => {
    if (!statementService.isReceiptCreditable(r)) return s;
    return s + (Number(r.amount) || 0);
  }, 0);
  const total = Number(invoice.total) || 0;
  const remaining = Math.max(0, total - totalPaid);
  let paymentStatus = 'unpaid';
  if (totalPaid > 0 && totalPaid < total) paymentStatus = 'partial';
  else if (totalPaid >= total) paymentStatus = 'paid';
  return { _paymentStatus: paymentStatus, _totalPaid: totalPaid, _remaining: remaining, _receiptCount: linked.length };
}

function generateVoucherNumber(prefix, existing) {
  const year = new Date().getFullYear();
  const nextSeq = (existing || []).filter(e => String(e.voucherNumber || '').startsWith(prefix + '-' + year)).length + 1;
  return prefix + '-' + year + '-' + String(nextSeq).padStart(6, '0');
}

app.post('/api/receipts', requirePerm('update_orders'), (req, res) => {
  try {
    const { amount, paymentMethod, customerName, customerPhone, linkedTo, linkedId, notes, referenceNumber, chequeNumber, bankName, dueDate } = req.body;
    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ success: false, message: 'المبلغ مطلوب ويجب أن يكون أكبر من صفر' });
    }

    // Overpayment validation for invoice-linked receipts
    let resolvedCustomerName = typeof customerName === 'string' ? customerName.trim() : '';
    if (linkedTo === 'invoice' && linkedId) {
      const inv = invoiceRepository.findById(linkedId);
      if (!inv) {
        return res.status(404).json({ success: false, message: 'الفاتورة غير موجودة' });
      }
      if (inv.status === 'cancelled') {
        return res.status(400).json({ success: false, message: 'لا يمكن إضافة دفعة لفاتورة ملغية' });
      }
      // Auto-populate customer name from invoice if not provided (Fix D)
      if (!resolvedCustomerName && inv.customer && inv.customer.name) {
        resolvedCustomerName = inv.customer.name;
      }
      const allReceipts = receiptRepository.findAll();
      const creditableSum = allReceipts.filter(r =>
        r.linkedTo === 'invoice' &&
        String(r.linkedId) === String(linkedId) &&
        r.status !== 'cancelled' &&
        statementService.isReceiptCreditable(r)
      ).reduce((s, r) => s + (Number(r.amount) || 0), 0);
      const allowed = Number(inv.total) - creditableSum;
      if (Number(amount) > allowed) {
        return res.status(400).json({
          success: false,
          message: `المبلغ يتجاوز المتبقي على الفاتورة. المتبقي المسموح: ${allowed.toFixed(2)}`
        });
      }
    }

    const receipts = receiptRepository.findAll();
    const receipt = {
      id: 'rcp_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
      voucherNumber: generateVoucherNumber('ق', receipts),
      status: 'active',
      date: new Date().toISOString(),
      customerName: resolvedCustomerName,
      customerPhone: customerPhone || '',
      amount: Number(amount),
      paymentMethod: paymentMethod || 'cash',
      referenceNumber: referenceNumber || '',
      chequeNumber: chequeNumber || '',
      bankName: bankName || '',
      dueDate: dueDate || '',
      chequeStatus: (paymentMethod === 'cheque') ? 'pending' : null,
      linkedTo: linkedTo || 'none',
      linkedId: linkedId || null,
      notes: notes || '',
      createdBy: req.user ? req.user.username || req.user.id : 'admin',
      createdAt: new Date().toISOString(),
      cancelledAt: null,
      cancelReason: ''
    };
    receiptRepository.create(receipt);
    res.json({ success: true, data: receipt, message: 'تم تسجيل سند القبض بنجاح' });
  } catch (err) {
    console.error('[RECEIPT POST ERROR]', err);
    res.status(500).json({ success: false, message: 'فشل تسجيل سند القبض' });
  }
});

app.get('/api/receipts', requirePerm('view_dashboard'), (req, res) => {
  try {
    const receipts = receiptRepository.findAll();
    res.json({ success: true, data: receipts });
  } catch (err) {
    console.error('[RECEIPTS GET ERROR]', err);
    res.status(500).json({ success: false, message: 'فشل تحميل سندات القبض' });
  }
});

app.get('/api/receipts/:id', requirePerm('view_dashboard'), (req, res) => {
  try {
    const receipt = receiptRepository.findById(req.params.id);
    if (!receipt) return res.status(404).json({ success: false, message: 'سند القبض غير موجود' });
    res.json(receipt);
  } catch (err) {
    console.error('[RECEIPT GET SINGLE ERROR]', err);
    res.status(500).json({ success: false, message: 'فشل تحميل سند القبض' });
  }
});

app.put('/api/receipts/:id/cancel', requirePerm('update_orders'), (req, res) => {
  try {
    const receipt = receiptRepository.findById(req.params.id);
    if (!receipt) return res.status(404).json({ success: false, message: 'سند القبض غير موجود' });
    if (receipt.status === 'cancelled') {
      return res.status(400).json({ success: false, message: 'سند القبض ملغي بالفعل' });
    }
    const updated = receiptRepository.update(req.params.id, {
      status: 'cancelled',
      cancelledAt: new Date().toISOString(),
      cancelReason: req.body.cancelReason || ''
    });
    res.json({ success: true, data: updated, message: 'تم إلغاء سند القبض' });
  } catch (err) {
    console.error('[RECEIPT CANCEL ERROR]', err);
    res.status(500).json({ success: false, message: 'فشل إلغاء سند القبض' });
  }
});

// ===== Cheque Status Update =====
app.patch('/api/receipts/:id/cheque-status', requirePerm('update_orders'), (req, res) => {
  try {
    const receipt = receiptRepository.findById(req.params.id);
    if (!receipt) return res.status(404).json({ success: false, message: 'سند القبض غير موجود' });
    if (receipt.paymentMethod !== 'cheque') {
      return res.status(400).json({ success: false, message: 'هذا السند ليس شيكاً' });
    }
    if (receipt.status === 'cancelled') {
      return res.status(400).json({ success: false, message: 'لا يمكن تحديث شيك ملغي' });
    }
    const { chequeStatus } = req.body;
    const validStatuses = ['pending', 'collected', 'returned', 'cancelled'];
    if (!validStatuses.includes(chequeStatus)) {
      return res.status(400).json({ success: false, message: 'حالة غير صالحة' });
    }
    const current = receipt.chequeStatus || 'pending';
    const allowedTransitions = {
      pending: ['collected', 'returned', 'cancelled'],
      collected: [],
      returned: [],
      cancelled: []
    };
    if (!allowedTransitions[current].includes(chequeStatus)) {
      return res.status(400).json({ success: false, message: `لا يمكن تغيير الحالة من ${chequeNoteLabel(current)} إلى ${chequeNoteLabel(chequeStatus)}` });
    }
    const updated = receiptRepository.update(req.params.id, { chequeStatus });
    res.json({ success: true, data: updated, message: 'تم تحديث حالة الشيك' });
  } catch (err) {
    console.error('[CHEQUE STATUS ERROR]', err);
    res.status(500).json({ success: false, message: 'فشل تحديث حالة الشيك' });
  }
});

function chequeNoteLabel(status) {
  const labels = { collected: 'تم التحصيل', pending: 'قيد التحصيل', returned: 'مرتجع', cancelled: 'ملغي' };
  return labels[status] || status;
}

/* =========================
   API: EXPENSES (سندات صرف)
========================= */

app.post('/api/expenses', requirePerm('update_orders'), (req, res) => {
  try {
    const { category, payee, amount, paymentMethod, notes } = req.body;
    const validCategories = ['rent', 'salaries', 'marketing', 'shipping', 'inventory_purchase', 'maintenance', 'utilities', 'other'];
    if (!category || !validCategories.includes(category)) {
      return res.status(400).json({ success: false, message: 'الفئة غير صالحة' });
    }
    if (!payee || !payee.trim()) {
      return res.status(400).json({ success: false, message: 'المدفوع له مطلوب' });
    }
    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ success: false, message: 'المبلغ مطلوب ويجب أن يكون أكبر من صفر' });
    }
    const expenses = expenseRepository.findAll();
    const expense = {
      id: 'exp_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
      voucherNumber: generateVoucherNumber('ص', expenses),
      date: new Date().toISOString(),
      category,
      payee: payee.trim(),
      amount: Number(amount),
      paymentMethod: paymentMethod || 'cash',
      notes: notes || '',
      createdBy: req.user ? req.user.username || req.user.id : 'admin',
      createdAt: new Date().toISOString()
    };
    expenseRepository.create(expense);
    res.json({ success: true, data: expense, message: 'تم تسجيل سند الصرف بنجاح' });
  } catch (err) {
    console.error('[EXPENSE POST ERROR]', err);
    res.status(500).json({ success: false, message: 'فشل تسجيل سند الصرف' });
  }
});

app.get('/api/expenses', requirePerm('view_dashboard'), (req, res) => {
  try {
    const expenses = expenseRepository.findAll();
    res.json({ success: true, data: expenses });
  } catch (err) {
    console.error('[EXPENSES GET ERROR]', err);
    res.status(500).json({ success: false, message: 'فشل تحميل سندات الصرف' });
  }
});

app.delete('/api/expenses/:id', requirePerm('update_orders'), (req, res) => {
  try {
    const existed = expenseRepository.delete(req.params.id);
    if (!existed) return res.status(404).json({ success: false, message: 'سند الصرف غير موجود' });
    res.json({ success: true, message: 'تم حذف سند الصرف' });
  } catch (err) {
    console.error('[EXPENSE DELETE ERROR]', err);
    res.status(500).json({ success: false, message: 'فشل حذف سند الصرف' });
  }
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
    const plan = readJSON('store-plan.json');
    if (plan && plan.modules && plan.modules.orders === false) {
      return res.status(403).json({ success: false, message: 'المتجر لا يقبل طلبات حالياً (الميزة غير مفعّلة في خطة المتجر)' });
    }

    const { customer, phone, city, address, zone, zoneName, items, subtotal: rawSubtotal, shipping: rawShipping, total: rawTotal, notes, paymentMethod, couponCode, discount } = req.body;

    if (!customer || !phone || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'بيانات الطلب غير مكتملة' });
    }

    // Recalculate shipping from settings to prevent client-side manipulation
    const settings = settingsRepository.findFirst();
    const shippingZones = (settings && settings.shippingZones) || [];
    let calculatedShipping = 0;
    let calculatedZoneName = zoneName || '';
    if (zone && shippingZones.length) {
      const matchedZone = shippingZones.find(z => z.id === zone && z.enabled !== false);
      if (matchedZone) {
        calculatedShipping = matchedZone.price || 0;
        calculatedZoneName = matchedZone.name;
      }
    }

    const calculatedSubtotal = (Array.isArray(items) ? items.reduce((sum, i) => sum + ((i.price || 0) * (i.qty || 0)), 0) : 0);
    const calculatedDiscount = discount || 0;
    const calculatedTotal = calculatedSubtotal + calculatedShipping - calculatedDiscount;

    const newOrderPayload = {
      customer,
      phone,
      address: address || '',
      city: city || '',
      zone: zone || '',
      zoneName: calculatedZoneName,
      items,
      subtotal: calculatedSubtotal,
      shipping: calculatedShipping,
      discount: calculatedDiscount,
      couponCode: couponCode || '',
      total: calculatedTotal,
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

app.get('/api/orders/:id/pdf', requirePerm('view_orders'), async (req, res) => {
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

app.post('/api/orders/bulk-pdf', requirePerm('view_orders'), async (req, res) => {
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
  const changedBy = req.headers['x-impersonated-by'] || req.headers['x-user-role'] || 'system';
  const result = orderRepository.updateStatus(req.params.id, req.body.status, changedBy);
  if (result === null) return res.status(404).json({ success: false, message: 'Order not found' });
  if (result && result.error) return res.status(400).json({ success: false, message: result.error });

  // Invoice Hook: generate or cancel
  if (req.body.status === 'confirmed') {
    try {
      invoiceService.createInvoice({
        sourceType: 'order',
        sourceId: result.id,
        total: result.total,
        items: (result.items || []).map(item => ({
          productId: item.productId,
          name: item.name || item.productName || 'Unknown Product',
          qty: Number(item.qty) || 0,
          price: Number(item.price) || 0,
          total: (Number(item.price) || 0) * (Number(item.qty) || 0)
        })),
        customer: {
          name: result.customer || '',
          phone: result.phone || '',
          address: result.address || ''
        },
        subtotal: result.subtotal,
        shipping: result.shipping,
        discount: result.discount
      });
    } catch (err) {
      console.error('[INVOICE GENERATION ERROR FOR ORDER]', err);
    }
  } else if (req.body.status === 'cancelled') {
    try {
      const inv = invoiceRepository.findBySource('order', result.id);
      if (inv && inv.status !== 'cancelled') {
        invoiceService.cancelInvoice(inv.id, 'Order cancelled');
      }
    } catch (err) {
      console.error('[INVOICE CANCELLATION ERROR FOR ORDER]', err);
    }
  }

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
  const changedBy = req.headers['x-impersonated-by'] || req.headers['x-user-role'] || 'system';
  const updatedOrder = orderRepository.addNote(req.params.id, req.body.note, changedBy);
  if (!updatedOrder) return res.status(404).json({ success: false, message: 'Order not found' });
  res.json({ success: true, order: updatedOrder });
});

/* =========================
   API: DIRECT SALE (Stock Deduction)
========================= */
app.post('/api/direct-sale', (req, res) => {
  console.log('[DIRECT-SALE-ROUTE] Hit!');
  try {
    const plan = readJSON('store-plan.json');
    if (plan && plan.modules && plan.modules.directSales === false) {
      return res.status(403).json({ success: false, message: 'البيع المباشر غير مفعّل في خطة المتجر الحالية' });
    }

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

    // Invoice Hook: generate direct sale invoice
    try {
      invoiceService.createInvoice({
        sourceType: 'direct_sale',
        sourceId: saleRecord.id,
        total: saleRecord.total,
        items: [{
          productId: saleRecord.productId,
          name: saleRecord.productName,
          qty: saleRecord.quantity,
          price: saleRecord.salePrice,
          total: saleRecord.total
        }],
        customer: {
          name: saleRecord.customerName,
          phone: saleRecord.customerPhone,
          address: saleRecord.customerAddress
        }
      });
    } catch (err) {
      console.error('[INVOICE GENERATION ERROR FOR DIRECT SALE]', err);
    }

    // CRM Sync: create/update customer note when customer is identified
    if (saleRecord.customerName) {
      try {
        const allNotes = readJSON('customer-notes.json') || [];
        const key = statementService.getCustomerKey(saleRecord.customerName, saleRecord.customerPhone);
        const idx = allNotes.findIndex(n => n.key === key);
        const entry = {
          key,
          name: saleRecord.customerName,
          phone: saleRecord.customerPhone || '',
          notes: idx >= 0 ? allNotes[idx].notes : [],
          tags: idx >= 0 ? allNotes[idx].tags : ['عميل مباشر'],
          lastContactAt: idx >= 0 ? allNotes[idx].lastContactAt : null,
          lastContactNote: idx >= 0 ? allNotes[idx].lastContactNote : null,
          createdAt: idx >= 0 ? allNotes[idx].createdAt : new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        if (idx >= 0) {
          allNotes[idx] = entry;
        } else {
          allNotes.push(entry);
        }
        writeJSON('customer-notes.json', allNotes);
      } catch (crmErr) {
        console.error('[CRM SYNC ERROR FOR DIRECT SALE]', crmErr);
      }
    }

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
    sale.cancelledBy = req.headers['x-impersonated-by'] || req.user?.role || 'admin';

    writeJSON('direct-sales.json', directSales);

    // Invoice Hook: cancel direct sale invoice
    try {
      const inv = invoiceRepository.findBySource('direct_sale', sale.id);
      if (inv && inv.status !== 'cancelled') {
        invoiceService.cancelInvoice(inv.id, cancelReason || 'Direct sale cancelled');
      }
    } catch (err) {
      console.error('[INVOICE CANCELLATION ERROR FOR DIRECT SALE]', err);
    }

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
    const plan = readJSON('store-plan.json');
    if (plan && plan.modules && plan.modules.stockReceiving === false) {
      return res.status(403).json({ success: false, message: 'توريد المخزون غير مفعّل في خطة المتجر الحالية' });
    }

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
  let companyId = null;
  try {
    if (prisma) {
      const company = await prisma.company.findFirst();
      companyId = company ? company.id : null;
    }
  } catch (err) {
    console.warn('Prisma query failed, proceeding without companyId:', err.message);
  }
  const payload = {
    userId: user.id,
    role: user.role,
    companyId,
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
   API: STORE PLAN & FEATURE MODULES
========================= */
app.get('/api/store-plan', (req, res) => {
  try {
    const plan = readJSON('store-plan.json');
    if (req.user) {
      return res.json(plan);
    }
    return res.json({
      storefront: !!(plan && plan.modules && plan.modules.storefront),
      checkoutEnabled: !!(plan && plan.checkout && plan.checkout.enabled)
    });
  } catch (err) {
    console.error('[GET STORE PLAN ERROR]', err);
    res.status(500).json({ success: false, message: 'فشل تحميل خطة المتجر' });
  }
});

app.put('/api/store-plan', (req, res) => {
  try {
    if (!req.user || req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'غير مصرح لتعديل الخطة' });
    }

    const { planName, modules, checkout } = req.body;

    if (!modules || typeof modules !== 'object') {
      return res.status(400).json({ success: false, message: 'بيانات الخطة غير صالحة' });
    }

    const updatedPlan = {
      planName: planName || 'custom_plan',
      modules: {
        storefront: !!modules.storefront,
        orders: !!modules.orders,
        products: !!modules.products,
        categories: !!modules.categories,
        directSales: !!modules.directSales,
        inventory: !!modules.inventory,
        stockReceiving: !!modules.stockReceiving,
        accounting: !!modules.accounting,
        coupons: !!modules.coupons,
        users: !!modules.users,
        settings: !!modules.settings,
        paymentSettings: !!modules.paymentSettings,
        pricing: !!modules.pricing
      },
      checkout: {
        enabled: checkout ? !!checkout.enabled : true,
        mode: checkout && checkout.mode ? checkout.mode : 'cod_only'
      }
    };

    writeJSON('store-plan.json', updatedPlan);

    res.json({ success: true, message: 'تم تحديث خطة المتجر بنجاح', plan: updatedPlan });
  } catch (err) {
    console.error('[PUT STORE PLAN ERROR]', err);
    res.status(500).json({ success: false, message: 'فشل تحديث خطة المتجر' });
  }
});

/* =========================
   API: STORE SETTINGS
========================= */
app.get('/api/settings', (req, res) => {
  res.json(settingsRepository.findFirst() || {});
});

app.put('/api/settings', requirePerm('view_settings'), (req, res) => {
  const role = (req.user && req.user.role) || req.headers['x-user-role'];
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
   API: ACCOUNTING FINANCIAL SUMMARY
========================= */
app.get('/api/accounting/financial-summary', requirePerm('view_dashboard'), (req, res) => {
  try {
    const plan = readJSON('store-plan.json');
    if (plan && plan.modules && plan.modules.accounting === false) {
      return res.status(403).json({ success: false, message: 'الميزة غير مفعّلة في خطة المتجر الحالية' });
    }

    // 1. Fetch data
    const products = productRepository.findAll();
    const orders = orderRepository.findAll();
    const directSales = readJSON('direct-sales.json') || [];

    // 2. Calculations
    let inventoryValue = 0;
    products.forEach(p => {
      const stock = Number(p.stock) || 0;
      const costPrice = Number(p.costPrice) || 0;
      inventoryValue += stock * costPrice;
    });

    const currentCapital = inventoryValue;

    // Filters for non-cancelled
    const activeOrders = orders.filter(o => o.status !== 'cancelled');
    const activeDirectSales = directSales.filter(s => s.saleStatus !== 'cancelled');

    const todayStr = new Date().toISOString().split('T')[0];
    const currentMonthStr = todayStr.substring(0, 7);

    let todaySales = 0;
    let monthlySales = 0;
    let monthlyCOGS = 0;
    let isMonthlyProfitEstimated = false;

    let totalSales = 0;
    let totalCOGS = 0;
    let isTotalProfitEstimated = false;
    let totalPiecesSold = 0;

    // Helper to calculate cost for product and update estimate flag
    const getProductCost = (productId, name) => {
      const p = products.find(prod => String(prod.id) === String(productId)) ||
                products.find(prod => String(prod.name).toLowerCase().trim() === String(name || '').toLowerCase().trim());
      if (p && p.costPrice !== undefined && p.costPrice !== null) {
        return { cost: Number(p.costPrice) || 0, isEstimated: false };
      }
      return { cost: 0, isEstimated: true };
    };

    // Keep track of best sellers: aggregated by product ID or name
    const productSalesMap = {};

    // Helper to aggregate best sellers
    const addProductSale = (productId, name, qty, revenue, profit, isEstimated) => {
      const key = productId ? String(productId) : String(name || '').toLowerCase().trim();
      if (!key) return;
      if (!productSalesMap[key]) {
        productSalesMap[key] = {
          productId: productId || null,
          name: name || '',
          quantitySold: 0,
          totalSales: 0,
          totalProfit: 0,
          isProfitEstimated: false
        };
      }
      productSalesMap[key].quantitySold += qty;
      productSalesMap[key].totalSales += revenue;
      productSalesMap[key].totalProfit += profit;
      if (isEstimated) {
        productSalesMap[key].isProfitEstimated = true;
      }
    };

    // Process orders
    activeOrders.forEach(o => {
      const orderTotal = Number(o.total) || 0;
      const orderDate = o.date || (o.createdAt ? o.createdAt.split('T')[0] : '');

      const isToday = orderDate === todayStr || (o.createdAt && o.createdAt.startsWith(todayStr));
      const isCurrentMonth = orderDate.startsWith(currentMonthStr) || (o.createdAt && o.createdAt.startsWith(currentMonthStr));

      if (isToday) {
        todaySales += orderTotal;
      }
      if (isCurrentMonth) {
        monthlySales += orderTotal;
      }
      totalSales += orderTotal;

      let orderCOGS = 0;
      let orderIsEstimated = false;

      (o.items || []).forEach(item => {
        const qty = Number(item.qty || item.quantity) || 0;
        const itemPrice = Number(item.price) || 0;
        const itemTotal = itemPrice * qty;
        
        let unitCost = 0;
        let itemIsEstimated = false;

        if (item.costAtSale !== undefined && item.costAtSale !== null) {
          unitCost = Number(item.costAtSale) || 0;
        } else if (item.unitCostAtSale !== undefined && item.unitCostAtSale !== null) {
          unitCost = Number(item.unitCostAtSale) || 0;
        } else {
          const lookup = getProductCost(item.productId, item.name);
          unitCost = lookup.cost;
          itemIsEstimated = true;
          orderIsEstimated = true;
        }

        const itemCost = unitCost * qty;
        const itemProfit = itemTotal - itemCost;

        orderCOGS += itemCost;
        totalPiecesSold += qty;

        addProductSale(item.productId, item.name || item.productName, qty, itemTotal, itemProfit, itemIsEstimated);
      });

      if (isCurrentMonth) {
        monthlyCOGS += orderCOGS;
        if (orderIsEstimated) {
          isMonthlyProfitEstimated = true;
        }
      }
      totalCOGS += orderCOGS;
      if (orderIsEstimated) {
        isTotalProfitEstimated = true;
      }
    });

    // Process direct sales
    activeDirectSales.forEach(s => {
      const saleTotal = Number(s.total) || 0;
      const saleDate = s.createdAt ? s.createdAt.split('T')[0] : '';

      const isToday = saleDate === todayStr || (s.createdAt && s.createdAt.startsWith(todayStr));
      const isCurrentMonth = saleDate.startsWith(currentMonthStr) || (s.createdAt && s.createdAt.startsWith(currentMonthStr));

      if (isToday) {
        todaySales += saleTotal;
      }
      if (isCurrentMonth) {
        monthlySales += saleTotal;
      }
      totalSales += saleTotal;

      const qty = Number(s.quantity) || 0;
      let unitCost = 0;
      let saleIsEstimated = false;

      if (s.costAtSale !== undefined && s.costAtSale !== null) {
        unitCost = Number(s.costAtSale) || 0;
      } else if (s.unitCostAtSale !== undefined && s.unitCostAtSale !== null) {
        unitCost = Number(s.unitCostAtSale) || 0;
      } else {
        const lookup = getProductCost(s.productId, s.productName);
        unitCost = lookup.cost;
        saleIsEstimated = true;
      }

      const saleCost = unitCost * qty;
      const saleProfit = saleTotal - saleCost;

      totalPiecesSold += qty;

      if (isCurrentMonth) {
        monthlyCOGS += saleCost;
        if (saleIsEstimated) {
          isMonthlyProfitEstimated = true;
        }
      }
      totalCOGS += saleCost;
      if (saleIsEstimated) {
        isTotalProfitEstimated = true;
      }

      addProductSale(s.productId, s.productName, qty, saleTotal, saleProfit, saleIsEstimated);
    });

    const monthlyProfit = monthlySales - monthlyCOGS;
    const totalProfit = totalSales - totalCOGS;

    // Operations count
    const operationsCount = activeOrders.length + activeDirectSales.length;

    // Low stock active products
    const lowStock = products
      .filter(p => p.active !== false && (p.stock !== undefined && p.stock !== null && Number(p.stock) <= 3))
      .map(p => ({
        id: p.id,
        name: p.name,
        stock: p.stock,
        price: p.price
      }));

    // Best Sellers Top 10
    const bestSellers = Object.values(productSalesMap)
      .sort((a, b) => b.quantitySold - a.quantitySold)
      .slice(0, 10);

    // Consolidated recent sales (last 10)
    const unifiedSales = [];

    activeOrders.forEach(o => {
      unifiedSales.push({
        id: o.id,
        orderNumber: o.orderNumber || o.id,
        type: 'online',
        customerName: o.customer || '',
        total: Number(o.total) || 0,
        createdAt: o.createdAt || (o.date ? `${o.date}T00:00:00.000Z` : new Date().toISOString()),
        status: o.status || 'pending'
      });
    });

    activeDirectSales.forEach(s => {
      unifiedSales.push({
        id: s.id,
        type: 'direct',
        customerName: s.customerName || 'زبون مباشر',
        total: Number(s.total) || 0,
        createdAt: s.createdAt || new Date().toISOString(),
        status: s.saleStatus || 'completed'
      });
    });

    const recentSales = unifiedSales
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 10);

    // Financial KPIs from receipts and expenses
    const receipts = receiptRepository.findAll();
    const expenses = expenseRepository.findAll();
    const activeReceipts = receipts.filter(r => r.status !== 'cancelled');
    const totalReceipts = activeReceipts.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const totalExpenses = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
    const netBalance = totalReceipts - totalExpenses;

    const invoices = invoiceRepository.findAll();
    let outstandingBalances = 0, partiallyPaidCount = 0, unpaidCount = 0;
    invoices.forEach(inv => {
      if (inv.status === 'cancelled') return;
      const linked = activeReceipts.filter(r => r.linkedTo === 'invoice' && String(r.linkedId) === String(inv.id));
      const totalPaid = linked.reduce((s, r) => s + (Number(r.amount) || 0), 0);
      const remaining = Math.max(0, (Number(inv.total) || 0) - totalPaid);
      if (remaining > 0) {
        outstandingBalances += remaining;
        if (totalPaid > 0) partiallyPaidCount++;
        else unpaidCount++;
      }
    });

    // Compute aging report for financial summary
    const agingBuckets = statementService.getAgingReport(invoices, receipts);

    res.json({
      success: true,
      inventoryValue,
      currentCapital,
      todaySales,
      monthlySales,
      monthlyProfit,
      isMonthlyProfitEstimated,
      operationsCount,
      allTime: {
        totalSales,
        totalCOGS,
        totalProfit,
        isTotalProfitEstimated,
        totalPiecesSold
      },
      bestSellers,
      lowStock,
      recentSales,
      totalReceipts,
      totalExpenses,
      netBalance,
      outstandingBalances,
      partiallyPaidCount,
      unpaidCount,
      agingBuckets
    });
  } catch (error) {
    console.error('[FINANCIAL SUMMARY GET]', error);
    res.status(500).json({ success: false, message: 'فشل في تحميل الخلاصة المالية.' });
  }
});

/* =========================
   API: CUSTOMER STATEMENTS (DERIVED FROM INVOICES & RECEIPTS)
========================= */

function hasAccessToAccounting(req) {
  const plan = require('./backend/src/core/jsonStore').readJsonFile('store-plan.json');
  return !(plan && plan.modules && plan.modules.accounting === false);
}

app.get('/api/accounting/customers-list', requirePerm('view_dashboard'), (req, res) => {
  try {
    if (!hasAccessToAccounting(req)) return res.status(403).json({ success: false, message: 'الميزة غير مفعّلة' });
    const invoices = invoiceRepository.findAll();
    const receipts = receiptRepository.findAll();
    const customers = statementService.getCustomerSummaries(invoices, receipts);
    res.json({ success: true, data: customers });
  } catch (err) {
    console.error('[CUSTOMERS-LIST ERROR]', err);
    res.status(500).json({ success: false, message: 'فشل تحميل قائمة العملاء' });
  }
});

app.get('/api/accounting/customer-statement', requirePerm('view_dashboard'), (req, res) => {
  try {
    if (!hasAccessToAccounting(req)) return res.status(403).json({ success: false, message: 'الميزة غير مفعّلة' });
    const { name, phone } = req.query;
    if (!name) return res.status(400).json({ success: false, message: 'اسم العميل مطلوب' });
    const invoices = invoiceRepository.findAll();
    const receipts = receiptRepository.findAll();
    const entries = statementService.getCustomerStatement(name, phone, invoices, receipts);
    const summary = statementService.getCustomerSummary(name, phone, invoices, receipts);
    res.json({ success: true, data: { entries, summary } });
  } catch (err) {
    console.error('[CUSTOMER-STATEMENT ERROR]', err);
    res.status(500).json({ success: false, message: 'فشل تحميل كشف حساب العميل' });
  }
});

// ===== Customer Statement PDF =====
app.get('/api/accounting/customer-statement/pdf', requirePerm('view_dashboard'), async (req, res) => {
  if (!puppeteer) return res.status(503).json({ success: false, message: 'PDF غير متاح حالياً' });
  try {
    if (!hasAccessToAccounting(req)) return res.status(403).json({ success: false, message: 'الميزة غير مفعّلة' });
    const { name, phone } = req.query;
    if (!name) return res.status(400).json({ success: false, message: 'اسم العميل مطلوب' });
    const invoices = invoiceRepository.findAll();
    const receipts = receiptRepository.findAll();
    const entries = statementService.getCustomerStatement(name, phone, invoices, receipts) || [];
    const summary = statementService.getCustomerSummary(name, phone, invoices, receipts) || {};
    const settings = settingsRepository.findFirst() || {};
    const currency = settings.currencySymbol || '₪';

    const entriesHtml = entries.length ? entries.map(e => {
      const dateStr = e.date ? new Date(e.date).toLocaleDateString('ar-EG') : '—';
      const ref = e.reference || '—';
      const debit = e.debit ? Number(e.debit).toFixed(2) + ' ' + currency : '—';
      const credit = e.credit ? Number(e.credit).toFixed(2) + ' ' + currency : '—';
      const bal = e.balance !== undefined ? Number(e.balance).toFixed(2) + ' ' + currency : '—';
      const note = e.note ? e.note : '';
      return `<tr><td style="font-size:0.8rem">${dateStr}</td><td>${e.type === 'فاتورة' ? 'فاتورة' : 'سند قبض'}${note ? `<br><span style="font-size:0.7rem;color:#888">${note}</span>` : ''}</td><td style="font-family:monospace;font-size:0.75rem">${ref}</td><td style="color:#991b1b">${debit}</td><td style="color:#166534">${credit}</td><td style="font-weight:600">${bal}</td></tr>`;
    }).join('') : '<tr><td colspan="6" style="text-align:center;color:#888;padding:20px;">لا توجد حركات مالية</td></tr>';

    const html = `<!DOCTYPE html>
<html dir="rtl"><head><meta charset="utf-8"><title>كشف حساب - ${name}</title>${pdfStyles()}</head>
<body>
  ${pdfHeader(settings, 'كشف حساب', {'العميل': name, 'الجوال': phone || '—'})}
  <div class="divider"></div>
  <div class="section-title">حركات الحساب</div>
  <table class="data-table">
    <thead><tr><th>التاريخ</th><th>النوع</th><th>المرجع</th><th>مدين</th><th>دائن</th><th>الرصيد</th></tr></thead>
    <tbody>${entriesHtml}</tbody>
  </table>
  <div class="summary-box">
    <table><tr><td class="lbl">إجمالي المشتريات</td><td class="val">${Number(summary.totalPurchases || 0).toFixed(2)} ${currency}</td></tr>
    <tr><td class="lbl">إجمالي المدفوع</td><td class="val">${Number(summary.totalPaid || 0).toFixed(2)} ${currency}</td></tr>
    <tr><td class="lbl">الرصيد المتبقي</td><td class="val" style="color:${(summary.balance || 0) > 0 ? '#991b1b' : '#166534'}">${Number(summary.balance || 0).toFixed(2)} ${currency}</td></tr></table>
  </div>
  ${pdfFooter()}
</body></html>`;
    const buffer = await generatePdfFromHtml(html);
    const filename = `statement-${name.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error('[STATEMENT PDF ERROR]', err);
    res.status(500).json({ success: false, message: 'فشل توليد PDF كشف الحساب' });
  }
});

app.get('/api/accounting/customer-summary', requirePerm('view_dashboard'), (req, res) => {
  try {
    if (!hasAccessToAccounting(req)) return res.status(403).json({ success: false, message: 'الميزة غير مفعّلة' });
    const { name, phone } = req.query;
    if (!name) return res.status(400).json({ success: false, message: 'اسم العميل مطلوب' });
    const invoices = invoiceRepository.findAll();
    const receipts = receiptRepository.findAll();
    const summary = statementService.getCustomerSummary(name, phone, invoices, receipts);
    res.json({ success: true, data: summary });
  } catch (err) {
    console.error('[CUSTOMER-SUMMARY ERROR]', err);
    res.status(500).json({ success: false, message: 'فشل تحميل ملخص العميل' });
  }
});

app.get('/api/accounting/customer-summaries', requirePerm('view_dashboard'), (req, res) => {
  try {
    if (!hasAccessToAccounting(req)) return res.status(403).json({ success: false, message: 'الميزة غير مفعّلة' });
    const invoices = invoiceRepository.findAll();
    const receipts = receiptRepository.findAll();
    const summaries = statementService.getCustomerSummaries(invoices, receipts);

    // Optionally merge CRM notes
    if (req.query.includeNotes === 'true') {
      const notes = readJSON('customer-notes.json') || [];
      const notesByKey = {};
      notes.forEach(n => { notesByKey[n.key] = n; });

      // Merge CRM data into derived customers
      summaries.forEach(c => {
        const key = statementService.getCustomerKey(c.name, c.phone);
        const note = notesByKey[key];
        if (note) {
          c.tags = note.tags || [];
          c.lastContactAt = note.lastContactAt || null;
          c.lastContactNote = note.lastContactNote || null;
          c.noteCount = (note.notes || []).length;
          c.crmNote = note.notes && note.notes.length ? note.notes[note.notes.length - 1].text : null;
        } else {
          c.tags = [];
          c.lastContactAt = null;
          c.lastContactNote = null;
          c.noteCount = 0;
          c.crmNote = null;
        }
      });

      // Add standalone customers from customer-notes.json that have no invoices/receipts
      const derivedKeys = new Set(summaries.map(c => statementService.getCustomerKey(c.name, c.phone)));
      notes.forEach(n => {
        if (!derivedKeys.has(n.key) && n.name) {
          summaries.push({
            name: n.name,
            phone: n.phone || '',
            totalPurchases: 0,
            totalPaid: 0,
            balance: 0,
            invoiceCount: 0,
            remaining: 0,
            status: 'جديد',
            lastInvoice: null,
            lastReceipt: null,
            tags: n.tags || [],
            lastContactAt: n.lastContactAt || null,
            lastContactNote: n.lastContactNote || null,
            noteCount: (n.notes || []).length,
            crmNote: n.notes && n.notes.length ? n.notes[n.notes.length - 1].text : null
          });
        }
      });
    }

    res.json({ success: true, data: summaries });
  } catch (err) {
    console.error('[CUSTOMER-SUMMARIES ERROR]', err);
    res.status(500).json({ success: false, message: 'فشل تحميل ملخصات العملاء' });
  }
});

app.get('/api/accounting/customer-notes', requirePerm('view_dashboard'), (req, res) => {
  try {
    const key = req.query.key;
    if (!key) return res.status(400).json({ success: false, message: 'key query param مطلوب' });
    const notes = readJSON('customer-notes.json') || [];
    const entry = notes.find(n => n.key === key);
    res.json({ success: true, data: entry || null });
  } catch (err) {
    console.error('[CUSTOMER-NOTES GET ERROR]', err);
    res.status(500).json({ success: false, message: 'فشل تحميل ملاحظات العميل' });
  }
});

app.put('/api/accounting/customer-notes', requirePerm('view_dashboard'), (req, res) => {
  try {
    const { key, name, phone, notes, tags, lastContactAt, lastContactNote } = req.body;
    if (!key) return res.status(400).json({ success: false, message: 'key مطلوب' });

    const allNotes = readJSON('customer-notes.json') || [];
    const idx = allNotes.findIndex(n => n.key === key);

    const entry = {
      key,
      name: name || '',
      phone: phone || '',
      notes: notes || [],
      tags: tags || [],
      lastContactAt: lastContactAt || null,
      lastContactNote: lastContactNote || null,
      createdAt: idx >= 0 ? allNotes[idx].createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (idx >= 0) {
      allNotes[idx] = entry;
    } else {
      allNotes.push(entry);
    }

    writeJSON('customer-notes.json', allNotes);
    res.json({ success: true, data: entry });
  } catch (err) {
    console.error('[CUSTOMER-NOTES PUT ERROR]', err);
    res.status(500).json({ success: false, message: 'فشل حفظ ملاحظات العميل' });
  }
});

app.get('/api/accounting/inactive-customers', requirePerm('view_dashboard'), (req, res) => {
  try {
    const days = parseInt(req.query.days) || 60;
    const invoices = invoiceRepository.findAll();
    const receipts = receiptRepository.findAll();
    const summaries = statementService.getCustomerSummaries(invoices, receipts);
    const now = new Date();
    const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    const inactive = summaries.filter(c => {
      const lastInvoice = c.lastInvoice ? new Date(c.lastInvoice) : null;
      const lastReceipt = c.lastReceipt ? new Date(c.lastReceipt) : null;
      const mostRecent = lastInvoice && lastReceipt ? (lastInvoice > lastReceipt ? lastInvoice : lastReceipt) : (lastInvoice || lastReceipt);
      return !mostRecent || mostRecent < cutoff;
    });

    res.json({ success: true, data: inactive, days });
  } catch (err) {
    console.error('[INACTIVE-CUSTOMERS ERROR]', err);
    res.status(500).json({ success: false, message: 'فشل تحميل العملاء غير النشطين' });
  }
});

// ===== Cheques List =====
app.get('/api/accounting/cheques', requirePerm('view_dashboard'), (req, res) => {
  try {
    if (!hasAccessToAccounting(req)) return res.status(403).json({ success: false, message: 'الميزة غير مفعّلة' });
    const receipts = receiptRepository.findAll();
    let cheques = receipts.filter(r => r.paymentMethod === 'cheque');
    const { status } = req.query;
    if (status && status !== 'all') {
      cheques = cheques.filter(r => (r.chequeStatus || 'pending') === status);
    }
    const now = new Date();
    const result = cheques.map(r => {
      const dueDate = r.dueDate ? new Date(r.dueDate) : null;
      let daysLabel = '—';
      if (dueDate) {
        const diff = Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24));
        if (diff > 0) daysLabel = `بعد ${diff} أيام`;
        else if (diff === 0) daysLabel = 'اليوم';
        else daysLabel = `متأخر ${Math.abs(diff)} أيام`;
      }
      return {
        id: r.id,
        voucherNumber: r.voucherNumber,
        customerName: r.customerName,
        customerPhone: r.customerPhone,
        amount: r.amount,
        chequeNumber: r.chequeNumber || '—',
        bankName: r.bankName || '—',
        dueDate: r.dueDate || null,
        chequeStatus: r.chequeStatus || 'pending',
        daysLabel,
        createdAt: r.createdAt
      };
    });
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('[CHEQUES LIST ERROR]', err);
    res.status(500).json({ success: false, message: 'فشل تحميل قائمة الشيكات' });
  }
});

app.get('/api/accounting/aging-report', requirePerm('view_dashboard'), (req, res) => {
  try {
    if (!hasAccessToAccounting(req)) return res.status(403).json({ success: false, message: 'الميزة غير مفعّلة' });
    const invoices = invoiceRepository.findAll();
    const receipts = receiptRepository.findAll();
    const report = statementService.getAgingReport(invoices, receipts);
    res.json({ success: true, data: report });
  } catch (err) {
    console.error('[AGING-REPORT ERROR]', err);
    res.status(500).json({ success: false, message: 'فشل تحميل تقرير الأعمار' });
  }
});

/* =========================
   API: ACCOUNTING CUSTOMERS (Prisma)
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

app.get('/product-label', (req, res) => {
  return res.sendFile(path.join(__dirname, 'product-label.html'));
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