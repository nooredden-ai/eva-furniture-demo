// admin.js - Admin Panel Logic with API integration (Production-Ready)

const STORE_ID = 'loulo-beauty';
let currentAdminPage = 'dashboard';
let editingProduct = null;
let editingCategory = null;
let productsCache = [];
let imageMarkedForRemoval = false; // Tracks if the user clicked "Remove" in edit mode

// Temp settings state (before save)
let _settingsTempPrimary     = null;
let _settingsTempSecondary   = null;
let _settingsTempTextColor   = null;
let _settingsTempSubtextColor = null;
let _settingsTempBranding   = { logo: '', favicon: '', heroBanners: [], promoBanners: [] };

const $a = id => document.getElementById(id);

// ===== Action Lock (Prevent Double-Click) =====
const _actionLocks = new Set();
function withLock(key, fn) {
  if (_actionLocks.has(key)) return;
  _actionLocks.add(key);
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.finally(() => _actionLocks.delete(key));
    }
    _actionLocks.delete(key);
    return result;
  } catch(e) {
    _actionLocks.delete(key);
    throw e;
  }
}

// ===== Admin Toast =====
function showAdminToast(msg, type = 'success') {
  const t = $a('admin-toast');
  if (!t) return;
  t.textContent = msg;
  t.className = `admin-toast ${type} show`;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.classList.remove('show'); }, 3200);
}

function normalizeOrderIdentifier(value) {
  return String(value || '').trim();
}

function findOrderByIdentifier(orders, identifier) {
  const key = normalizeOrderIdentifier(identifier);
  return orders.find(o => normalizeOrderIdentifier(o.id) === key || normalizeOrderIdentifier(o.orderNumber) === key);
}

function getOrderKey(order) {
  return order?.id || order?.orderNumber || '';
}

// ===== Navigation =====
function navigateTo(page) {
  const pagesPermissions = {
    dashboard: 'view_dashboard',
    products: 'view_products',
    categories: 'view_categories',
    orders: 'view_orders',
    users: 'view_users',
    coupons: 'view_coupons',
    settings: 'view_settings'
  };
  
  const requiredPerm = pagesPermissions[page];
  if (requiredPerm && !Auth.can(requiredPerm)) {
    page = 'access-denied';
  }

  currentAdminPage = page;
  document.querySelectorAll('.admin-page').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  const pageEl = $a('admin-' + page);
  const navEl  = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (pageEl) pageEl.classList.add('active');
  if (navEl)  navEl.classList.add('active');
  refreshPage(page);
}

function refreshPage(page) {
  const titles = {
    dashboard:  'لوحة المعلومات',
    products:   'إدارة المنتجات',
    categories: 'التصنيفات',
    orders:     'إدارة الطلبات',
    users:      'إدارة المستخدمين',
    accounting: 'النظام المالي',
    coupons:    'إدارة الكوبونات',
    settings:   'إعدادات المتجر',
    'access-denied': 'وصول مرفوض'
  };
  const titleIcons = {
    dashboard: 'bar-chart', products: 'package', categories: 'tag',
    orders: 'receipt', users: 'users', accounting: 'credit-card', coupons: 'gift', settings: 'settings',
    'access-denied': 'shield-alert'
  };
  const titleEl = $a('topbar-title');
  if (titleEl) {
    titleEl.innerHTML = `<i data-lucide="${titleIcons[page] || 'layout'}" style="width:20px;height:20px;vertical-align:middle;margin-left:8px"></i>${titles[page] || ''}`;
    if (window.lucide) lucide.createIcons();
  }
  // Force-refresh data from server on navigation
  if (window.appState) {
    if (page === 'dashboard')  { appState.orders = null; appState.products = null; }
    if (page === 'products')   { appState.products = null; appState.categories = null; }
    if (page === 'categories') { appState.categories = null; }
    if (page === 'orders')     { appState.orders = null; }
    if (page === 'users')      { appState.users = null; }
    if (page === 'settings')   { appState.settings = null; appState.countries = null; }
  }
  if (page === 'dashboard')       renderDashboard();
  else if (page === 'products')   renderProductsTable();
  else if (page === 'categories') renderCategoriesPage();
  else if (page === 'orders')     renderOrdersTable();
  else if (page === 'users')      renderUsersTable();
  else if (page === 'accounting') renderAccountingPage();
  else if (page === 'coupons')    renderCouponsTable();
  else if (page === 'settings')   initSettingsPage();
}

const accountingFixtures = {
  customers: {
    title: 'العملاء',
    subtitle: 'قائمة العملاء وأرصدة الحسابات',
    headers: ['الاسم', 'الهاتف', 'العنوان'],
    rows: [
      ['محمد أحمد', '0590000000', 'نابلس'],
      ['شركة النور', '0560000000', 'رام الله']
    ]
  },
  suppliers: {
    title: 'الموردون',
    subtitle: 'تفاصيل الموردين والمستحقات',
    headers: ['الاسم', 'الهاتف', 'العنوان'],
    rows: [
      ['مورد المفروشات الأول', '0591111111', 'الخليل'],
      ['شركة الأخشاب', '0592222222', 'جنين']
    ]
  },
  accounts: {
    title: 'دليل الحسابات',
    subtitle: 'عرض فئات الحسابات الرئيسية',
    headers: ['الرمز', 'الاسم', 'نوع الحساب'],
    rows: [
      ['1000', 'الصندوق', 'أصول'],
      ['1010', 'البنك', 'أصول'],
      ['4000', 'المبيعات', 'إيرادات'],
      ['5000', 'المصروفات', 'مصروفات']
    ]
  }
};

// Extended fixtures for UI-only service cards
accountingFixtures.cash = {
  title: 'الصندوق',
  subtitle: 'ملخص عمليات الصندوق الحالية',
  headers: ['النوع', 'المبلغ', 'البيان'],
  rows: [
    ['قبض', '1,200 ₪', 'بيع نقدي'],
    ['صرف', '300 ₪', 'سداد مصروفات'],
    ['رصيد', '12,500 ₪', 'الرصيد الحالي']
  ]
};

accountingFixtures.bank = {
  title: 'البنك',
  subtitle: 'الحركات البنكية وبيان الأرصدة',
  headers: ['العملية', 'المبلغ', 'البيان'],
  rows: [
    ['إيداع', '25,000 ₪', 'تحويل من مبيعات'],
    ['سحب', '5,000 ₪', 'سحب نقدي'],
    ['رصيد', '40,200 ₪', 'الرصيد البنكي']
  ]
};

accountingFixtures.invoices = {
  title: 'الفواتير',
  subtitle: 'استعراض حالة الفواتير الحالية',
  headers: ['رقم', 'العميل', 'إجمالي', 'حالة'],
  rows: [
    ['INV-001', 'شركة النور', '3,200 ₪', 'مدفوعة'],
    ['INV-002', 'محمد أحمد', '450 ₪', 'مستحقة'],
    ['INV-003', 'مورد المفروشات الأول', '1,250 ₪', 'مستحقة']
  ]
};

accountingFixtures.reports = {
  title: 'التقارير',
  subtitle: 'ملخصات مالية جاهزة للتصفّح',
  headers: ['اسم التقرير', 'وصف مختصر'],
  rows: [
    ['تقرير المبيعات الشهري', 'موجز إجمالي المبيعات لهذا الشهر'],
    ['تقرير العملاء الدائنين', 'عملاء لديهم أرصدة مستحقة'],
    ['تقرير المصروفات', 'تفاصيل المصروفات الشهرية']
  ]
};

// Map legacy terminology replacements
const accountingTerms = {
  'قيود يومية': 'الحركات المالية',
  'الذمم المدينة': 'مستحقات العملاء',
  'الدائنون': 'مستحقات الموردين'
};

function renderAccountingPage() {
  const home = $a('accounting-home');
  const panel = $a('accounting-table-panel');
  if (home) home.style.display = 'block';
  if (panel) panel.style.display = 'none';

  const currentDate = $a('accounting-current-date');
  const lastUpdate = $a('accounting-last-update');
  const now = new Date();
  if (currentDate) {
    currentDate.textContent = now.toLocaleDateString('ar-EG', {
      day: 'numeric', month: 'long', year: 'numeric'
    });
  }
  if (lastUpdate) {
    lastUpdate.textContent = 'قبل لحظات';
  }

  if (window.lucide) lucide.createIcons();
}

function showAccountingHome() {
  renderAccountingPage();
}

// ===== Accounting Customers Integration =====
let accountingCustomers = [];

function escapeHtml(str) {
  if (typeof str !== 'string') return str || '';
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function fetchAccountingCustomers(url, options = {}) {
  const finalHeaders = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  
  // Temporary header injection matching current session
  const sessionStr = sessionStorage.getItem('louloSession');
  if (sessionStr) {
    try {
      const session = JSON.parse(sessionStr);
      finalHeaders['x-user-role'] = session.role;
      finalHeaders['x-user-id'] = session.id;
    } catch(e) {}
  }
  
  const response = await fetch(url, { ...options, headers: finalHeaders });
  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.message || `HTTP error! status: ${response.status}`);
  }
  return response.json();
}

async function loadAccountingCustomers() {
  const body = $a('accounting-table-body');
  const empty = $a('accounting-empty-state');
  
  try {
    const data = await fetchAccountingCustomers('/api/accounting/customers');
    accountingCustomers = Array.isArray(data) ? data : (data.data || []);
    
    // reset search input
    const searchInput = $a('accounting-customer-search');
    if (searchInput) searchInput.value = '';
    
    renderAccountingCustomersTable(accountingCustomers);
  } catch (error) {
    console.error('Error loading accounting customers:', error);
    if (body) {
      body.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--admin-danger);padding:20px;">فشل تحميل قائمة العملاء: ${escapeHtml(error.message)}</td></tr>`;
    }
    if (empty) empty.style.display = 'none';
    showAdminToast('خطأ أثناء تحميل العملاء', 'error');
  }
}

function renderAccountingCustomersTable(customers) {
  const body = $a('accounting-table-body');
  const empty = $a('accounting-empty-state');
  
  if (!body) return;
  
  if (customers.length === 0) {
    body.innerHTML = '';
    if (empty) {
      const h4 = empty.querySelector('h4');
      const p = empty.querySelector('p');
      if (h4) h4.textContent = 'لا يوجد عملاء بعد';
      if (p) p.textContent = 'أضف أول عميل للبدء.';
      empty.style.display = 'flex';
    }
    return;
  }
  
  if (empty) empty.style.display = 'none';
  
  body.innerHTML = customers.map(c => `
    <tr>
      <td>${escapeHtml(c.name)}</td>
      <td>${escapeHtml(c.phone || '-')}</td>
      <td>${escapeHtml(c.email || '-')}</td>
      <td>${escapeHtml(c.address || '-')}</td>
      <td style="text-align:center">
        <button class="topbar-btn btn-outline btn-sm" onclick="openEditAccountingCustomer('${escapeHtml(c.id)}')">
          <i data-lucide="edit" style="width:14px;height:14px;vertical-align:middle;margin-left:2px"></i> تعديل
        </button>
      </td>
    </tr>
  `).join('');
  
  if (window.lucide) lucide.createIcons();
}

function filterAccountingCustomers() {
  const query = ($a('accounting-customer-search')?.value || '').toLowerCase().trim();
  const filtered = accountingCustomers.filter(c => {
    return (c.name || '').toLowerCase().includes(query) || (c.phone || '').toLowerCase().includes(query);
  });
  renderAccountingCustomersTable(filtered);
}

function openAddAccountingCustomer() {
  $a('accounting-customer-modal-title').innerHTML = '<i data-lucide="user-plus" style="width:18px;height:18px;vertical-align:middle;margin-left:4px"></i> إضافة عميل جديد';
  $a('acm-id').value = '';
  $a('acm-name').value = '';
  $a('acm-phone').value = '';
  $a('acm-email').value = '';
  $a('acm-address').value = '';
  
  $a('accounting-customer-modal').classList.add('open');
  if (window.lucide) lucide.createIcons();
}

function openEditAccountingCustomer(id) {
  const customer = accountingCustomers.find(c => String(c.id) === String(id));
  if (!customer) {
    showAdminToast('لم يتم العثور على بيانات العميل', 'error');
    return;
  }
  
  $a('accounting-customer-modal-title').innerHTML = '<i data-lucide="edit" style="width:18px;height:18px;vertical-align:middle;margin-left:4px"></i> تعديل بيانات العميل';
  $a('acm-id').value = customer.id;
  $a('acm-name').value = customer.name || '';
  $a('acm-phone').value = customer.phone || '';
  $a('acm-email').value = customer.email || '';
  $a('acm-address').value = customer.address || '';
  
  $a('accounting-customer-modal').classList.add('open');
  if (window.lucide) lucide.createIcons();
}

async function saveAccountingCustomer(btnElement) {
  const id = $a('acm-id').value;
  const name = $a('acm-name').value.trim();
  const phone = $a('acm-phone').value.trim();
  const email = $a('acm-email').value.trim();
  const address = $a('acm-address').value.trim();
  
  if (!name) {
    showAdminToast('الرجاء إدخال اسم العميل', 'error');
    return;
  }
  
  const payload = { name, phone, email, address };
  
  const originalHtml = btnElement.innerHTML;
  btnElement.classList.add('btn-loading');
  btnElement.innerHTML = 'جاري الحفظ...';
  
  try {
    let url = '/api/accounting/customers';
    let method = 'POST';
    
    if (id) {
      url = `/api/accounting/customers/${encodeURIComponent(id)}`;
      method = 'PUT';
    }
    
    const result = await fetchAccountingCustomers(url, {
      method: method,
      body: JSON.stringify(payload)
    });
    
    closeModal('accounting-customer-modal');
    showAdminToast(id ? 'تم تعديل بيانات العميل بنجاح' : 'تم إضافة العميل بنجاح');
    await loadAccountingCustomers();
  } catch (error) {
    console.error('Error saving customer:', error);
    showAdminToast(error.message || 'حدث خطأ أثناء حفظ بيانات العميل', 'error');
  } finally {
    btnElement.classList.remove('btn-loading');
    btnElement.innerHTML = originalHtml;
  }
}

// ===== Accounting Suppliers Integration =====
let accountingSuppliers = [];

async function fetchAccountingSuppliers(url, options = {}) {
  const finalHeaders = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  
  // Temporary header injection matching current session
  const sessionStr = sessionStorage.getItem('louloSession');
  if (sessionStr) {
    try {
      const session = JSON.parse(sessionStr);
      finalHeaders['x-user-role'] = session.role;
      finalHeaders['x-user-id'] = session.id;
    } catch(e) {}
  }
  
  const response = await fetch(url, { ...options, headers: finalHeaders });
  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.message || `HTTP error! status: ${response.status}`);
  }
  return response.json();
}

async function loadAccountingSuppliers() {
  const body = $a('accounting-table-body');
  const empty = $a('accounting-empty-state');
  
  try {
    const data = await fetchAccountingSuppliers('/api/accounting/suppliers');
    accountingSuppliers = Array.isArray(data) ? data : (data.data || []);
    
    // reset search input
    const searchInput = $a('accounting-supplier-search');
    if (searchInput) searchInput.value = '';
    
    renderAccountingSuppliersTable(accountingSuppliers);
  } catch (error) {
    console.error('Error loading accounting suppliers:', error);
    if (body) {
      body.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--admin-danger);padding:20px;">فشل تحميل قائمة الموردين: ${escapeHtml(error.message)}</td></tr>`;
    }
    if (empty) empty.style.display = 'none';
    showAdminToast('خطأ أثناء تحميل الموردين', 'error');
  }
}

function renderAccountingSuppliersTable(suppliers) {
  const body = $a('accounting-table-body');
  const empty = $a('accounting-empty-state');
  
  if (!body) return;
  
  if (suppliers.length === 0) {
    body.innerHTML = '';
    if (empty) {
      const h4 = empty.querySelector('h4');
      const p = empty.querySelector('p');
      if (h4) h4.textContent = 'لا يوجد موردون بعد';
      if (p) p.textContent = 'أضف أول مورد للبدء.';
      empty.style.display = 'flex';
    }
    return;
  }
  
  if (empty) empty.style.display = 'none';
  
  body.innerHTML = suppliers.map(s => `
    <tr>
      <td>${escapeHtml(s.name)}</td>
      <td>${escapeHtml(s.phone || '-')}</td>
      <td>${escapeHtml(s.email || '-')}</td>
      <td>${escapeHtml(s.address || '-')}</td>
      <td style="text-align:center">
        <button class="topbar-btn btn-outline btn-sm" onclick="openEditAccountingSupplier('${escapeHtml(s.id)}')">
          <i data-lucide="edit" style="width:14px;height:14px;vertical-align:middle;margin-left:2px"></i> تعديل
        </button>
      </td>
    </tr>
  `).join('');
  
  if (window.lucide) lucide.createIcons();
}

function filterAccountingSuppliers() {
  const query = ($a('accounting-supplier-search')?.value || '').toLowerCase().trim();
  const filtered = accountingSuppliers.filter(s => {
    return (s.name || '').toLowerCase().includes(query) || (s.phone || '').toLowerCase().includes(query);
  });
  renderAccountingSuppliersTable(filtered);
}

function openAddAccountingSupplier() {
  $a('accounting-supplier-modal-title').innerHTML = '<i data-lucide="user-plus" style="width:18px;height:18px;vertical-align:middle;margin-left:4px"></i> إضافة مورد جديد';
  $a('asm-id').value = '';
  $a('asm-name').value = '';
  $a('asm-phone').value = '';
  $a('asm-email').value = '';
  $a('asm-address').value = '';
  
  $a('accounting-supplier-modal').classList.add('open');
  if (window.lucide) lucide.createIcons();
}

function openEditAccountingSupplier(id) {
  const supplier = accountingSuppliers.find(s => String(s.id) === String(id));
  if (!supplier) {
    showAdminToast('لم يتم العثور على بيانات المورد', 'error');
    return;
  }
  
  $a('accounting-supplier-modal-title').innerHTML = '<i data-lucide="edit" style="width:18px;height:18px;vertical-align:middle;margin-left:4px"></i> تعديل بيانات المورد';
  $a('asm-id').value = supplier.id;
  $a('asm-name').value = supplier.name || '';
  $a('asm-phone').value = supplier.phone || '';
  $a('asm-email').value = supplier.email || '';
  $a('asm-address').value = supplier.address || '';
  
  $a('accounting-supplier-modal').classList.add('open');
  if (window.lucide) lucide.createIcons();
}

async function saveAccountingSupplier(btnElement) {
  const id = $a('asm-id').value;
  const name = $a('asm-name').value.trim();
  const phone = $a('asm-phone').value.trim();
  const email = $a('asm-email').value.trim();
  const address = $a('asm-address').value.trim();
  
  if (!name) {
    showAdminToast('الرجاء إدخال اسم المورد', 'error');
    return;
  }
  
  const payload = { name, phone, email, address };
  
  const originalHtml = btnElement.innerHTML;
  btnElement.classList.add('btn-loading');
  btnElement.innerHTML = 'جاري الحفظ...';
  
  try {
    let url = '/api/accounting/suppliers';
    let method = 'POST';
    
    if (id) {
      url = `/api/accounting/suppliers/${encodeURIComponent(id)}`;
      method = 'PUT';
    }
    
    const result = await fetchAccountingSuppliers(url, {
      method: method,
      body: JSON.stringify(payload)
    });
    
    closeModal('accounting-supplier-modal');
    showAdminToast(id ? 'تم تعديل بيانات المورد بنجاح' : 'تم إضافة المورد بنجاح');
    await loadAccountingSuppliers();
  } catch (error) {
    console.error('Error saving supplier:', error);
    showAdminToast(error.message || 'حدث خطأ أثناء حفظ بيانات المورد', 'error');
  } finally {
    btnElement.classList.remove('btn-loading');
    btnElement.innerHTML = originalHtml;
  }
}

// ===== Accounting Accounts Integration =====
let accountingAccounts = [];

const accountTypeLabels = {
  'ASSET': 'أصول',
  'LIABILITY': 'التزامات',
  'EQUITY': 'حقوق ملكية',
  'INCOME': 'إيرادات',
  'EXPENSE': 'مصروفات'
};

async function fetchAccountingAccounts(url, options = {}) {
  const finalHeaders = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  
  const sessionStr = sessionStorage.getItem('louloSession');
  if (sessionStr) {
    try {
      const session = JSON.parse(sessionStr);
      finalHeaders['x-user-role'] = session.role;
      finalHeaders['x-user-id'] = session.id;
    } catch(e) {}
  }
  
  const response = await fetch(url, { ...options, headers: finalHeaders });
  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.message || `HTTP error! status: ${response.status}`);
  }
  return response.json();
}

async function loadAccountingAccounts() {
  const body = $a('accounting-table-body');
  const empty = $a('accounting-empty-state');
  
  try {
    const data = await fetchAccountingAccounts('/api/accounting/accounts');
    accountingAccounts = Array.isArray(data) ? data : (data.data || []);
    
    const searchInput = $a('accounting-account-search');
    if (searchInput) searchInput.value = '';
    
    renderAccountingAccountsTable(accountingAccounts);
  } catch (error) {
    console.error('Error loading accounting accounts:', error);
    if (body) {
      body.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--admin-danger);padding:20px;">فشل تحميل دليل الحسابات: ${escapeHtml(error.message)}</td></tr>`;
    }
    if (empty) empty.style.display = 'none';
    showAdminToast('خطأ أثناء تحميل دليل الحسابات', 'error');
  }
}

function renderAccountingAccountsTable(accounts) {
  const body = $a('accounting-table-body');
  const empty = $a('accounting-empty-state');
  
  if (!body) return;
  
  if (accounts.length === 0) {
    body.innerHTML = '';
    if (empty) {
      const h4 = empty.querySelector('h4');
      const p = empty.querySelector('p');
      if (h4) h4.textContent = 'لا توجد حسابات بعد';
      if (p) p.textContent = 'أضف أول حساب للبدء.';
      empty.style.display = 'flex';
    }
    return;
  }
  
  if (empty) empty.style.display = 'none';
  
  body.innerHTML = accounts.map(a => `
    <tr>
      <td style="direction:ltr;text-align:center;font-family:monospace;font-weight:600">${escapeHtml(a.accountCode)}</td>
      <td>${escapeHtml(a.accountName)}</td>
      <td>${accountTypeLabels[a.accountType] || escapeHtml(a.accountType)}</td>
      <td style="text-align:center">
        <span class="status-badge ${a.isActive ? 'status-active' : 'status-inactive'}">${a.isActive ? 'مفعّل' : 'غير مفعّل'}</span>
      </td>
      <td style="text-align:center">
        <button class="topbar-btn btn-outline btn-sm" onclick="openEditAccountingAccount('${escapeHtml(a.id)}')">
          <i data-lucide="edit" style="width:14px;height:14px;vertical-align:middle;margin-left:2px"></i> تعديل
        </button>
      </td>
    </tr>
  `).join('');
  
  if (window.lucide) lucide.createIcons();
}

function filterAccountingAccounts() {
  const query = ($a('accounting-account-search')?.value || '').toLowerCase().trim();
  const filtered = accountingAccounts.filter(a => {
    return (a.accountCode || '').toLowerCase().includes(query) || (a.accountName || '').toLowerCase().includes(query);
  });
  renderAccountingAccountsTable(filtered);
}

function openAddAccountingAccount() {
  $a('accounting-account-modal-title').innerHTML = '<i data-lucide="plus-circle" style="width:18px;height:18px;vertical-align:middle;margin-left:4px"></i> إضافة حساب جديد';
  $a('aac-id').value = '';
  $a('aac-code').value = '';
  $a('aac-name').value = '';
  $a('aac-type').value = 'ASSET';
  $a('aac-active').checked = true;
  
  $a('accounting-account-modal').classList.add('open');
  if (window.lucide) lucide.createIcons();
}

function openEditAccountingAccount(id) {
  const account = accountingAccounts.find(a => String(a.id) === String(id));
  if (!account) {
    showAdminToast('لم يتم العثور على بيانات الحساب', 'error');
    return;
  }
  
  $a('accounting-account-modal-title').innerHTML = '<i data-lucide="edit" style="width:18px;height:18px;vertical-align:middle;margin-left:4px"></i> تعديل بيانات الحساب';
  $a('aac-id').value = account.id;
  $a('aac-code').value = account.accountCode || '';
  $a('aac-name').value = account.accountName || '';
  $a('aac-type').value = account.accountType || 'ASSET';
  $a('aac-active').checked = account.isActive !== false;
  
  $a('accounting-account-modal').classList.add('open');
  if (window.lucide) lucide.createIcons();
}

async function saveAccountingAccount(btnElement) {
  const id = $a('aac-id').value;
  const accountCode = $a('aac-code').value.trim();
  const accountName = $a('aac-name').value.trim();
  const accountType = $a('aac-type').value;
  const isActive = $a('aac-active').checked;
  
  if (!accountCode) {
    showAdminToast('الرجاء إدخال رمز الحساب', 'error');
    return;
  }
  if (!accountName) {
    showAdminToast('الرجاء إدخال اسم الحساب', 'error');
    return;
  }
  
  const payload = { accountCode, accountName, accountType, isActive };
  
  const originalHtml = btnElement.innerHTML;
  btnElement.classList.add('btn-loading');
  btnElement.innerHTML = 'جاري الحفظ...';
  
  try {
    let url = '/api/accounting/accounts';
    let method = 'POST';
    
    if (id) {
      url = `/api/accounting/accounts/${encodeURIComponent(id)}`;
      method = 'PUT';
    }
    
    const result = await fetchAccountingAccounts(url, {
      method: method,
      body: JSON.stringify(payload)
    });
    
    closeModal('accounting-account-modal');
    showAdminToast(id ? 'تم تعديل بيانات الحساب بنجاح' : 'تم إضافة الحساب بنجاح');
    await loadAccountingAccounts();
  } catch (error) {
    console.error('Error saving account:', error);
    showAdminToast(error.message || 'حدث خطأ أثناء حفظ بيانات الحساب', 'error');
  } finally {
    btnElement.classList.remove('btn-loading');
    btnElement.innerHTML = originalHtml;
  }
}

async function showAccountingTable(type) {
  const home = $a('accounting-home');
  const panel = $a('accounting-table-panel');
  const title = $a('accounting-table-title');
  const subtitle = $a('accounting-table-subtitle');
  const headers = $a('accounting-table-headers');
  const body = $a('accounting-table-body');
  const empty = $a('accounting-empty-state');
  const custActions = $a('accounting-customers-actions');
  const suppActions = $a('accounting-suppliers-actions');

  if (home) home.style.display = 'none';
  if (panel) panel.style.display = 'block';

  // Hide actions panels by default
  if (custActions) custActions.style.display = 'none';
  if (suppActions) suppActions.style.display = 'none';
  const acctActions = $a('accounting-accounts-actions');
  if (acctActions) acctActions.style.display = 'none';

  if (type === 'customers') {
    if (title) title.textContent = 'العملاء';
    if (subtitle) subtitle.textContent = 'قائمة العملاء وأرصدة الحسابات';
    if (headers) {
      headers.innerHTML = '<th>الاسم</th><th>الهاتف</th><th>البريد الإلكتروني</th><th>العنوان</th><th style="width:120px;text-align:center">إجراءات</th>';
    }
    if (custActions) custActions.style.display = 'flex';
    
    // Clear table body first & show loading
    if (body) {
      body.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:20px;">جاري تحميل العملاء...</td></tr>`;
    }
    if (empty) empty.style.display = 'none';
    
    // Load and render customers
    await loadAccountingCustomers();
  } else if (type === 'suppliers') {
    if (title) title.textContent = 'الموردون';
    if (subtitle) subtitle.textContent = 'تفاصيل الموردين والمستحقات';
    if (headers) {
      headers.innerHTML = '<th>الاسم</th><th>الهاتف</th><th>البريد الإلكتروني</th><th>العنوان</th><th style="width:120px;text-align:center">إجراءات</th>';
    }
    if (suppActions) suppActions.style.display = 'flex';
    
    // Clear table body first & show loading
    if (body) {
      body.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:20px;">جاري تحميل الموردين...</td></tr>`;
    }
    if (empty) empty.style.display = 'none';
    
    // Load and render suppliers
    await loadAccountingSuppliers();
  } else if (type === 'accounts') {
    if (title) title.textContent = 'دليل الحسابات';
    if (subtitle) subtitle.textContent = 'عرض فئات الحسابات الرئيسية';
    if (headers) {
      headers.innerHTML = '<th style="width:120px;text-align:center">الرمز</th><th>اسم الحساب</th><th>نوع الحساب</th><th style="width:100px;text-align:center">الحالة</th><th style="width:120px;text-align:center">إجراءات</th>';
    }
    if (acctActions) acctActions.style.display = 'flex';
    
    if (body) {
      body.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:20px;">جاري تحميل دليل الحسابات...</td></tr>`;
    }
    if (empty) empty.style.display = 'none';
    
    await loadAccountingAccounts();
  } else {
    // Standard static rendering for other types
    const data = accountingFixtures[type];
    if (!data) return;
    
    if (title) title.textContent = data.title;
    if (subtitle) subtitle.textContent = data.subtitle || '';
    if (headers) headers.innerHTML = data.headers.map(h => `<th>${h}</th>`).join('');

    if (body) {
      body.innerHTML = data.rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('');
    }

    if (empty) {
      // Restore standard empty state texts
      const h4 = empty.querySelector('h4');
      const p = empty.querySelector('p');
      if (h4) h4.textContent = 'لا توجد بيانات هنا بعد';
      if (p) p.textContent = 'اختر بطاقة من الأعلى لعرض المعلومات المالية المتوفرة.';
      empty.style.display = data.rows.length === 0 ? 'flex' : 'none';
    }
  }

  if (window.lucide) lucide.createIcons();
}

// Ensure summary KPIs are present (static values) when page loads
document.addEventListener('DOMContentLoaded', () => {
  const kpiCash = $a('kpi-cash'); if (kpiCash) kpiCash.textContent = '12,500 ₪';
  const kpiSales = $a('kpi-sales'); if (kpiSales) kpiSales.textContent = '48,300 ₪';
  const kpiReceiv = $a('kpi-receivables'); if (kpiReceiv) kpiReceiv.textContent = '9,200 ₪';
  const kpiExp = $a('kpi-expenses'); if (kpiExp) kpiExp.textContent = '6,750 ₪';
  renderAccountingPage();
});

// ===== Pending Badge =====
async function updatePendingBadge() {
  try {
    const orders = await API.getOrders();
    const pending = (orders || []).filter(o => o.status === 'pending').length;
    const badge = $a('orders-badge');
    if (badge) { badge.textContent = pending; badge.style.display = pending > 0 ? 'inline' : 'none'; }
  } catch(e) { console.error('Badge update failed', e); }
}

// ===== Dashboard =====
const DASHBOARD_MONTHS = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];

function getDashboardMonthLabels(count = 6) {
  const labels = [];
  const now = new Date();
  for (let i = count - 1; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    labels.push(`${DASHBOARD_MONTHS[date.getMonth()]} ${date.getFullYear()}`);
  }
  return labels;
}

function getMonthlyRevenue(orders, labels) {
  const revenueByLabel = Object.fromEntries(labels.map(label => [label, 0]));
  orders.forEach(order => {
    const date = new Date(order.date);
    if (isNaN(date)) return;
    const label = `${DASHBOARD_MONTHS[date.getMonth()]} ${date.getFullYear()}`;
    if (label in revenueByLabel) {
      revenueByLabel[label] += parseFloat(order.total || 0);
    }
  });
  return labels.map(label => Math.round(revenueByLabel[label] || 0));
}

function createDashboardChartDefaults() {
  if (!window.Chart || window.dashboardChartsSetup) return;
  window.dashboardChartsSetup = true;
  Chart.defaults.font.family = 'Cairo, sans-serif';
  Chart.defaults.font.size = 12;
  Chart.defaults.color = '#334155';
  Chart.defaults.plugins.tooltip.enabled = true;
  Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(15, 23, 42, 0.92)';
  Chart.defaults.plugins.tooltip.titleFont = { family: 'Cairo', weight: '700', size: 13 };
  Chart.defaults.plugins.tooltip.bodyFont = { family: 'Cairo', size: 12 };
  Chart.defaults.plugins.tooltip.padding = 12;
  Chart.defaults.plugins.tooltip.cornerRadius = 10;
  Chart.defaults.plugins.tooltip.caretSize = 6;
  Chart.defaults.plugins.tooltip.displayColors = false;
  Chart.defaults.plugins.legend.labels.boxWidth = 12;
  Chart.defaults.plugins.legend.labels.usePointStyle = true;
  Chart.defaults.animation.duration = 900;
  Chart.defaults.animation.easing = 'easeOutQuart';
}

async function renderDashboard() {
  try {
  // Fetch necessary data via API
  const [orders, products, store, users] = await Promise.all([
    API.getOrders(),
    API.getProducts(),
    API.getStoreSettings(),
    API.getUsers()
  ]);

  const sym = store.currencySymbol || store.currency || 'USD';

  // Compute stats
  const totalOrders = orders.length;
  const pendingOrders = orders.filter(o => o.status === 'pending').length;
  const processingOrders = orders.filter(o => o.status === 'processing').length;
  const deliveredOrders = orders.filter(o => o.status === 'delivered').length;
  const totalRevenue = orders.reduce((sum, o) => sum + (o.total || 0), 0);
  const totalProducts = products.length;
  const totalUsers = Array.isArray(users) ? users.length : 0;

  const safeSet = (id, val) => { const el = $a(id); if(el) el.textContent = val; };
  safeSet('stat-orders', totalOrders);
  safeSet('stat-revenue', totalRevenue.toLocaleString('ar-SA') + ` ${sym}`);
  safeSet('stat-products', totalProducts);
  safeSet('stat-pending', pendingOrders);
  safeSet('stat-processing', processingOrders);
  safeSet('stat-delivered', deliveredOrders);
  safeSet('stat-users', totalUsers);

  // Initialize Charts
  if (window.Chart) {
    createDashboardChartDefaults();
    window.dashboardCharts = window.dashboardCharts || {};

    const chartLabels = getDashboardMonthLabels(6);
    const revenueData = getMonthlyRevenue(orders, chartLabels);
    const statusData = [pendingOrders || 0, processingOrders || 0, deliveredOrders || 0];

    const revCtx = document.getElementById('revenueChart');
    if (revCtx) {
      if (window.dashboardCharts.revenue) window.dashboardCharts.revenue.destroy();
      const revGradient = revCtx.getContext('2d').createLinearGradient(0, 0, 0, 320);
      revGradient.addColorStop(0, 'rgba(99, 102, 241, 0.28)');
      revGradient.addColorStop(1, 'rgba(99, 102, 241, 0.04)');

      window.dashboardCharts.revenue = new Chart(revCtx, {
        type: 'line',
        data: {
          labels: chartLabels,
          datasets: [{
            label: 'الإيرادات',
            data: revenueData,
            borderColor: '#6366f1',
            backgroundColor: revGradient,
            borderWidth: 3,
            pointRadius: 4,
            pointHoverRadius: 6,
            pointBackgroundColor: '#fff',
            pointBorderColor: '#6366f1',
            pointBorderWidth: 2,
            tension: 0.38,
            fill: true
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          locale: 'ar-SA',
          plugins: {
            legend: { display: false },
            tooltip: { mode: 'index', intersect: false }
          },
          interaction: { mode: 'nearest', intersect: false },
          scales: {
            y: {
              beginAtZero: true,
              grid: { color: '#f1f5f9' },
              ticks: { callback: value => `${value.toLocaleString('ar-SA')} ${sym}` }
            },
            x: {
              grid: { display: false },
              ticks: { maxRotation: 0, minRotation: 0 }
            }
          }
        }
      });
    }

    const ordCtx = document.getElementById('ordersChart');
    if (ordCtx) {
      if (window.dashboardCharts.orders) window.dashboardCharts.orders.destroy();
      window.dashboardCharts.orders = new Chart(ordCtx, {
        type: 'doughnut',
        data: {
          labels: ['قيد الانتظار', 'جاري التجهيز', 'مكتمل'],
          datasets: [{
            data: statusData,
            backgroundColor: ['#f59e0b', '#3b82f6', '#10b981'],
            borderColor: '#fff',
            borderWidth: 2,
            hoverOffset: 12
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          locale: 'ar-SA',
          cutout: '72%',
          plugins: {
            legend: {
              position: 'bottom',
              labels: { font: { family: 'Cairo', size: 12 }, usePointStyle: true, boxWidth: 10 }
            },
            tooltip: { callbacks: { label: ctx => `${ctx.label}: ${ctx.parsed.toLocaleString('ar-SA')}` } }
          }
        }
      });
    }
  }

  // Recent orders (latest 5)
  const recent = orders.slice(0, 5);
  const tbody = $a('recent-orders-body');
  if (recent.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state" style="margin:20px"><div class="empty-icon"><i data-lucide="receipt"></i></div><h3>لا توجد طلبات</h3><p>الطلبات الجديدة ستظهر هنا.</p></div></td></tr>`;
    if (window.lucide) lucide.createIcons();
    return;
  }
  const currency = sym;
  tbody.innerHTML = recent.map(o => `
    <tr>
      <td><strong>${o.id}</strong></td>
      <td>${o.customer}</td>
      <td>${o.items.length} منتج</td>
      <td><strong>${o.total.toLocaleString('ar-SA')} ${currency}</strong></td>
      <td><span class="status-badge status-${o.status}">${statusText(o.status)}</span></td>
      <td>${o.date}</td>
    </tr>`).join('');
  } catch(e) {
    console.error('Dashboard render failed', e);
    const tbody = $a('recent-orders-body');
    if (tbody) tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state" style="margin:20px"><div class="empty-icon"><i data-lucide="alert-circle"></i></div><h3>خطأ في التحميل</h3><p>حدث خطأ أثناء تحميل البيانات.</p></div></td></tr>`;
    if (window.lucide) lucide.createIcons();
  }
}

function statusText(s) {
  return { pending: 'قيد الانتظار', processing: 'جاري التجهيز', shipped: 'تم الشحن', delivered: 'تم التوصيل', cancelled: 'ملغي' }[s] || s;
}

async function renderProductsTable() {
  // Load products and categories via API
  const [productsData, categories] = await Promise.all([
    API.getProducts(),
    API.getCategories()
  ]);
  
  // Attach store id for compatibility if needed
  let products = productsData.map(p => ({ ...p, _storeId: STORE_ID }));

  const search = ($a('product-search')?.value || '').toLowerCase();
  if (search) products = products.filter(p => p.name.toLowerCase().includes(search));

  const tbody = $a('products-table-body');
  if (products.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state" style="margin:20px"><div class="empty-icon"><i data-lucide="package-x"></i></div><h3>لا توجد منتجات</h3><p>أضف منتجات جديدة للمتجر.</p></div></td></tr>`;
    if (window.lucide) lucide.createIcons();
    return;
  }
  const canEdit = Auth.can('manage_products');
  const storeSettings = await API.getStoreSettings();
  const sym = storeSettings.currencySymbol || storeSettings.currency || 'USD';
  
  tbody.innerHTML = products.map(p => {
    const catName = categories.find(c => c.id === p.category)?.name || p.category;
    return `
    <tr>
      <td>
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:40px;height:40px;border-radius:8px;background:${p.bg};display:flex;align-items:center;justify-content:center;font-size:1.3rem;overflow:hidden">
            ${p.image || (p.images && p.images[0]) 
              ? `<img src="${p.image || p.images[0]}" style="width:100%;height:100%;object-fit:cover" />` 
              : (p.emoji && p.emoji.length <= 4 ? p.emoji : `<i data-lucide="package" style="width:20px;height:20px;opacity:0.5"></i>`)}
          </div>
          <div style="font-weight:600">${p.name}</div>
        </div>
      </td>
      <td>${catName}</td>
      <td><strong>${p.price.toLocaleString('ar-SA')} ${sym}</strong>${p.oldPrice ? `<br><span style="text-decoration:line-through;color:var(--admin-text2);font-size:0.8rem">${p.oldPrice} ${sym}</span>` : ''}</td>
      <td><i data-lucide="star" style="width:14px;height:14px;color:#F59E0B;vertical-align:middle;margin-left:2px"></i> ${p.rating}</td>
      <td>
        <span class="${canEdit ? 'product-toggle' : ''}" ${canEdit ? `onclick="toggleProduct(${p.id})"` : ''} title="${p.active ? 'إيقاف' : 'تفعيل'}" style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:${p.active ? '#22c55e22' : '#ef444422'}">
          <i data-lucide="${p.active ? 'check-circle' : 'x-circle'}" style="width:16px;height:16px;color:${p.active ? '#22c55e' : '#ef4444'}"></i>
        </span>
      </td>
      <td>
        ${canEdit ? `
        <button class="topbar-btn btn-outline btn-sm" onclick="openEditProduct(${p.id})"><i data-lucide="edit" style="width:14px;height:14px;vertical-align:middle;margin-left:2px"></i> تعديل</button>
        <button class="topbar-btn btn-danger btn-sm" onclick="deleteProduct(${p.id})" style="margin-right:4px"><i data-lucide="trash-2" style="width:14px;height:14px;vertical-align:middle"></i></button>
        ` : '-'}
      </td>
    </tr>`;
  }).join('');
  if (window.lucide) lucide.createIcons();
}

function toggleProduct(productId) {
  withLock('toggle-' + productId, () => {
    return API.getProduct(productId).then(p => {
      if (p) {
        return API.updateProduct(productId, { ...p, active: !p.active }).then(res => {
          if (res && res.success === false) { showAdminToast(res.message || 'فشل التحديث', 'error'); }
          renderProductsTable();
        });
      }
    });
  });
}

function showConfirmModal(title, text, onConfirm) {
  const div = document.createElement('div');
  div.className = 'modal-overlay open';
  div.style.zIndex = '9999';
  div.innerHTML = `
    <div class="modal">
      <div class="modal-header"><h3>${title}</h3></div>
      <div class="modal-body"><p style="font-size:1rem;color:var(--admin-text)">${text}</p></div>
      <div class="modal-footer" style="padding:16px 24px">
        <button class="topbar-btn btn-danger btn-active-scale" id="confirm-yes">تأكيد الحذف</button>
        <button class="topbar-btn btn-outline btn-active-scale" id="confirm-no">إلغاء</button>
      </div>
    </div>
  `;
  document.body.appendChild(div);
  div.querySelector('#confirm-yes').onclick = () => { onConfirm(); div.remove(); };
  div.querySelector('#confirm-no').onclick = () => { div.remove(); };
}

function deleteProduct(productId) {
  showConfirmModal('تأكيد الحذف', 'هل أنت متأكد من حذف هذا المنتج؟ لا يمكن التراجع عن هذا الإجراء.', () => {
    withLock('delete-product-' + productId, () => {
      return API.deleteProduct(productId).then(res => {
        if (res && res.success === false) { showAdminToast(res.message || 'فشل الحذف', 'error'); return; }
        appState.products = null; // force refresh
        renderProductsTable();
        showAdminToast('تم حذف المنتج');
      });
    });
  });
}

function confirmDeleteOrder(orderId) {
  const id = orderId || (currentViewOrder && currentViewOrder.id);
  if (!id) return;
  showConfirmModal('تأكيد حذف الطلب', 'هل أنت متأكد من حذف هذا الطلب؟ لا يمكن التراجع عن هذا الإجراء.', () => {
    return withLock('delete-order-' + id, async () => {
      const res = await API.deleteOrder(id);
      if (res && res.success) {
        appState.orders = null;
        renderOrdersTable();
        if (currentViewOrder && currentViewOrder.id === id) {
          currentViewOrder = null;
          closeModal('order-modal');
        }
        showAdminToast('تم حذف الطلب بنجاح');
      } else {
        showAdminToast(res?.message || 'فشل حذف الطلب', 'error');
      }
    });
  });
}

// --- Product Modal ---
function openAddProduct() {
  editingProduct = null;
  $a('product-modal-title').innerHTML = '<i data-lucide="plus-circle" style="width:18px;height:18px;vertical-align:middle;margin-left:4px"></i> إضافة منتج جديد';
  ['pm-name','pm-price','pm-oldprice','pm-badge'].forEach(id => $a(id).value = '');
  $a('pm-bg').value      = '#FFE8F0,#FFB3D1';
  $a('pm-rating').value  = '4.5';
  $a('pm-reviews').value = '0';
  clearImagePreview();
  populateProductCategories();
  $a('product-modal').classList.add('open');
  if (window.lucide) lucide.createIcons();
}

function openEditProduct(productId) {
  API.getProduct(productId).then(p => {
    if (!p) return;
    editingProduct = { productId };
    $a('product-modal-title').innerHTML = '<i data-lucide="edit" style="width:18px;height:18px;vertical-align:middle;margin-left:4px"></i> تعديل المنتج';
    populateProductCategories();
    $a('pm-category').value   = p.category;
    $a('pm-name').value       = p.name;
    $a('pm-price').value      = p.price;
    $a('pm-oldprice').value   = p.oldPrice || '';
    const bgColors = (p.bg || '').replace(/linear-gradient\(135deg,/, '').replace(/\)/, '');
    $a('pm-bg').value         = bgColors;
    $a('pm-badge').value      = p.badge || '';
    $a('pm-rating').value     = p.rating;
    $a('pm-reviews').value    = p.reviews;
    
    const existingImg = p.image || (p.images && p.images[0]);
    if (existingImg) {
      showImagePreview(existingImg);
    } else {
      clearImagePreview();
    }
    
    $a('product-modal').classList.add('open');
    if (window.lucide) lucide.createIcons();
  });
}

function populateProductCategories() {
  API.getCategories().then(cats => {
    const filtered = cats.filter(c => c.id !== 'all');
    $a('pm-category').innerHTML = filtered.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  });
}

function saveProduct(btnElement) {
  if (btnElement) {
    const originalHtml = btnElement.innerHTML;
    btnElement.classList.add('btn-loading');
    btnElement.innerHTML = 'جاري الحفظ...';
    processSaveProduct().finally(() => {
      btnElement.classList.remove('btn-loading');
      btnElement.innerHTML = originalHtml;
    });
  } else {
    processSaveProduct();
  }
}

async function processSaveProduct() {
  const bgVal = $a('pm-bg').value.trim();
  const data = {
    name:     $a('pm-name').value.trim(),
    category: $a('pm-category').value,
    price:    parseFloat($a('pm-price').value) || 0,
    oldPrice: parseFloat($a('pm-oldprice').value) || null,
    bg:       bgVal.startsWith('linear') ? bgVal : `linear-gradient(135deg,${bgVal})`,
    badge:    $a('pm-badge').value || null,
    rating:   parseFloat($a('pm-rating').value) || 4.5,
    reviews:  parseInt($a('pm-reviews').value) || 0,
    active:   true,
  };
  if (!data.name || !data.price) { showAdminToast('الرجاء إدخال اسم المنتج والسعر', 'error'); return; }

  // ===== SAFE Image Upload (ADDITION ONLY) =====
  const fileInput = $a('productImageFile');
  const file = fileInput ? fileInput.files[0] : null;
  if (file) {
    try {
      const uploadRes = await API.uploadImage(file);
      if (uploadRes && uploadRes.success && uploadRes.data && uploadRes.data.path) {
        data.image = uploadRes.data.path;
        console.log('[UPLOAD] Image attached:', data.image);
      } else {
        console.warn('[UPLOAD] Failed, continuing without image:', uploadRes?.message);
      }
    } catch (e) {
      console.error('[UPLOAD] Error, continuing without image:', e);
    }
  }

  // Preserve existing image when editing (if no new file uploaded)
  if (editingProduct && !data.image) {
    try {
      const existing = await API.getProduct(editingProduct.productId);
      if (existing) {
        if (imageMarkedForRemoval) {
          data.image = null; // Removed intentionally
        } else if (existing.image) {
          data.image = existing.image; // Keep old image
        }
      }
    } catch (e) { /* ignore — safe fallback */ }
  }

  return withLock('save-product', () => {
    if (editingProduct) {
      return API.updateProduct(editingProduct.productId, data).then(res => {
        if (res && res.success === false) { showAdminToast(res.message || 'فشل الحفظ', 'error'); return; }
        closeModal('product-modal');
        appState.products = null;
        renderProductsTable();
        showAdminToast('تم حفظ المنتج بنجاح');
      });
    } else {
      return API.addProduct(data).then(res => {
        if (res && res.success === false) { showAdminToast(res.message || 'فشل الإضافة', 'error'); return; }
        closeModal('product-modal');
        appState.products = null;
        renderProductsTable();
        showAdminToast('تم إضافة المنتج بنجاح');
      });
    }
  });
}

// ===== Categories =====
function renderCategoriesPage() {
  API.getCategories().then(cats => {
    const container = $a('categories-container');
    if (!container) return;
    if (cats.length === 0) {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon"><i data-lucide="folder"></i></div><h3>لا توجد تصنيفات</h3><p>أضف تصنيفات لترتيب منتجاتك.</p></div>`;
      if (window.lucide) lucide.createIcons();
      return;
    }
    container.innerHTML = cats.map(c => `
      <div class="store-card" style="min-height:auto;padding:20px">
        <div style="display:flex;align-items:center;gap:14px;justify-content:space-between">
          <div style="display:flex;align-items:center;gap:12px">
            <div style="width:48px;height:48px;border-radius:12px;background:var(--admin-surface2);display:flex;align-items:center;justify-content:center;font-size:1.5rem;overflow:hidden">
              ${c.image ? `<img src="${c.image}" alt="${c.name}" style="width:100%;height:100%;object-fit:cover" />` : `<i data-lucide="folder" style="width:24px;height:24px;opacity:0.6"></i>`}
            </div>
            <div>
              <div style="font-weight:700;font-size:1rem">${c.name}</div>
              <div style="font-size:0.8rem;color:var(--admin-text2)">المعرّف: ${c.id}</div>
            </div>
          </div>
          ${c.id !== 'all' ? `
          <div style="display:flex;gap:6px">
            <button class="topbar-btn btn-outline btn-sm" onclick="openEditCategory('${c.id}')"><i data-lucide="edit" style="width:14px;height:14px"></i></button>
            <button class="topbar-btn btn-danger btn-sm" onclick="deleteCategory('${c.id}')"><i data-lucide="trash-2" style="width:14px;height:14px"></i></button>
          </div>
          ` : `<span style="font-size:0.75rem;color:var(--admin-text2);background:var(--admin-surface2);padding:4px 10px;border-radius:20px">تصنيف افتراضي</span>`}
        </div>
      </div>`).join('');
    if (window.lucide) lucide.createIcons();
  });
}

let categoryImageMarkedForRemoval = false;

function openAddCategory() {
  editingCategory = null;
  categoryImageMarkedForRemoval = false;
  $a('category-modal-title').innerHTML = '<i data-lucide="plus-circle" style="width:18px;height:18px;vertical-align:middle;margin-left:4px"></i> إضافة تصنيف جديد';
  $a('cm-name').value = '';
  clearCategoryImagePreview();
  $a('category-modal').classList.add('open');
  if (window.lucide) lucide.createIcons();
}

function openEditCategory(catId) {
  API.getCategories().then(cats => {
    const cat = cats.find(c => c.id === catId);
    if (!cat) return;
    editingCategory = catId;
    categoryImageMarkedForRemoval = false;
    $a('category-modal-title').innerHTML = '<i data-lucide="edit" style="width:18px;height:18px;vertical-align:middle;margin-left:4px"></i> تعديل التصنيف';
    $a('cm-name').value  = cat.name;
    if (cat.image) {
      showCategoryImagePreview(cat.image);
    } else {
      clearCategoryImagePreview();
    }
    $a('category-modal').classList.add('open');
    if (window.lucide) lucide.createIcons();
  });
}

function saveCategory(btnElement) {
  if (btnElement) {
    const originalHtml = btnElement.innerHTML;
    btnElement.classList.add('btn-loading');
    btnElement.innerHTML = 'جاري الحفظ...';
    setTimeout(() => {
      processSaveCategory();
      btnElement.classList.remove('btn-loading');
      btnElement.innerHTML = originalHtml;
    }, 400);
  } else {
    processSaveCategory();
  }
}

async function processSaveCategory() {
  const name  = $a('cm-name').value.trim();
  if (!name) { showAdminToast('اسم التصنيف مطلوب', 'error'); return; }

  const data = { name };
  const fileInput = $a('cm-image-file');
  const file = fileInput ? fileInput.files[0] : null;

  if (file) {
    try {
      const uploadRes = await API.uploadImage(file, 'category');
      if (uploadRes && uploadRes.success && uploadRes.data && uploadRes.data.path) {
        data.image = uploadRes.data.path;
      } else {
        console.warn('[CATEGORY UPLOAD] Failed, continuing without image:', uploadRes?.message);
      }
    } catch (e) {
      console.error('[CATEGORY UPLOAD] Error, continuing without image:', e);
    }
  }

  if (editingCategory && !data.image) {
    try {
      const cats = await API.getCategories(true);
      const existing = cats.find(c => c.id === editingCategory);
      if (existing) {
        if (categoryImageMarkedForRemoval) {
          data.image = null;
        } else if (existing.image) {
          data.image = existing.image;
        }
      }
    } catch (e) {
      console.warn('[CATEGORY] Could not preserve image:', e);
    }
  }

  return withLock('save-category', async () => {
    if (editingCategory) {
      return API.updateCategory(editingCategory, data).then(res => {
        if (res && res.success === false) { showAdminToast(res.message || 'فشل الحفظ', 'error'); return; }
        closeModal('category-modal');
        appState.categories = null;
        renderCategoriesPage();
        showAdminToast('تم حفظ التصنيف');
      });
    } else {
      return API.addCategory(data).then(res => {
        if (res && res.success === false) { showAdminToast(res.message || 'فشل الإضافة', 'error'); return; }
        closeModal('category-modal');
        appState.categories = null;
        renderCategoriesPage();
        showAdminToast('تم حفظ التصنيف');
      });
    }
  });
}

function handleCategoryImageFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    showAdminToast('الرجاء اختيار ملف صورة صالح', 'error');
    return;
  }
  categoryImageMarkedForRemoval = false;
  const reader = new FileReader();
  reader.onload = (e) => showCategoryImagePreview(e.target.result);
  reader.readAsDataURL(file);
}

function showCategoryImagePreview(src) {
  const wrap = $a('cmImagePreviewWrap');
  const img = $a('cmImagePreview');
  const message = $a('cmDropMessage');
  if (!wrap || !img || !message) return;
  img.src = src;
  wrap.style.display = 'flex';
  message.style.display = 'none';
}

function clearCategoryImagePreview() {
  categoryImageMarkedForRemoval = false;
  const fileInput = $a('cm-image-file');
  if (fileInput) fileInput.value = '';
  const wrap = $a('cmImagePreviewWrap');
  const img = $a('cmImagePreview');
  const message = $a('cmDropMessage');
  if (wrap) wrap.style.display = 'none';
  if (img) img.src = '';
  if (message) message.style.display = 'flex';
}

function triggerCategoryImageReplace() {
  const fileInput = $a('cm-image-file');
  if (fileInput) fileInput.click();
}

function removeCategoryImage() {
  categoryImageMarkedForRemoval = true;
  clearCategoryImagePreview();
}

function deleteCategory(catId) {
  if (catId === 'all') return;
  showConfirmModal('تأكيد الحذف', 'هل أنت متأكد من حذف هذا التصنيف؟', () => {
    withLock('delete-category-' + catId, () => {
      return API.deleteCategory(catId).then(res => {
        if (res && res.success === false) { showAdminToast(res.message || 'فشل الحذف', 'error'); return; }
        appState.categories = null;
        renderCategoriesPage();
        showAdminToast('تم حذف التصنيف');
      });
    });
  });
}

function confirmDeleteOrder(orderId) {
  showConfirmModal('تأكيد حذف الطلب', 'هل أنت متأكد من حذف هذا الطلب؟ لا يمكن التراجع عن هذا الإجراء.', () => {
    return withLock('delete-order-' + orderId, async () => {
      const res = await API.deleteOrder(orderId);
      if (res && res.success) {
        appState.orders = null;
        renderOrdersTable();
        if (currentViewOrder && currentViewOrder.id === orderId) {
          currentViewOrder = null;
          closeModal('order-modal');
        }
        showAdminToast('تم حذف الطلب بنجاح');
      } else {
        showAdminToast(res?.message || 'فشل حذف الطلب', 'error');
      }
    });
  });
}

// ===== Orders =====nlet currentViewOrder = null;

function renderOrdersTable() {
  Promise.all([API.getOrders(), API.getStoreSettings(), API.getUsers()]).then(([orders, store, users]) => {
    const search = ($a('order-search')?.value || '').toLowerCase();
    if (search) orders = orders.filter(o => (o.id || o.orderNumber || '').toLowerCase().includes(search) || o.customer.includes(search));
    const tbody = $a('orders-table-body');
    if (orders.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state" style="margin:20px"><div class="empty-icon"><i data-lucide="receipt"></i></div><h3>لا توجد طلبات</h3><p>لم يقم أحد بالطلب بعد.</p></div></td></tr>`;
      if (window.lucide) lucide.createIcons();
      return;
    }
    const currency = store.currencySymbol || store.currency || 'USD';
    tbody.innerHTML = orders.map(o => {
      const orderKey = getOrderKey(o);
      const assignee = users.find(u => u.id === o.assignedTo);
      const assigneeText = assignee ? `<br><small style="color:var(--admin-primary);font-weight:600">موكل إلى: ${assignee.name}</small>` : '';
      return `
      <tr>
        <td style="text-align:center"><input type="checkbox" class="order-select" data-id="${orderKey}"></td>
        <td><strong>${orderKey}</strong>${assigneeText}</td>
        <td>
          <div style="font-weight:600">${o.customer}</div>
          <div style="font-size:0.78rem;color:var(--admin-text2)">${o.phone}</div>
        </td>
        <td>${o.items.map(i => `${i.emoji || ''} ${i.name} ×${i.qty}`).join('<br>')}</td>
        <td><strong>${o.total.toLocaleString('ar-SA')} ${currency}</strong></td>
        <td>
          <span class="status-badge status-${o.status}">${statusText(o.status)}</span>
        </td>
        <td>
          <div style="font-size:0.82rem;color:var(--admin-text2);margin-bottom:6px">${new Date(o.date).toLocaleDateString('ar-SA')}</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button class="topbar-btn btn-outline btn-sm" onclick="openOrderDetails('${o.id}')"><i data-lucide="eye" style="width:14px;height:14px;vertical-align:middle;margin-left:2px"></i> التفاصيل</button>
            <div style="display:inline-flex;gap:6px;flex-wrap:wrap;align-items:center">
              <button class="topbar-btn btn-primary btn-sm" onclick="downloadOrderPdf(this,'${orderKey}','invoice')">فاتورة PDF</button>
              <button class="topbar-btn btn-outline btn-sm" onclick="printOrder('${orderKey}','invoice')">طباعة فاتورة</button>
              <button class="topbar-btn btn-outline btn-sm" onclick="printOrder('${orderKey}','label')">طباعة ملصق</button>
              <button class="topbar-btn btn-outline btn-sm" onclick="printOrder('${orderKey}','packing')">طباعة Packing</button>
            </div>
            <button class="topbar-btn btn-danger btn-sm action-manage_users" onclick="confirmDeleteOrder('${o.id}')"><i data-lucide="trash-2" style="width:14px;height:14px;vertical-align:middle;margin-left:2px"></i> حذف</button>
          </div>
        </td>
      </tr>`;
    }).join('');
    if (window.lucide) lucide.createIcons();
  });
}

// ===== Print helpers =====
function printOrder(orderId, type = 'invoice') {
  window.open(`/print-order?id=${orderId}&type=${type}`, '_blank');
}

function downloadBlobFile(blob, filename) {
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

async function downloadOrderPdf(button, orderId, type = 'invoice') {
  if (!orderId) return;
  return withLock(`download-order-${orderId}-${type}`, async () => {
    const originalHtml = button ? button.innerHTML : '';
    if (button) {
      button.disabled = true;
      button.classList.add('btn-loading');
      button.innerHTML = 'جارٍ التنزيل...';
    }
    try {
      const res = await API.downloadOrderPdf(orderId, type);
      if (!res.success) {
        throw new Error(res.message || 'فشل تنزيل PDF');
      }
      const filename = `${type}-${orderId}.pdf`;
      downloadBlobFile(res.blob, filename);
      showAdminToast('تم تنزيل الملف بنجاح');
    } catch (err) {
      console.error('[PDF DOWNLOAD]', err);
      showAdminToast(err.message || 'فشل تنزيل PDF، يرجى المحاولة لاحقاً', 'error');
    } finally {
      if (button) {
        button.disabled = false;
        button.classList.remove('btn-loading');
        button.innerHTML = originalHtml;
      }
    }
  });
}

function toggleSelectAllOrders(el) {
  const checked = el.checked;
  document.querySelectorAll('.order-select').forEach(cb => { cb.checked = checked; });
}

function getSelectedOrderIds() {
  return Array.from(document.querySelectorAll('.order-select:checked')).map(cb => cb.getAttribute('data-id'));
}

async function bulkDownloadPdf() {
  const ids = getSelectedOrderIds();
  if (!ids || ids.length === 0) {
    showAdminToast('اختر طلباً واحداً على الأقل لتحميل PDF الجماعي', 'error');
    return;
  }
  const type = 'invoice';
  const btn = document.getElementById('bulk-print-btn');
  const originalHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.classList.add('btn-loading');
    btn.innerHTML = 'جارٍ التحميل...';
  }
  try {
    const res = await API.bulkDownloadOrdersPdf(ids, type);
    if (!res.success) {
      throw new Error(res.message || 'فشل تنزيل PDF الجماعي');
    }
    const filename = `bulk-${type}-orders.pdf`;
    downloadBlobFile(res.blob, filename);
    showAdminToast('تم تنزيل PDF الجماعي بنجاح');
  } catch (err) {
    console.error('[BULK PDF]', err);
    showAdminToast(err.message || 'فشل تنزيل PDF الجماعي، يرجى المحاولة لاحقاً', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.classList.remove('btn-loading');
      btn.innerHTML = originalHtml;
    }
  }
}

async function openOrderDetails(orderId) {
  const [orders, store, users] = await Promise.all([API.getOrders(), API.getStoreSettings(), API.getUsers()]);
  const order = findOrderByIdentifier(orders, orderId);
  if (!order) return;
  currentViewOrder = order;

  // Populate Customer & Items
  const custNameEl = $a('om-customer-name');
  if(custNameEl) custNameEl.textContent = order.customer;
  const custPhoneEl = $a('om-customer-phone');
  if(custPhoneEl) custPhoneEl.textContent = order.phone;
  const custAddressEl = $a('om-customer-address');
  if(custAddressEl) custAddressEl.textContent = order.address || 'لا يوجد عنوان تفصيلي';
  
  const currency = store.currencySymbol || store.currency || 'USD';
  const itemsEl = $a('om-items');
  if(itemsEl) itemsEl.innerHTML = order.items.map(i => `<div style="display:flex;justify-content:space-between;margin-bottom:4px;border-bottom:1px solid rgba(0,0,0,0.05);padding-bottom:4px;"><span>${i.emoji || ''} ${i.name} ×${i.qty}</span><span>${(i.price * i.qty).toLocaleString('ar-SA')} ${currency}</span></div>`).join('');
  const totalEl = $a('om-total');
  if(totalEl) totalEl.textContent = `الإجمالي: ${order.total.toLocaleString('ar-SA')} ${currency}`;

  // Populate Assignee Dropdown
  const assignSelect = $a('om-assignee');
  if(assignSelect) {
    assignSelect.innerHTML = `<option value="">-- غير معين --</option>` + users.map(u => `<option value="${u.id}">${u.name} (${Auth.getRoleLabel(u.role)})</option>`).join('');
    assignSelect.value = order.assignedTo || '';
  }

  // Populate Status Dropdown
  const statusSelect = $a('om-status');
  if(statusSelect) statusSelect.value = order.status;

  // Render Notes
  renderOrderNotes();

  // Render Timeline
  renderOrderTimeline();

  $a('order-modal').classList.add('open');
  if (window.lucide) lucide.createIcons();
  enforceUI_RBAC(); // Hide assign/status updates if not manager
}

function renderOrderNotes() {
  const order = currentViewOrder;
  const list = $a('om-notes-list');
  if(!list) return;
  if (!order.internalComments || order.internalComments.length === 0) {
    list.innerHTML = '<div style="color:var(--admin-text2);font-size:0.85rem">لا توجد ملاحظات.</div>';
  } else {
    list.innerHTML = order.internalComments.map(n => `
      <div style="margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid rgba(0,0,0,0.05)">
        <div style="font-size:0.8rem;color:var(--admin-text2);margin-bottom:2px">بواسطة ${Auth.getRoleLabel(n.addedBy) || n.addedBy} - ${new Date(n.date).toLocaleString('ar-SA')}</div>
        <div style="font-size:0.9rem">${n.text}</div>
      </div>
    `).join('');
  }
}

async function addOrderNote() {
  const input = $a('om-new-note');
  if(!input) return;
  const text = input.value.trim();
  if (!text || !currentViewOrder) return;
  
  const originalText = input.value;
  input.disabled = true;
  const res = await API.addOrderNote(currentViewOrder.id, text);
  input.disabled = false;
  
  if (res && res.success) {
    currentViewOrder = res.data.order || res.data;
    input.value = '';
    renderOrderNotes();
    showAdminToast('تمت إضافة الملاحظة');
  } else {
    showAdminToast(res?.message || 'فشل إضافة الملاحظة', 'error');
    input.value = originalText;
  }
}

function renderOrderTimeline() {
  const order = currentViewOrder;
  const tl = $a('om-timeline');
  if(!tl) return;
  let events = [];
  
  // Creation event
  events.push({ status: 'تم الطلب', date: order.date, by: 'العميل', icon: 'shopping-cart', color: '#3b82f6' });
  
  // Status history
  if (order.statusHistory && order.statusHistory.length > 0) {
    order.statusHistory.forEach(h => {
      events.push({ status: statusText(h.status), date: h.date, by: Auth.getRoleLabel(h.changedBy) || h.changedBy, icon: 'refresh-cw', color: '#8b5cf6' });
    });
  } else {
    events.push({ status: statusText(order.status), date: order.lastUpdated || order.date, by: 'النظام', icon: 'check', color: '#10b981' });
  }

  // Sort by date (descending)
  events.sort((a,b) => new Date(b.date) - new Date(a.date));

  tl.innerHTML = events.map(e => `
    <div style="display:flex;gap:10px;align-items:flex-start">
      <div style="width:24px;height:24px;border-radius:50%;background:${e.color}22;color:${e.color};display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:2px">
        <i data-lucide="${e.icon}" style="width:12px;height:12px"></i>
      </div>
      <div>
        <div style="font-weight:600">${e.status}</div>
        <div style="font-size:0.75rem;color:var(--admin-text2)">${new Date(e.date).toLocaleString('ar-SA')} • بواسطة: ${e.by}</div>
      </div>
    </div>
  `).join('');
  if (window.lucide) lucide.createIcons();
}

async function updateOrderStatus(status) {
  if (!currentViewOrder) return;
  const res = await API.updateOrderStatus(currentViewOrder.id, status);
  if (res && res.success) {
    currentViewOrder = res.data.order || res.data;
    renderOrderTimeline();
    renderOrdersTable();
    updatePendingBadge();
    showAdminToast('تم تحديث الحالة');
    if (currentAdminPage === 'dashboard') renderDashboard();
  } else {
    showAdminToast(res?.message || 'فشل تحديث الحالة', 'error');
    const stEl = $a('om-status');
    if(stEl) stEl.value = currentViewOrder.status; // revert UI
  }
}

async function assignOrderToUser(userId) {
  if (!currentViewOrder) return;
  const res = await API.assignOrderToUser(currentViewOrder.id, userId);
  if (res && res.success) {
    currentViewOrder = res.data.order || res.data;
    renderOrdersTable();
    showAdminToast('تم تعيين الطلب بنجاح');
  } else {
    showAdminToast(res?.message || 'فشل التعيين', 'error');
    const asEl = $a('om-assignee');
    if(asEl) asEl.value = currentViewOrder.assignedTo || ''; // revert UI
  }
}

// ===== Users =====
function renderUsersTable() {
  API.getUsers().then(users => {
    const tbody = $a('users-table-body');
    if (users.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state" style="margin:20px"><div class="empty-icon"><i data-lucide="users"></i></div><h3>لا يوجد مستخدمين</h3><p>لم يقم أحد بالتسجيل بعد.</p></div></td></tr>`;
      if (window.lucide) lucide.createIcons();
      return;
    }
    tbody.innerHTML = users.map(u => `
      <tr>
        <td><strong>${u.name}</strong></td>
        <td>${u.email}</td>
        <td><span style="color:${Auth.getRoleColor(u.role)}">${Auth.getRoleLabel(u.role)}</span></td>
        <td>${u.createdAt}</td>
        <td><span class="status-badge ${u.active ? 'status-delivered' : 'status-cancelled'}">${u.active ? 'نشط' : 'موقوف'}</span></td>
      </tr>`).join('');
  });
}

// ===== Modals =====
function closeModal(id) { $a(id).classList.remove('open'); }

// ===================================================
// ===== SETTINGS ENGINE =====
// ===================================================

let _settingsCurrentStoreId = STORE_ID;

async function initSettingsPage() {
  // Always use the single store — no selector needed
  _settingsCurrentStoreId = STORE_ID;

  // Populate country selector
  await populateCountrySelector();

  // Load settings for the store
  await loadStoreSettings();

  // Dynamically hide settings tabs based on permissions
  const settingsTabsPermissions = {
    identity: 'edit_store_info',
    branding: 'edit_branding',
    regional: 'edit_shipping_settings',
    content: 'edit_legal_pages',
    contact: 'edit_store_info',
    media: 'edit_branding',
    payments: 'edit_payment_settings'
  };

  const tabs = Object.keys(settingsTabsPermissions);
  tabs.forEach(tab => {
    const btn = document.querySelector(`.stab[data-tab="${tab}"]`);
    if (btn) {
      const allowed = Auth.can(settingsTabsPermissions[tab]);
      btn.style.display = allowed ? '' : 'none';
    }
  });

  // Ensure first allowed tab is visible
  const allowedTab = tabs.find(tab => Auth.can(settingsTabsPermissions[tab]));
  if (allowedTab) {
    switchSettingsTab(allowedTab);
  }
}

async function populateCountrySelector() {
  const countries = await API.getCountries();
  const select    = $a('st-country');
  if (!select) return;
  select.innerHTML = countries.map(c =>
    `<option value="${c.code}">${c.flag} ${c.name} (${c.currencySymbol})</option>`
  ).join('');
}

async function loadStoreSettings() {
  const sid = STORE_ID;
  const s   = await API.getStoreSettings();
  if (!s) return;

  // Identity
  setVal('st-name',        s.name);
  setVal('st-subtitle',    s.subtitle);
  setVal('st-description', s.description || '');
  setVal('st-seo-desc',    s.seoDescription || '');
  setVal('st-logo',        s.logo);

  // Branding colors
  const primary       = s.primaryColor     || '#6C3CE1';
  const secondary     = s.secondaryColor   || '#E84393';
  const textColor     = s.textColor        || '#0F172A';
  const subtextColor  = s.subTextColor     || '#475569';
  setVal('st-primary',       primary);
  setVal('st-primary-hex',   primary);
  setVal('st-secondary',     secondary);
  setVal('st-secondary-hex', secondary);
  setVal('st-text-color',    textColor);
  setVal('st-text-color-hex', textColor);
  setVal('st-subtext-color', subtextColor);
  setVal('st-subtext-color-hex', subtextColor);
  setVal('st-theme-select',   s.theme || 'calm');
  _settingsTempPrimary     = primary;
  _settingsTempSecondary   = secondary;
  _settingsTempTextColor   = textColor;
  _settingsTempSubtextColor = subtextColor;
  updateColorPreviewBar(primary, secondary, textColor, subtextColor);

  // Regional
  const countrySelect = $a('st-country');
  if (countrySelect) countrySelect.value = s.country || 'PS';
  const countryData = await API.getCountry(s.country || 'PS');
  updateCurrencyPreview(countryData, s.currencySymbol);
  setVal('st-currency-symbol-override', s.currencySymbol === countryData?.currencySymbol ? '' : s.currencySymbol);

  // Content
  setVal('st-hero-title', s.heroTitle);
  setVal('st-hero-hl',    s.heroHighlight);
  setVal('st-hero-text',  s.heroText);
  setVal('st-about-text', s.aboutText || '');
  setVal('st-privacy-text', s.privacyText || '');
  setVal('st-terms-text', s.termsText || '');

  const featureHighlights = Array.isArray(s.featureHighlights) ? s.featureHighlights : [];
  for (let i = 1; i <= 4; i += 1) {
    const item = featureHighlights[i - 1] || {};
    setVal(`st-feature-${i}-title`, item.title || '');
    setVal(`st-feature-${i}-text`, item.text || '');
  }

  setVal('st-promo',      s.promoText);

  // Promo offer (backward compatible with simple promoText)
  const promo = s.promoOffer || (s.promoText ? { active: true, title: '', message: s.promoText, value: '', type: 'banner' } : { active: false, title: '', message: '', value: '', type: 'banner' });
  const promoActiveEl = $a('st-promo-active'); if (promoActiveEl) promoActiveEl.checked = !!promo.active;
  setVal('st-promo-title', promo.title || '');
  setVal('st-promo', promo.message || '');
  setVal('st-promo-value', promo.value || '');
  const promoTypeEl = $a('st-promo-type'); if (promoTypeEl) promoTypeEl.value = promo.type || 'banner';

  // Contact
  setVal('st-phone',    s.phone);
  setVal('st-email',    s.email);
  setVal('st-whatsapp', s.whatsapp);
  setVal('st-address',  s.address);

  // Payments
  const pay = s.paymentGateways || {};
  const codActiveEl = $a('st-pay-cod'); if (codActiveEl) codActiveEl.checked = pay.cod !== false;
  const visaActiveEl = $a('st-pay-visa'); 
  if (visaActiveEl) {
    visaActiveEl.checked = !!pay.visa;
    const visaSettings = $a('visa-settings');
    if (visaSettings) visaSettings.style.display = pay.visa ? 'block' : 'none';
  }
  setVal('st-pay-gateway', pay.gateway || 'stripe');
  setVal('st-pay-public', pay.publicKey || '');
  setVal('st-pay-secret', pay.secretKey || '');

  // Branding Media Init
  const b = s.branding || {};
  // Backward compatibility check for old logoImage and bannerImage
  _settingsTempBranding = {
    logo: b.logo || s.logoImage || '',
    favicon: b.favicon || '',
    heroBanners: b.heroBanners && b.heroBanners.length ? b.heroBanners : (s.bannerImage ? [s.bannerImage] : []),
    promoBanners: b.promoBanners || []
  };
  
  renderBrandingSection();
  setSaveStatus('');
}

async function saveStoreSettings() {
  return withLock('save-settings', async () => {
    const sid = STORE_ID;

    const countryCode = $a('st-country')?.value || 'PS';
    const country     = await API.getCountry(countryCode);
    const symOverride = ($a('st-currency-symbol-override')?.value || '').trim();
    const currSym     = symOverride || country?.currencySymbol || '₪';

    const promoTitle = ($a('st-promo-title')?.value || '').trim();
    const promoMessage = ($a('st-promo')?.value || '').trim();
    const promoValue = ($a('st-promo-value')?.value || '').trim();
    const promoType = ($a('st-promo-type')?.value || 'banner');
    const promoActive = !!($a('st-promo-active')?.checked);

    const updates = {
      name:           ($a('st-name')?.value || '').trim(),
      subtitle:       ($a('st-subtitle')?.value || '').trim(),
      description:    ($a('st-description')?.value || '').trim(),
      seoDescription: ($a('st-seo-desc')?.value || '').trim(),
      primaryColor:   _settingsTempPrimary   || '#6C3CE1',
      secondaryColor: _settingsTempSecondary || '#E84393',
      country:        countryCode,
      currency:       country?.currency || 'ILS',
      currencySymbol: currSym,
      heroTitle:      ($a('st-hero-title')?.value || '').trim(),
      heroHighlight:  ($a('st-hero-hl')?.value || '').trim(),
      heroText:       ($a('st-hero-text')?.value || '').trim(),
      textColor:      ($a('st-text-color')?.value || '').trim(),
      subTextColor:   ($a('st-subtext-color')?.value || '').trim(),
      theme:          ($a('st-theme-select')?.value || 'calm'),
      aboutText:      ($a('st-about-text')?.value || '').trim(),
      privacyText:    ($a('st-privacy-text')?.value || '').trim(),
      termsText:      ($a('st-terms-text')?.value || '').trim(),
      featureHighlights: [1,2,3,4].map(i => ({
        title: ($a(`st-feature-${i}-title`)?.value || '').trim(),
        text:  ($a(`st-feature-${i}-text`)?.value || '').trim()
      })),
      promoText:      promoMessage,
      promoOffer:     {
        active: promoActive,
        title:  promoTitle,
        message: promoMessage,
        value:  promoValue,
        type:   promoType
      },
      paymentGateways: {
        cod: $a('st-pay-cod') ? !!$a('st-pay-cod').checked : true,
        visa: $a('st-pay-visa') ? !!$a('st-pay-visa').checked : false,
        gateway: ($a('st-pay-gateway')?.value || 'stripe'),
        publicKey: ($a('st-pay-public')?.value || '').trim(),
        secretKey: ($a('st-pay-secret')?.value || '').trim(),
      },
      phone:          ($a('st-phone')?.value || '').trim(),
      email:          ($a('st-email')?.value || '').trim(),
      whatsapp:       ($a('st-whatsapp')?.value || '').trim(),
      address:        ($a('st-address')?.value || '').trim(),
      branding:       _settingsTempBranding,
    };

    const logoInput = $a('st-logo');
    if (logoInput) updates.logo = (logoInput.value || '').trim() || '';

    if (!updates.name) { showAdminToast('اسم المتجر مطلوب', 'error'); return; }

    // Retain existing non-form fields like logoImage and bannerImage
    const currentSettings = await API.getStoreSettings();
    const currentPromo = currentSettings?.promoOffer || {};
    const promoChanged = currentPromo.title !== updates.promoOffer.title
      || currentPromo.message !== updates.promoOffer.message
      || currentPromo.value !== updates.promoOffer.value
      || currentPromo.type !== updates.promoOffer.type
      || currentPromo.active !== updates.promoOffer.active;
    updates.promoOffer.id = currentPromo.id && !promoChanged ? currentPromo.id : Date.now().toString();

    const mergedUpdates = {
      ...currentSettings,
      ...updates,
      logoImage: _settingsTempBranding.logo || currentSettings.logoImage || currentSettings.logo || '',
      bannerImage: (_settingsTempBranding.heroBanners && _settingsTempBranding.heroBanners[0]) || currentSettings.bannerImage || ''
    };

    const res = await API.updateStoreSettings(mergedUpdates);
    if (res && res.success === false) {
      showAdminToast(res.message || 'فشل حفظ الإعدادات', 'error');
      setSaveStatus('خطأ في الحفظ', 'error');
      return;
    }
    appState.settings = null; // force refresh
    showAdminToast('تم حفظ إعدادات المتجر بنجاح');
    setSaveStatus('تم الحفظ في ' + new Date().toLocaleTimeString('ar'), 'success');
  });
}

function setSaveStatus(msg, type = '') {
  const el = $a('save-status');
  if (!el) return;
  el.textContent  = msg;
  el.className    = `save-status ${type}`;
}

// Live preview helpers
function livePreviewText() {
  // Placeholder — future: live preview iframe
}

function onPrimaryChange(val) {
  _settingsTempPrimary = val;
  setVal('st-primary-hex', val);
  updateColorPreviewBar(val, _settingsTempSecondary, _settingsTempTextColor, _settingsTempSubtextColor);
  setSaveStatus('● تغييرات غير محفوظة');
}
function onPrimaryHexChange(val) {
  if (/^#[0-9a-fA-F]{6}$/.test(val)) {
    _settingsTempPrimary = val;
    setVal('st-primary', val);
    updateColorPreviewBar(val, _settingsTempSecondary, _settingsTempTextColor, _settingsTempSubtextColor);
    setSaveStatus('● تغييرات غير محفوظة');
  }
}
function onSecondaryChange(val) {
  _settingsTempSecondary = val;
  setVal('st-secondary-hex', val);
  updateColorPreviewBar(_settingsTempPrimary, val, _settingsTempTextColor, _settingsTempSubtextColor);
  setSaveStatus('● تغييرات غير محفوظة');
}
function onSecondaryHexChange(val) {
  if (/^#[0-9a-fA-F]{6}$/.test(val)) {
    _settingsTempSecondary = val;
    setVal('st-secondary', val);
    updateColorPreviewBar(_settingsTempPrimary, val, _settingsTempTextColor, _settingsTempSubtextColor);
    setSaveStatus('● تغييرات غير محفوظة');
  }
}
function onTextColorChange(val) {
  _settingsTempTextColor = val;
  setVal('st-text-color-hex', val);
  updateColorPreviewBar(_settingsTempPrimary, _settingsTempSecondary, val, _settingsTempSubtextColor);
  setSaveStatus('● تغييرات غير محفوظة');
}
function onTextColorHexChange(val) {
  if (/^#[0-9a-fA-F]{6}$/.test(val)) {
    _settingsTempTextColor = val;
    setVal('st-text-color', val);
    updateColorPreviewBar(_settingsTempPrimary, _settingsTempSecondary, val, _settingsTempSubtextColor);
    setSaveStatus('● تغييرات غير محفوظة');
  }
}
function onSubtextColorChange(val) {
  _settingsTempSubtextColor = val;
  setVal('st-subtext-color-hex', val);
  updateColorPreviewBar(_settingsTempPrimary, _settingsTempSecondary, _settingsTempTextColor, val);
  setSaveStatus('● تغييرات غير محفوظة');
}
function onSubtextColorHexChange(val) {
  if (/^#[0-9a-fA-F]{6}$/.test(val)) {
    _settingsTempSubtextColor = val;
    setVal('st-subtext-color', val);
    updateColorPreviewBar(_settingsTempPrimary, _settingsTempSecondary, _settingsTempTextColor, val);
    setSaveStatus('● تغييرات غير محفوظة');
  }
}

async function updateColorPreviewBar(primary, secondary, textColor, subtextColor) {
  const p  = primary      || '#6C3CE1';
  const s  = secondary    || '#E84393';
  const t  = textColor    || '#0F172A';
  const sub = subtextColor || '#475569';
  const cpbP  = $a('cpb-primary');
  const cpbS  = $a('cpb-secondary');
  const cpbT  = $a('cpb-text');
  const cpbSub = $a('cpb-subtext');
  const cpbG  = $a('cpb-gradient');
  const bPrev = $a('banner-preview');
  if (cpbP) cpbP.style.background = p;
  if (cpbS) cpbS.style.background = s;
  if (cpbT) cpbT.style.background = t;
  if (cpbSub) cpbSub.style.background = sub;
  if (cpbG) cpbG.style.background = `linear-gradient(135deg, ${p}, ${s})`;
  
  if (bPrev) {
    const storeSettings = await API.getStoreSettings();
    if (!storeSettings?.bannerImage) {
      bPrev.style.background = `linear-gradient(135deg, ${p}44, ${s}22)`;
    }
  }
}

function applyPreset(primary, secondary) {
  _settingsTempPrimary   = primary;
  _settingsTempSecondary = secondary;
  setVal('st-primary',       primary);
  setVal('st-primary-hex',   primary);
  setVal('st-secondary',     secondary);
  setVal('st-secondary-hex', secondary);
  updateColorPreviewBar(primary, secondary, _settingsTempTextColor, _settingsTempSubtextColor);
  setSaveStatus('● تغييرات غير محفوظة');
}

// Country / Currency
async function onCountryChange() {
  const code    = $a('st-country')?.value;
  const country = await API.getCountry(code);
  const override = ($a('st-currency-symbol-override')?.value || '').trim();
  updateCurrencyPreview(country, override || country?.currencySymbol);
  setSaveStatus('● تغييرات غير محفوظة');
}

function updateCurrencyPreview(country, overrideSym) {
  const sym     = overrideSym || country?.currencySymbol || '₪';
  const setEl   = (id, txt) => { const el=$a(id); if(el) el.textContent = txt; };
  setEl('currency-symbol-preview', sym);
  setEl('currency-code-preview',   country?.currency || '');
  setEl('currency-name-preview',   country?.currencyName || '');
  setEl('ppb-1', `99 ${sym}`);
  setEl('ppb-2', `1,250 ${sym}`);
  setEl('ppb-3', `15 ${sym}`);
}

// Settings Tabs
function switchSettingsTab(tab) {
  document.querySelectorAll('.stab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.settings-tab-content').forEach(el => {
    el.classList.toggle('active', el.id === `stab-${tab}`);
  });
}

// ===== Branding Media Management =====
function renderBrandingSection() {
  const b = _settingsTempBranding;
  
  // Render Logo
  const mLogo = $a('msg-logo'); const pwLogo = $a('previewWrap-logo'); const piLogo = $a('previewImg-logo');
  if (mLogo && pwLogo && piLogo) {
    if (b.logo) {
      mLogo.style.display = 'none'; pwLogo.style.display = 'flex'; piLogo.src = b.logo;
    } else {
      mLogo.style.display = 'flex'; pwLogo.style.display = 'none';
    }
  }
  
  // Render Favicon
  const mFav = $a('msg-favicon'); const pwFav = $a('previewWrap-favicon'); const piFav = $a('previewImg-favicon');
  if (mFav && pwFav && piFav) {
    if (b.favicon) {
      mFav.style.display = 'none'; pwFav.style.display = 'flex'; piFav.src = b.favicon;
    } else {
      mFav.style.display = 'flex'; pwFav.style.display = 'none';
    }
  }
  
  // Render Hero Banners
  const hList = $a('hero-banners-list');
  if (hList) {
    if (b.heroBanners.length === 0) {
      hList.innerHTML = `<div style="text-align:center;padding:20px;color:var(--admin-text2);font-size:0.9rem;border:1px dashed var(--admin-border);border-radius:8px">لم يتم إضافة بانرات رئيسية بعد.</div>`;
    } else {
      hList.innerHTML = b.heroBanners.map((img, i) => `
        <div style="display:flex;gap:15px;align-items:center;background:var(--admin-surface);padding:12px;border-radius:10px;border:1px solid var(--admin-border)">
          <div style="width:140px;height:50px;border-radius:6px;overflow:hidden;background:#f0f0f0"><img src="${img}" style="width:100%;height:100%;object-fit:cover" /></div>
          <div style="flex:1;font-size:0.9rem;font-weight:600">صورة البانر ${i+1}</div>
          <button type="button" class="icon-btn" onclick="removeBrandingArrayItem('heroBanners', ${i})" style="color:#ef4444" title="حذف"><i data-lucide="trash-2" style="width:18px;height:18px"></i></button>
        </div>
      `).join('');
    }
  }
  
  // Render Promo Banners
  const pList = $a('promo-banners-list');
  if (pList) {
    if (b.promoBanners.length === 0) {
      pList.innerHTML = `<div style="text-align:center;padding:20px;color:var(--admin-text2);font-size:0.9rem;border:1px dashed var(--admin-border);border-radius:8px">لم يتم إضافة بانرات ترويجية بعد.</div>`;
    } else {
      pList.innerHTML = b.promoBanners.map((img, i) => `
        <div style="display:flex;gap:15px;align-items:center;background:var(--admin-surface);padding:12px;border-radius:10px;border:1px solid var(--admin-border)">
          <div style="width:140px;height:50px;border-radius:6px;overflow:hidden;background:#f0f0f0"><img src="${img}" style="width:100%;height:100%;object-fit:cover" /></div>
          <div style="flex:1;font-size:0.9rem;font-weight:600">ترويج ${i+1}</div>
          <button type="button" class="icon-btn" onclick="removeBrandingArrayItem('promoBanners', ${i})" style="color:#ef4444" title="حذف"><i data-lucide="trash-2" style="width:18px;height:18px"></i></button>
        </div>
      `).join('');
    }
  }
  if (window.lucide) lucide.createIcons();
}

async function uploadBrandingImage(input, key) {
  const file = input.files[0];
  if (!file) return;
  input.value = ''; // Reset
  
  showAdminToast('جاري رفع الصورة...', 'success');
  
  try {
    const res = await API.uploadImage(file, 'branding');
    if (res && res.success) {
      if (key === 'logo' || key === 'favicon') {
        _settingsTempBranding[key] = res.data.path;
      } else if (key === 'hero') {
        _settingsTempBranding.heroBanners.push(res.data.path);
      } else if (key === 'promo') {
        _settingsTempBranding.promoBanners.push(res.data.path);
      }
      renderBrandingSection();
      setSaveStatus('● تغييرات غير محفوظة في الوسائط');
      showAdminToast('تم الرفع بنجاح');
    } else {
      showAdminToast(res.message || 'فشل الرفع', 'error');
    }
  } catch (err) {
    showAdminToast('حدث خطأ أثناء الرفع', 'error');
  }
}

function removeBrandingImage(e, key) {
  e.stopPropagation(); // prevent clicking dropzone
  _settingsTempBranding[key] = '';
  renderBrandingSection();
  setSaveStatus('● تغييرات غير محفوظة في الوسائط');
}

function removeBrandingArrayItem(arrayKey, index) {
  _settingsTempBranding[arrayKey].splice(index, 1);
  renderBrandingSection();
  setSaveStatus('● تغييرات غير محفوظة في الوسائط');
}

// Helper: set value safely
function setVal(id, val) {
  const el = $a(id);
  if (!el) return;
  if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.tagName === 'SELECT') el.value = val ?? '';
}

// ===== Init =====
async function initAdmin() {
  const session = Auth.requireAuth();
  if (!session) return;

  // Load dynamic permissions from backend API
  try {
    const permissionsMap = await API.getPermissions();
    if (permissionsMap) {
      Auth.setDynamicPermissions(permissionsMap);
    }
  } catch (err) {
    console.error("Failed to load dynamic permissions from server:", err);
  }
  
  // Render permissions matrix in Users tab
  renderPermissionsMatrix();

  // User profile header
  const userNameEl = $a('user-name');
  const userRoleEl = $a('user-role');
  const userEmojiEl = $a('user-emoji');
  if (userNameEl) userNameEl.textContent  = session.name;
  if (userRoleEl) userRoleEl.textContent  = Auth.getRoleLabel(session.role);

  // Permission-based nav visibility
  const navDashboard = $a('nav-dashboard');
  const navProducts = $a('nav-products');
  const navCategories = $a('nav-categories');
  const navOrders = $a('nav-orders');
  const navUsers = $a('nav-users');
  const navCoupons = $a('nav-coupons');
  const navSettings = $a('nav-settings');

  const navAccounting = $a('nav-accounting');
  if (navDashboard) navDashboard.style.display = Auth.can('view_dashboard') ? '' : 'none';
  if (navProducts) navProducts.style.display = Auth.can('view_products') ? '' : 'none';
  if (navCategories) navCategories.style.display = Auth.can('view_categories') ? '' : 'none';
  if (navOrders) navOrders.style.display = Auth.can('view_orders') ? '' : 'none';
  if (navUsers) navUsers.style.display = Auth.can('view_users') ? '' : 'none';
  if (navAccounting) navAccounting.style.display = '';
  if (navCoupons) navCoupons.style.display = Auth.can('view_coupons') ? '' : 'none';
  if (navSettings) navSettings.style.display = Auth.can('view_settings') ? '' : 'none';

  // Set store link
  const navOpenStore = $a('nav-open-store');
  if (navOpenStore) navOpenStore.href = `index.html?store=${STORE_ID}`;

  // Dynamic Store Identity — Graceful
  try {
    const store = await API.getStoreSettings();
    if (store && store.name) {
      const logoEl = document.querySelector('.sidebar-logo');
      if (logoEl) {
        const sidebarLogoIcon = store.logoImage ? `<img src="${store.logoImage}" style="width:24px;height:24px;object-fit:cover;border-radius:4px;vertical-align:middle">` : `<i data-lucide="gem" style="width:24px;height:24px;vertical-align:middle"></i>`;
        logoEl.innerHTML = `${sidebarLogoIcon} ${store.name}
          <small>${store.subtitle || 'لوحة إدارة المتجر'}</small>`;
      }
      const sidebarStoreNameEl = $a('sidebar-store-name');
      if (sidebarStoreNameEl) sidebarStoreNameEl.textContent = store.name;
      document.title = `لوحة التحكم | ${store.name}`;
    }
  } catch(e) {
    console.error("Could not fetch store settings for dynamic identity", e);
  }

  updatePendingBadge();
  
  // Find first allowed page
  const pagesOrder = ['dashboard', 'products', 'categories', 'orders', 'users', 'coupons', 'settings'];
  const pagesPermissions = {
    dashboard: 'view_dashboard',
    products: 'view_products',
    categories: 'view_categories',
    orders: 'view_orders',
    users: 'view_users',
    coupons: 'view_coupons',
    settings: 'view_settings'
  };
  
  let targetPage = 'dashboard';
  if (!Auth.can('view_dashboard')) {
    const allowedPage = pagesOrder.find(p => Auth.can(pagesPermissions[p]));
    if (allowedPage) {
      targetPage = allowedPage;
    } else {
      targetPage = 'access-denied';
    }
  }
  navigateTo(targetPage);
  
  // Setup drag & drop
  setupImageDropZone();

  // Nav clicks
  document.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', () => {
      const page = el.getAttribute('data-page');
      if (page) navigateTo(page);
    });
  });

  // Apply UI restrictions
  enforceUI_RBAC();
  
  // Search listeners (debounced)
  let _searchTimer = null;
  $a('product-search')?.addEventListener('input', () => {
    clearTimeout(_searchTimer);
    _searchTimer = setTimeout(() => renderProductsTable(), 300);
  });
  let _orderSearchTimer = null;
  $a('order-search')?.addEventListener('input', () => {
    clearTimeout(_orderSearchTimer);
    _orderSearchTimer = setTimeout(() => renderOrdersTable(), 300);
  });

  // Global error handler
  window.addEventListener('unhandledrejection', e => {
    console.error('[UNHANDLED]', e.reason);
    e.preventDefault();
  });
}

// ===== Drag & Drop Logic =====
function setupImageDropZone() {
  const dropZone = $a('imageDropZone');
  const fileInput = $a('productImageFile');
  if (!dropZone || !fileInput) return;

  dropZone.addEventListener('click', (e) => {
    // Prevent triggering if clicked on action buttons
    if (e.target.closest('.image-preview-actions')) return;
    fileInput.click();
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      fileInput.files = e.dataTransfer.files;
      handleImageFile(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleImageFile(e.target.files[0]);
    }
  });
}

function handleImageFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    showAdminToast('الرجاء اختيار ملف صورة صالح', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    showImagePreview(e.target.result);
  };
  reader.readAsDataURL(file);
}

function showImagePreview(src) {
  imageMarkedForRemoval = false;
  $a('dropMessage').style.display = 'none';
  const wrap = $a('imagePreviewWrap');
  const img = $a('imagePreview');
  img.src = src;
  wrap.style.display = 'flex';
}

function clearImagePreview() {
  imageMarkedForRemoval = false;
  const fileInput = $a('productImageFile');
  if (fileInput) fileInput.value = '';
  $a('imagePreviewWrap').style.display = 'none';
  $a('imagePreview').src = '';
  $a('dropMessage').style.display = 'flex';
}

function triggerImageReplace() {
  const fileInput = $a('productImageFile');
  if (fileInput) fileInput.click();
}

function removeProductImage() {
  imageMarkedForRemoval = true;
  const fileInput = $a('productImageFile');
  if (fileInput) fileInput.value = '';
  $a('imagePreviewWrap').style.display = 'none';
  $a('imagePreview').src = '';
  $a('dropMessage').style.display = 'flex';
}

// ===== User Management Logic =====
let editingUser = null;

async function renderUsersTable() {
  const tbody = $a('users-table-body');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">جاري التحميل...</td></tr>';
  try {
    const users = await API.getUsers();
    if (!users || users.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--admin-text2);">لا يوجد مستخدمين.</td></tr>';
      return;
    }
    
    tbody.innerHTML = users.map(u => {
      const roleBadge = Auth.getRoleLabel(u.role);
      const roleColor = Auth.getRoleColor(u.role);
      
      return `
        <tr>
          <td><div style="font-weight:700;">${u.name}</div></td>
          <td><code>${u.username || '-'}</code></td>
          <td>${u.email}</td>
          <td><span class="status-chip" style="background-color:${roleColor}22;color:${roleColor};">${roleBadge}</span></td>
          <td>${u.createdAt || '-'}</td>
          <td>
            <div style="display:flex;gap:10px;align-items:center;">
              <span class="status-chip ${u.active ? 'delivered' : 'cancelled'}">${u.active ? 'نشط' : 'موقوف'}</span>
              <button class="icon-btn action-edit_users" onclick="openEditUser('${u.id}')" title="تعديل" style="color:var(--admin-primary)"><i data-lucide="edit-2" style="width:16px;height:16px"></i></button>
              <button class="icon-btn action-delete_users" onclick="deleteUser('${u.id}')" title="حذف" style="color:#ef4444"><i data-lucide="trash-2" style="width:16px;height:16px"></i></button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
    if (window.lucide) lucide.createIcons();
    enforceUI_RBAC();
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#ef4444;">حدث خطأ في التحميل.</td></tr>';
  }
}

function openAddUser() {
  editingUser = null;
  $a('user-modal-title').innerHTML = '<i data-lucide="user-plus" style="width:18px;height:18px;vertical-align:middle;margin-left:4px"></i> إضافة مستخدم جديد';
  $a('um-name').value = '';
  $a('um-username').value = '';
  $a('um-email').value = '';
  $a('um-password').value = '';
  $a('um-role').value = 'employee';
  $a('um-active').checked = true;
  $a('user-modal').classList.add('open');
  if (window.lucide) lucide.createIcons();
}

async function openEditUser(id) {
  const users = await API.getUsers();
  const user = users.find(u => String(u.id) === String(id));
  if (!user) return;
  editingUser = user;
  
  $a('user-modal-title').innerHTML = '<i data-lucide="edit-2" style="width:18px;height:18px;vertical-align:middle;margin-left:4px"></i> تعديل المستخدم';
  $a('um-name').value = user.name || '';
  $a('um-username').value = user.username || '';
  $a('um-email').value = user.email || '';
  $a('um-password').value = user.password || '';
  $a('um-role').value = user.role || 'employee';
  $a('um-active').checked = user.active !== false;
  
  $a('user-modal').classList.add('open');
  if (window.lucide) lucide.createIcons();
}

async function saveUser(btn) {
  const name = $a('um-name').value.trim();
  const username = $a('um-username').value.trim();
  const email = $a('um-email').value.trim();
  const password = $a('um-password').value.trim();
  const role = $a('um-role').value;
  const active = $a('um-active').checked;
  
  if (!name || !username || !email || !password) {
    showAdminToast('الرجاء تعبئة جميع الحقول المطلوبة', 'error');
    return;
  }
  
  const originalText = btn.innerHTML;
  btn.innerHTML = '<i data-lucide="loader" style="width:14px;height:14px;vertical-align:middle;margin-left:4px;animation:spin 1s linear infinite"></i> جاري الحفظ...';
  btn.disabled = true;
  
  const users = await API.getUsers();
  const normalizedUsername = username.toLowerCase();
  const usernameTaken = users.some(u => String(u.username || '').toLowerCase() === normalizedUsername && (!editingUser || String(u.id) !== String(editingUser.id)));
  if (usernameTaken) {
    showAdminToast('اسم المستخدم مستخدم مسبقاً، يرجى اختيار اسم آخر', 'error');
    btn.innerHTML = originalText;
    btn.disabled = false;
    return;
  }
  
  if (editingUser && editingUser.role === 'super_admin' && (role !== 'super_admin' || !active)) {
    const activeSuperAdmins = users.filter(u => u.role === 'super_admin' && u.active);
    if (activeSuperAdmins.length <= 1) {
      showAdminToast('لا يمكن إلغاء تنشيط أو تغيير دور آخر مدير عام (Super Admin) في النظام!', 'error');
      btn.innerHTML = originalText;
      btn.disabled = false;
      return;
    }
  }

  const data = { username, name, email, password, role, active };
  
  try {
    let res;
    if (editingUser) {
      res = await API.updateUser(editingUser.id, data);
    } else {
      res = await API.createUser(data);
    }
    
    if (res && res.success !== false) {
      showAdminToast('تم حفظ المستخدم بنجاح');
      closeModal('user-modal');
      renderUsersTable();
    } else {
      showAdminToast(res?.message || 'فشل حفظ المستخدم', 'error');
    }
  } catch (err) {
    showAdminToast('حدث خطأ غير متوقع', 'error');
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
    if (window.lucide) lucide.createIcons();
  }
}

async function deleteUser(id) {
  const users = await API.getUsers();
  const targetUser = users.find(u => String(u.id) === String(id));
  if (targetUser && targetUser.role === 'super_admin') {
    const superAdmins = users.filter(u => u.role === 'super_admin');
    if (superAdmins.length <= 1) {
      showAdminToast('لا يمكن حذف آخر مدير عام (Super Admin) في النظام!', 'error');
      return;
    }
  }
  
  if (!confirm('هل أنت متأكد من حذف هذا المستخدم؟')) return;
  const res = await API.deleteUser(id);
  if (res && res.success !== false) {
    showAdminToast('تم الحذف بنجاح');
    renderUsersTable();
  } else {
    showAdminToast(res?.message || 'فشل الحذف', 'error');
  }
}

// ===== Coupons Management =====
let editingCoupon = null;

async function renderCouponsTable() {
  const tbody = $a('coupons-table-body');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">جاري التحميل...</td></tr>';
  try {
    const coupons = await API.getCoupons();
    if (!coupons || coupons.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--admin-text2);">لا توجد كوبونات.</td></tr>';
      return;
    }
    
    tbody.innerHTML = coupons.map(c => `
      <tr>
        <td><div style="font-weight:700;font-family:monospace;font-size:1.1rem">${c.code}</div></td>
        <td><span style="font-weight:700;color:var(--admin-primary)">${c.discountPercent}%</span></td>
        <td>
          <div style="display:flex;gap:10px;align-items:center;">
            <span class="status-chip ${c.active !== false ? 'delivered' : 'cancelled'}">${c.active !== false ? 'فعال' : 'غير فعال'}</span>
          </div>
        </td>
        <td>
          <div style="display:flex;gap:10px;align-items:center;">
            <button class="icon-btn" onclick="openEditCoupon('${c.code}')" title="تعديل" style="color:var(--admin-primary)"><i data-lucide="edit-2" style="width:16px;height:16px"></i></button>
            <button class="icon-btn" onclick="deleteCoupon('${c.code}')" title="حذف" style="color:#ef4444"><i data-lucide="trash-2" style="width:16px;height:16px"></i></button>
          </div>
        </td>
      </tr>
    `).join('');
    if (window.lucide) lucide.createIcons();
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#ef4444;">حدث خطأ في التحميل.</td></tr>';
  }
}

function openAddCoupon() {
  editingCoupon = null;
  $a('coupon-modal-title').innerHTML = '<i data-lucide="plus-circle" style="width:18px;height:18px;vertical-align:middle;margin-left:4px"></i> إضافة كوبون جديد';
  $a('com-code').value = '';
  $a('com-discount').value = '';
  $a('com-active').checked = true;
  $a('com-code').disabled = false;
  $a('coupon-modal').classList.add('open');
  if (window.lucide) lucide.createIcons();
}

async function openEditCoupon(code) {
  const coupons = await API.getCoupons();
  const coupon = coupons.find(c => c.code === code);
  if (!coupon) return;
  editingCoupon = coupon;
  
  $a('coupon-modal-title').innerHTML = '<i data-lucide="edit-2" style="width:18px;height:18px;vertical-align:middle;margin-left:4px"></i> تعديل الكوبون';
  $a('com-code').value = coupon.code;
  $a('com-code').disabled = true; // Code shouldn't be edited normally
  $a('com-discount').value = coupon.discountPercent;
  $a('com-active').checked = coupon.active !== false;
  
  $a('coupon-modal').classList.add('open');
  if (window.lucide) lucide.createIcons();
}

async function saveCoupon(btn) {
  const code = $a('com-code').value.trim().toUpperCase();
  const discountPercent = parseInt($a('com-discount').value);
  const active = $a('com-active').checked;
  
  if (!code || isNaN(discountPercent) || discountPercent < 1 || discountPercent > 100) {
    showAdminToast('الرجاء إدخال كود ونسبة خصم صحيحة', 'error');
    return;
  }
  
  const originalText = btn.innerHTML;
  btn.innerHTML = '<i data-lucide="loader" style="width:14px;height:14px;vertical-align:middle;margin-left:4px;animation:spin 1s linear infinite"></i> جاري الحفظ...';
  btn.disabled = true;
  
  const data = { code, discountPercent, active };
  
  try {
    let res;
    if (editingCoupon) {
      res = await API.updateCoupon(editingCoupon.code, data);
    } else {
      res = await API.createCoupon(data);
    }
    
    if (res && res.success !== false) {
      showAdminToast('تم حفظ الكوبون بنجاح');
      closeModal('coupon-modal');
      renderCouponsTable();
    } else {
      showAdminToast(res?.message || 'فشل حفظ الكوبون', 'error');
    }
  } catch (err) {
    showAdminToast('حدث خطأ غير متوقع', 'error');
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
    if (window.lucide) lucide.createIcons();
  }
}

async function deleteCoupon(code) {
  if (!confirm('هل أنت متأكد من حذف هذا الكوبون؟')) return;
  const res = await API.deleteCoupon(code);
  if (res && res.success !== false) {
    showAdminToast('تم الحذف بنجاح');
    renderCouponsTable();
  } else {
    showAdminToast(res?.message || 'فشل الحذف', 'error');
  }
}

// ===== UI Protection Logic =====
function enforceUI_RBAC() {
  const elems = document.querySelectorAll('[class*="action-"]');
  elems.forEach(el => {
    const classList = Array.from(el.classList);
    const permClass = classList.find(c => c.startsWith('action-'));
    if (permClass) {
      // Extract permission key: remove 'action-' prefix only
      const perm = permClass.replace(/^action-/, '');
      if (!Auth.can(perm)) {
        el.style.display = 'none';
      } else {
        el.style.display = ''; // Restore if re-rendered
      }
    }
  });
}

document.addEventListener('DOMContentLoaded', initAdmin);

// ===== Theme Gallery Sync Logic (NoorLabs Admin 2.0) =====
function selectThemeCard(themeId) {
  const select = document.getElementById('st-theme-select');
  if (select) {
    select.value = themeId;
    select.dispatchEvent(new Event('change'));
  }
  syncThemeGalleryCards(themeId);
  if (typeof setSaveStatus === 'function') {
    setSaveStatus('● تغييرات غير محفوظة');
  }
}

function previewTheme(themeId) {
  window.open(`index.html?store=${STORE_ID}&theme=${themeId}`, '_blank');
}

function syncThemeGalleryCards(activeTheme) {
  document.querySelectorAll('.theme-gallery-card').forEach(card => {
    const tid = card.getAttribute('data-theme-id');
    const isActive = tid === activeTheme;
    card.classList.toggle('active', isActive);
    
    // Toggle buttons / badges inside card
    const btnSelect = card.querySelector('.btn-select-theme');
    const badgeActive = card.querySelector('.theme-active-badge');
    if (btnSelect && badgeActive) {
      if (isActive) {
        btnSelect.style.display = 'none';
        badgeActive.style.display = 'inline-flex';
      } else {
        btnSelect.style.display = 'block';
        badgeActive.style.display = 'none';
      }
    }
  });
}

// Intercept select change
document.getElementById('st-theme-select')?.addEventListener('change', (e) => {
  syncThemeGalleryCards(e.target.value);
});

// Periodically sync cards with select value (e.g. when loaded dynamically)
setInterval(() => {
  const select = document.getElementById('st-theme-select');
  if (select) {
    const activeTheme = select.value || 'calm';
    const activeCard = document.querySelector('.theme-gallery-card.active');
    if (!activeCard || activeCard.getAttribute('data-theme-id') !== activeTheme) {
      syncThemeGalleryCards(activeTheme);
    }
  }
}, 500);

// ===== RBAC Matrix UI Logic =====
const PERMISSION_GROUPS = [
  {
    groupName: "إدارة المنتجات (Products)",
    permissions: [
      { key: "view_products", label: "عرض المنتجات" },
      { key: "add_products", label: "إضافة منتجات جديدة" },
      { key: "edit_products", label: "تعديل المنتجات الحالية" },
      { key: "delete_products", label: "حذف المنتجات" }
    ]
  },
  {
    groupName: "التصنيفات (Categories)",
    permissions: [
      { key: "view_categories", label: "عرض التصنيفات" },
      { key: "manage_categories", label: "إدارة التصنيفات (إضافة، تعديل، حذف)" }
    ]
  },
  {
    groupName: "الطلبات والمبيعات (Orders)",
    permissions: [
      { key: "view_orders", label: "عرض الطلبات" },
      { key: "update_orders", label: "تحديث حالة الطلبات وتعيينها" },
      { key: "add_order_notes", label: "إضافة ملاحظات داخلية للطلبات" },
      { key: "delete_orders", label: "حذف الطلبات من النظام" }
    ]
  },
  {
    groupName: "كوبونات الخصم (Coupons)",
    permissions: [
      { key: "view_coupons", label: "عرض الكوبونات" },
      { key: "manage_coupons", label: "إدارة الكوبونات (إضافة، تعديل، حذف)" }
    ]
  },
  {
    groupName: "العملاء (Customers)",
    permissions: [
      { key: "view_customers", label: "عرض معلومات العملاء" },
      { key: "manage_customers", label: "إدارة تفاصيل وبيانات العملاء" }
    ]
  },
  {
    groupName: "المستخدمين والأدوار (Users & Roles)",
    permissions: [
      { key: "view_users", label: "عرض مستخدمي النظام" },
      { key: "add_users", label: "إضافة مستخدم جديد" },
      { key: "edit_users", label: "تعديل بيانات المستخدمين" },
      { key: "delete_users", label: "حذف المستخدمين" },
      { key: "manage_roles_permissions", label: "تعديل صلاحيات الأدوار والمسؤوليات" }
    ]
  },
  {
    groupName: "إعدادات المتجر (Settings)",
    permissions: [
      { key: "view_settings", label: "عرض صفحة الإعدادات" },
      { key: "edit_store_info", label: "تعديل معلومات المتجر والتواصل" },
      { key: "edit_branding", label: "تعديل الهوية البصرية واللوغو والبنرات" },
      { key: "edit_theme", label: "تغيير ثيم المتجر الحالي" },
      { key: "edit_colors", label: "تعديل ألوان المتجر الافتراضية" },
      { key: "edit_payment_settings", label: "تعديل بوابات الدفع الإلكتروني" },
      { key: "edit_shipping_settings", label: "تعديل خيارات الشحن والتوصيل" },
      { key: "edit_legal_pages", label: "تعديل صفحات السياسات والشروط والمحتوى" }
    ]
  },
  {
    groupName: "التقارير والتحليلات (Analytics)",
    permissions: [
      { key: "view_dashboard", label: "عرض لوحة المعلومات الإجمالية" },
      { key: "view_analytics", label: "عرض التقارير والرسوم البيانية للمبيعات" }
    ]
  }
];

function renderPermissionsMatrix() {
  const tbody = document.getElementById('permissions-matrix-body');
  if (!tbody) return;
  
  let html = '';
  PERMISSION_GROUPS.forEach(group => {
    // Group Header Row
    html += `
      <tr style="background:#f1f5f9; font-weight:800; color:#1e293b;">
        <td colspan="6" style="padding:10px 14px; text-align:right;">${group.groupName}</td>
      </tr>
    `;
    
    // Permission Rows
    group.permissions.forEach(perm => {
      // For Store Settings themes/colors and platform-level configs: Store Owner has default restrictions but Super Admin can change it.
      html += `
        <tr>
          <td style="padding:12px 14px; font-weight:500;">
            <div>${perm.label}</div>
            <code style="font-size:10px; color:#94a3b8; font-weight:normal;">${perm.key}</code>
          </td>
          <td style="text-align:center;">
            <input type="checkbox" checked disabled style="width:16px; height:16px; cursor:not-allowed;" />
          </td>
          <td style="text-align:center;">
            <input type="checkbox" class="perm-matrix-checkbox" data-role="store_owner" data-perm="${perm.key}" ${Auth.canRole('store_owner', perm.key) ? 'checked' : ''} style="width:16px; height:16px; cursor:pointer;" />
          </td>
          <td style="text-align:center;">
            <input type="checkbox" class="perm-matrix-checkbox" data-role="manager" data-perm="${perm.key}" ${Auth.canRole('manager', perm.key) ? 'checked' : ''} style="width:16px; height:16px; cursor:pointer;" />
          </td>
          <td style="text-align:center;">
            <input type="checkbox" class="perm-matrix-checkbox" data-role="employee" data-perm="${perm.key}" ${Auth.canRole('employee', perm.key) ? 'checked' : ''} style="width:16px; height:16px; cursor:pointer;" />
          </td>
          <td style="text-align:center;">
            <input type="checkbox" class="perm-matrix-checkbox" data-role="support_agent" data-perm="${perm.key}" ${Auth.canRole('support_agent', perm.key) ? 'checked' : ''} style="width:16px; height:16px; cursor:pointer;" />
          </td>
        </tr>
      `;
    });
  });
  
  tbody.innerHTML = html;
}

async function savePermissionsMatrix(btn) {
  const originalText = btn.innerHTML;
  btn.innerHTML = '<i data-lucide="loader" style="width:14px;height:14px;vertical-align:middle;margin-left:4px;animation:spin 1s linear infinite"></i> جاري الحفظ...';
  btn.disabled = true;
  
  const roles = ['store_owner', 'manager', 'employee', 'support_agent'];
  const newPermsMap = {
    super_admin: [] // Backend always overrides, but frontend sends it empty or with everything
  };
  roles.forEach(role => {
    newPermsMap[role] = [];
  });
  
  // Also sync legacy role store_manager
  newPermsMap.store_manager = [];
  
  const checkboxes = document.querySelectorAll('.perm-matrix-checkbox');
  checkboxes.forEach(cb => {
    const role = cb.getAttribute('data-role');
    const perm = cb.getAttribute('data-perm');
    if (cb.checked && role !== 'super_admin') {
      newPermsMap[role].push(perm);
      if (role === 'store_owner') {
        newPermsMap.store_manager.push(perm);
      }
    }
  });

  try {
    const res = await API.updatePermissions(newPermsMap);
    if (res && res.success !== false) {
      showAdminToast('تم حفظ صلاحيات الأدوار بنجاح');
      // Reload matrix or reload window
      location.reload();
    } else {
      showAdminToast(res?.message || 'فشل حفظ الصلاحيات', 'error');
    }
  } catch (err) {
    showAdminToast('حدث خطأ أثناء الاتصال بالخادم', 'error');
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
    if (window.lucide) lucide.createIcons();
  }
}

// ===== Accounting Settings Integration =====
let accountingSettingsAccounts = [];
let currentAccountingSettings = {
  defaultCashAccountId: null,
  defaultBankAccountId: null,
  defaultSalesAccountId: null,
  defaultPurchasesAccountId: null,
  defaultInventoryAccountId: null,
  defaultCOGSAccountId: null
};

async function loadAccountingSettingsData() {
  const loadingEl = $a('accounting-settings-loading');
  
  try {
    if (loadingEl) loadingEl.style.display = 'block';

    // Fetch accounts
    const accountsRes = await fetchWithStability('/api/accounting/accounts');
    if (accountsRes.success) {
      accountingSettingsAccounts = accountsRes.data || [];
    } else {
      accountingSettingsAccounts = Array.isArray(accountsRes) ? accountsRes : [];
    }

    // Fetch current settings
    const settingsRes = await fetchWithStability('/api/accounting/settings');
    if (settingsRes.success) {
      currentAccountingSettings = settingsRes.data || currentAccountingSettings;
    } else {
      currentAccountingSettings = settingsRes;
    }

    // Populate dropdowns
    populateAccountingSettingsDropdowns();

    if (loadingEl) loadingEl.style.display = 'none';
  } catch (error) {
    console.error('Error loading accounting settings data:', error);
    showAdminToast('فشل تحميل بيانات الإعدادات', 'error');
    if (loadingEl) loadingEl.style.display = 'none';
  }
}

function populateAccountingSettingsDropdowns() {
  // Format accounts for display: accountCode - accountName
  const accountOptions = accountingSettingsAccounts.map(acc => ({
    id: acc.id,
    label: `${acc.accountCode} - ${acc.accountName}`
  }));

  const selectIds = [
    'acs-cash-account',
    'acs-bank-account',
    'acs-sales-account',
    'acs-purchases-account',
    'acs-inventory-account',
    'acs-cogs-account'
  ];

  const settingKeys = [
    'defaultCashAccountId',
    'defaultBankAccountId',
    'defaultSalesAccountId',
    'defaultPurchasesAccountId',
    'defaultInventoryAccountId',
    'defaultCOGSAccountId'
  ];

  selectIds.forEach((selectId, idx) => {
    const select = $a(selectId);
    if (!select) return;

    // Clear and rebuild options
    select.innerHTML = '<option value="">-- اختر حساب --</option>';
    
    accountOptions.forEach(acc => {
      const option = document.createElement('option');
      option.value = acc.id;
      option.textContent = acc.label;
      select.appendChild(option);
    });

    // Set current value
    const settingKey = settingKeys[idx];
    const currentValue = currentAccountingSettings[settingKey];
    if (currentValue) {
      select.value = currentValue;
    }
  });
}

async function openAccountingSettingsModal() {
  withLock('accounting-settings-open', async () => {
    try {
      await loadAccountingSettingsData();
      $a('accounting-settings-modal').classList.add('open');
      if (window.lucide) lucide.createIcons();
    } catch (error) {
      console.error('Error opening accounting settings modal:', error);
      showAdminToast('فشل فتح إعدادات المحاسبة', 'error');
    }
  });
}

async function saveAccountingSettings(btnElement) {
  withLock('accounting-settings-save', async () => {
    let originalHtml = '';
    try {
      const payload = {
        defaultCashAccountId: $a('acs-cash-account').value || null,
        defaultBankAccountId: $a('acs-bank-account').value || null,
        defaultSalesAccountId: $a('acs-sales-account').value || null,
        defaultPurchasesAccountId: $a('acs-purchases-account').value || null,
        defaultInventoryAccountId: $a('acs-inventory-account').value || null,
        defaultCOGSAccountId: $a('acs-cogs-account').value || null
      };

      originalHtml = btnElement.innerHTML;
      btnElement.classList.add('btn-loading');
      btnElement.innerHTML = '<i data-lucide="loader" style="width:14px;height:14px;vertical-align:middle;margin-left:4px;animation:spin 1s linear infinite"></i> جاري الحفظ...';

      const response = await fetchWithStability('/api/accounting/settings', {
        method: 'PATCH',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.success !== false) {
        currentAccountingSettings = response.data || response;
        showAdminToast('تم حفظ إعدادات المحاسبة بنجاح');
        closeModal('accounting-settings-modal');
      } else {
        showAdminToast(response.message || 'فشل حفظ الإعدادات', 'error');
      }
    } catch (error) {
      console.error('Error saving accounting settings:', error);
      showAdminToast('حدث خطأ أثناء حفظ الإعدادات', 'error');
    } finally {
      btnElement.classList.remove('btn-loading');
      if (originalHtml) btnElement.innerHTML = originalHtml;
      if (window.lucide) lucide.createIcons();
    }
  });
}
