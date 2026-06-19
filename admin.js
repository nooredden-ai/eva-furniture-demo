// admin.js - Admin Panel Logic with API integration (Production-Ready)

const STORE_ID = 'loulo-beauty';
let currentAdminPage = 'dashboard';
let editingProduct = null;
let editingCategory = null;
let productsCache = [];
let imageMarkedForRemoval = false; // Tracks if the user clicked "Remove" in edit mode
let directSaleLog = []; // Track direct sales for UI display
let stockReceiptsLog = []; // Track stock receipts for UI display
let _receiptsCache = []; // Cache for receipt vouchers
let _expensesCache = []; // Cache for expense vouchers
let _activeAccTab = 'summary'; // Active accounting tab
let storePlan = null; // Track active modules plan for this store

// ===== UX Simplification (Merchant Dashboard) =====
let isSimplifiedMode = false;

function determineSimplifiedMode() {
  const s = Auth.getSession();
  return s && s.role !== 'super_admin';
}

function applySimplifiedUI() {
  isSimplifiedMode = determineSimplifiedMode();
  const nA = $a('sidebar-nav-advanced');
  const nS = $a('sidebar-nav-simple');
  const dA = $a('admin-dashboard-advanced');
  const dS = $a('admin-dashboard-simple');
  if (nA) nA.style.display = isSimplifiedMode ? 'none' : '';
  if (nS) nS.style.display = isSimplifiedMode ? '' : 'none';
  if (dA) dA.style.display = isSimplifiedMode ? 'none' : '';
  if (dS) dS.style.display = isSimplifiedMode ? '' : 'none';
}

function toggleSimplifiedMode() {
  if (!Auth.isSuperAdmin()) return;
  isSimplifiedMode = !isSimplifiedMode;
  applySimplifiedUI();
  if (currentAdminPage === 'dashboard') navigateTo('dashboard');
  const bt = $a('toggle-simplified-text');
  if (bt) bt.textContent = isSimplifiedMode ? 'عرض متقدم' : 'عرض مبسط';
}

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
  if (page === 'store-plan' && !Auth.isSuperAdmin()) {
    page = 'access-denied';
  }

  const modulePageMap = {
    'products': 'products',
    'categories': 'categories',
    'orders': 'orders',
    'direct-sale': 'directSales',
    'stock-receiving': 'stockReceiving',
    'users': 'users',
    'accounting': 'accounting',
    'coupons': 'coupons',
    'settings': 'settings'
  };

  const moduleName = modulePageMap[page];
  if (moduleName && window.storePlan && window.storePlan.modules && window.storePlan.modules[moduleName] === false) {
    if (Auth.isSuperAdmin()) {
      page = 'module-disabled';
    } else {
      page = 'access-denied';
    }
  }

  const pagesPermissions = {
    dashboard: 'view_dashboard',
    products: 'view_products',
    categories: 'view_categories',
    orders: 'view_orders',
    'direct-sale': 'update_orders',
    invoices: 'view_orders',
    users: 'view_users',
    coupons: 'view_coupons',
    settings: 'view_settings'
  };
  
  const requiredPerm = pagesPermissions[page];
  if (requiredPerm && !Auth.can(requiredPerm)) {
    page = 'access-denied';
  }

  currentAdminPage = page;
  // Show the correct dashboard version without extra fetch
  if (page === 'dashboard') {
    const dA = $a('admin-dashboard-advanced');
    const dS = $a('admin-dashboard-simple');
    if (isSimplifiedMode) { if (dA) dA.style.display = 'none'; if (dS) dS.style.display = ''; }
    else                 { if (dA) dA.style.display = ''; if (dS) dS.style.display = 'none'; }
  }
  document.querySelectorAll('.admin-page').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  let pageEl;
  if (page === 'dashboard') {
    pageEl = isSimplifiedMode ? $a('admin-dashboard-simple') : $a('admin-dashboard-advanced');
  } else {
    pageEl = $a('admin-' + page);
  }
  const navEl  = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (pageEl) pageEl.classList.add('active');
  if (navEl)  navEl.classList.add('active');
  refreshPage(page);
}

function refreshPage(page) {
  const titles = {
    dashboard:  isSimplifiedMode ? 'الرئيسية' : 'لوحة المعلومات',
    products:   'المنتجات',
    categories: 'التصنيفات',
    orders:     'الطلبات',
    'direct-sale': 'بيع مباشر',
    invoices:    'الفواتير',
    users:      'المستخدمين',
    accounting: 'المالية',
    coupons:    'الكوبونات',
    settings:   'المتجر',
    'store-plan': 'إدارة خطة المتجر',
    'module-disabled': 'ميزة غير مفعلة',
    'access-denied': 'وصول مرفوض'
  };
  const titleIcons = {
    dashboard: isSimplifiedMode ? 'home' : 'bar-chart',
    products: 'package', categories: 'tag',
    orders: 'receipt', 'direct-sale': 'shopping-cart', invoices: 'file-text', users: 'users', accounting: 'credit-card', coupons: 'gift', settings: 'settings',
    'store-plan': 'shield-check', 'module-disabled': 'lock',
    'access-denied': 'shield-alert'
  };
  const titleEl = $a('topbar-title');
  if (titleEl) {
    titleEl.innerHTML = `<i data-lucide="${titleIcons[page] || 'layout'}" style="width:20px;height:20px;vertical-align:middle;margin-left:8px"></i>${titles[page] || ''}`;
    if (window.lucide) lucide.createIcons();
  }
  // Force-refresh data from server on navigation (except dashboard — uses appState caching)
  if (window.appState) {
    if (page === 'products')   { appState.products = null; appState.categories = null; }
    if (page === 'categories') { appState.categories = null; }
    if (page === 'orders')     { appState.orders = null; }
    if (page === 'direct-sale') { appState.products = null; }
    if (page === 'stock-receiving') { appState.products = null; }
    if (page === 'users')      { appState.users = null; }
    if (page === 'settings')   { appState.settings = null; appState.countries = null; }
    if (page === 'invoices')   { appState.invoices = null; }
  }
  if (page === 'dashboard') { if (isSimplifiedMode) renderMerchantDashboard(); else renderDashboard(); }
  else if (page === 'products')   renderProductsTable();
  else if (page === 'categories') renderCategoriesPage();
  else if (page === 'orders')     renderOrdersTable();
  else if (page === 'direct-sale') initDirectSale();
  else if (page === 'stock-receiving') initStockReceiving();
  else if (page === 'users')      renderUsersTable();
  else if (page === 'accounting') renderAccountingPage();
  else if (page === 'coupons')    renderCouponsTable();
  else if (page === 'settings')   initSettingsPage();
  else if (page === 'store-plan') initStorePlanPage();
  else if (page === 'invoices')   loadInvoices();
}

function toggleAdvancedTools() {
  const el = $a('advanced-tools');
  if (!el) return;
  if (el.style.display === 'none' || el.style.display === '') {
    el.style.display = 'flex';
  } else {
    el.style.display = 'none';
  }
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

async function renderAccountingPage() {
  const currentDate = $a('fin-current-date');
  const lastUpdate = $a('fin-last-update');
  const now = new Date();
  if (currentDate) {
    currentDate.textContent = now.toLocaleDateString('ar-EG', {
      day: 'numeric', month: 'long', year: 'numeric'
    });
  }
  if (lastUpdate) {
    lastUpdate.textContent = 'تحميل...';
  }

  try {
    const data = await fetchWithStability('/api/accounting/financial-summary');
    if (!data || data.success === false) {
      showAdminToast(data?.message || 'فشل تحميل الخلاصة المالية', 'error');
      if (lastUpdate) lastUpdate.textContent = 'خطأ';
      return;
    }

    if (lastUpdate) {
      lastUpdate.textContent = 'قبل لحظات';
    }

    // Populate KPIs
    if ($a('fin-kpi-inventory-value')) {
      $a('fin-kpi-inventory-value').textContent = (data.inventoryValue || 0).toLocaleString('ar-SA') + ' ₪';
    }
    if ($a('fin-kpi-current-capital')) {
      $a('fin-kpi-current-capital').textContent = (data.currentCapital || 0).toLocaleString('ar-SA') + ' ₪';
    }
    if ($a('fin-kpi-today-sales')) {
      $a('fin-kpi-today-sales').textContent = (data.todaySales || 0).toLocaleString('ar-SA') + ' ₪';
    }
    if ($a('fin-kpi-monthly-sales')) {
      $a('fin-kpi-monthly-sales').textContent = (data.monthlySales || 0).toLocaleString('ar-SA') + ' ₪';
    }
    if ($a('fin-kpi-operations-count')) {
      $a('fin-kpi-operations-count').textContent = (data.operationsCount || 0).toLocaleString('ar-SA');
    }

    // Financial KPIs
    if ($a('fin-kpi-total-receipts')) {
      $a('fin-kpi-total-receipts').textContent = (data.totalReceipts || 0).toLocaleString('ar-SA') + ' ₪';
    }
    if ($a('fin-kpi-total-expenses')) {
      $a('fin-kpi-total-expenses').textContent = (data.totalExpenses || 0).toLocaleString('ar-SA') + ' ₪';
    }
    if ($a('fin-kpi-net-balance')) {
      const nb = (data.netBalance || 0);
      $a('fin-kpi-net-balance').textContent = nb.toLocaleString('ar-SA') + ' ₪';
      $a('fin-kpi-net-balance').style.color = nb >= 0 ? 'var(--admin-success)' : 'var(--admin-danger)';
    }
    if ($a('fin-kpi-outstanding')) {
      $a('fin-kpi-outstanding').textContent = (data.outstandingBalances || 0).toLocaleString('ar-SA') + ' ₪';
    }

    const profitValEl = $a('fin-kpi-monthly-profit');
    const profitLabelEl = $a('fin-label-monthly-profit');
    if (profitValEl) {
      profitValEl.textContent = (data.monthlyProfit || 0).toLocaleString('ar-SA') + ' ₪';
    }
    if (profitLabelEl) {
      if (data.isMonthlyProfitEstimated) {
        profitLabelEl.innerHTML = 'ربح الشهر <span class="badge-estimate">تقديري</span>';
      } else {
        profitLabelEl.innerHTML = 'ربح الشهر <span class="badge-status" data-status="completed">نهائي</span>';
      }
    }

    // Populate Financial Summary Bar
    if ($a('fin-summary-total-sales')) {
      $a('fin-summary-total-sales').textContent = (data.allTime?.totalSales || 0).toLocaleString('ar-SA') + ' ₪';
    }
    if ($a('fin-summary-total-cogs')) {
      $a('fin-summary-total-cogs').textContent = (data.allTime?.totalCOGS || 0).toLocaleString('ar-SA') + ' ₪';
    }
    if ($a('fin-summary-total-pieces')) {
      $a('fin-summary-total-pieces').textContent = (data.allTime?.totalPiecesSold || 0).toLocaleString('ar-SA');
    }

    const totalProfitValEl = $a('fin-summary-total-profit');
    const totalProfitLabelEl = $a('fin-label-total-profit');
    if (totalProfitValEl) {
      totalProfitValEl.textContent = (data.allTime?.totalProfit || 0).toLocaleString('ar-SA') + ' ₪';
    }
    if (totalProfitLabelEl) {
      if (data.allTime?.isTotalProfitEstimated) {
        totalProfitLabelEl.innerHTML = 'إجمالي الأرباح <span class="badge-estimate">تقديري</span>';
      } else {
        totalProfitLabelEl.innerHTML = 'إجمالي الأرباح <span class="badge-status" data-status="completed">نهائي</span>';
      }
    }

    // Populate Best Sellers
    const bestSellersBody = $a('fin-best-sellers-body');
    if (bestSellersBody) {
      if (data.bestSellers && data.bestSellers.length > 0) {
        bestSellersBody.innerHTML = data.bestSellers.map(p => {
          const profitLabel = p.isProfitEstimated ?
            `${p.totalProfit.toLocaleString('ar-SA')} ₪ <span class="badge-estimate">تقديري</span>` :
            `${p.totalProfit.toLocaleString('ar-SA')} ₪`;
          return `
            <tr>
              <td><strong>${escapeHtml(p.name)}</strong></td>
              <td>${p.quantitySold.toLocaleString('ar-SA')}</td>
              <td>${p.totalSales.toLocaleString('ar-SA')} ₪</td>
              <td>${profitLabel}</td>
            </tr>
          `;
        }).join('');
      } else {
        bestSellersBody.innerHTML = `<tr><td colspan="4" style="text-align:center;">لا توجد مبيعات مسجلة بعد.</td></tr>`;
      }
    }

    // Populate Low Stock
    const lowStockList = $a('fin-low-stock-list');
    if (lowStockList) {
      if (data.lowStock && data.lowStock.length > 0) {
        lowStockList.innerHTML = data.lowStock.map(p => `
          <div class="low-stock-item">
            <span>${escapeHtml(p.name)}</span>
            <strong>المخزون: ${p.stock}</strong>
          </div>
        `).join('');
      } else {
        lowStockList.innerHTML = `<div style="text-align:center;color:var(--admin-text2);padding:10px;">كل المنتجات بمخزون جيد.</div>`;
      }
    }

    // Populate Recent Sales
    const recentSalesBody = $a('fin-recent-sales-body');
    if (recentSalesBody) {
      if (data.recentSales && data.recentSales.length > 0) {
        recentSalesBody.innerHTML = data.recentSales.map(s => {
          const typeBadge = s.type === 'online' ?
            `<span class="badge-online">متجر إلكتروني</span>` :
            `<span class="badge-direct">بيع مباشر</span>`;
          
          let statusText = s.status;
          if (s.status === 'completed') statusText = 'مكتمل';
          else if (s.status === 'cancelled') statusText = 'ملغى';
          else if (s.status === 'pending') statusText = 'قيد الانتظار';
          else if (s.status === 'confirmed') statusText = 'مؤكد';
          else if (s.status === 'shipped') statusText = 'مشحون';
          else if (s.status === 'delivered') statusText = 'تم التسليم';

          const statusBadge = `<span class="badge-status" data-status="${s.status}">${statusText}</span>`;
          
          let formattedDate = '';
          try {
            formattedDate = new Date(s.createdAt).toLocaleDateString('ar-EG', {
              day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
            });
          } catch(e) {
            formattedDate = s.createdAt || '';
          }

          return `
            <tr>
              <td>#${s.orderNumber || s.id}</td>
              <td>${typeBadge}</td>
              <td>${escapeHtml(s.customerName)}</td>
              <td><strong>${s.total.toLocaleString('ar-SA')} ₪</strong></td>
              <td>${formattedDate}</td>
              <td>${statusBadge}</td>
            </tr>
          `;
        }).join('');
      } else {
        recentSalesBody.innerHTML = `<tr><td colspan="6" style="text-align:center;">لا توجد عمليات مبيعات مسجلة مؤخراً.</td></tr>`;
      }
    }

    // Load aging report after KPIs
    loadAgingReport();

    if (window.lucide) lucide.createIcons();

  } catch (error) {
    console.error('Error rendering accounting page:', error);
    if (lastUpdate) lastUpdate.textContent = 'خطأ اتصال';
    showAdminToast('خطأ في الاتصال بالخادم عند تحميل الصفحة المالية', 'error');
  }
}

function showAccountingHome() {
  renderAccountingPage();
}

// ===== Accounting Tab Switching =====
function switchAccTab(tab) {
  _activeAccTab = tab;
  ['summary', 'receipts', 'expenses', 'cheques', 'customers'].forEach(t => {
    const btn = $a('acc-tab-' + t);
    if (btn) {
      if (t === tab) { btn.className = 'topbar-btn btn-primary'; btn.style.fontSize = '0.85rem'; }
      else { btn.className = 'topbar-btn btn-outline'; btn.style.fontSize = '0.85rem'; }
    }
    const panel = $a('acc-panel-' + t);
    if (panel) panel.style.display = t === tab ? 'block' : 'none';
  });
  if (tab === 'receipts') loadReceiptsSection();
  if (tab === 'expenses') loadExpensesSection();
  if (tab === 'cheques') loadChequesSection();
  if (tab === 'customers') loadCustomersSection();
}

// ===== Customer Summaries Section =====
async function loadCustomersSection() {
  const tbody = $a('customers-table-body');
  const emptyState = $a('customers-empty-state');
  if (tbody) tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:20px;">جاري التحميل...</td></tr>';
  try {
    const res = await fetchWithStability('/api/accounting/customer-summaries?includeNotes=true');
    if (!res.success) { showAdminToast(res.message || 'فشل تحميل العملاء', 'error'); renderCustomersSection([]); return; }
    renderCustomersSection(res.data || []);
  } catch (err) {
    console.error('Error loading customers:', err);
    showAdminToast('فشل تحميل العملاء', 'error');
    renderCustomersSection([]);
  }
}

function getCustomerKeyStr(name, phone) {
  const n = (name || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const p = (phone || '').trim().replace(/[^0-9]/g, '');
  return p ? n + '|' + p : n;
}

function isCustomerInactive(c, days) {
  days = days || 60;
  const now = new Date();
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const lastInvoice = c.lastInvoice ? new Date(c.lastInvoice) : null;
  const lastReceipt = c.lastReceipt ? new Date(c.lastReceipt) : null;
  const mostRecent = lastInvoice && lastReceipt ? (lastInvoice > lastReceipt ? lastInvoice : lastReceipt) : (lastInvoice || lastReceipt);
  return !mostRecent || mostRecent < cutoff;
}

function renderCustomersSection(customers) {
  const tbody = $a('customers-table-body');
  const emptyState = $a('customers-empty-state');
  if (!tbody) return;
  if (!customers || !customers.length) {
    tbody.innerHTML = '';
    if (emptyState) emptyState.style.display = 'block';
    return;
  }
  if (emptyState) emptyState.style.display = 'none';

  const statusColors = {
    'VIP': 'badge-success',
    'مدين': 'badge-danger',
    'جديد': 'badge-info',
    'خامل': 'badge-warning',
    'عادي': 'badge-status'
  };

  _customerCache = customers;

  const activityFilter = ($a('customer-activity-filter')?.value) || 'all';

  const filtered = customers.filter(c => {
    if (activityFilter === 'active') return !isCustomerInactive(c, 60);
    if (activityFilter === 'inactive') return isCustomerInactive(c, 60);
    return true;
  });

  tbody.innerHTML = filtered.map(c => {
    const lastInvoice = c.lastInvoice ? new Date(c.lastInvoice).toLocaleDateString('ar-EG') : '—';
    const statusBadge = `<span class="status-badge ${statusColors[c.status] || 'badge-status'}">${c.status}</span>`;
    const tags = (c.tags || []).map(t => `<span style="display:inline-block;padding:1px 8px;border-radius:9999px;font-size:0.7rem;background:var(--admin-primary);color:#fff;margin:1px">${escapeHtml(t)}</span>`).join('') || '<span style="color:var(--admin-text2);font-size:0.75rem">—</span>';
    const key = getCustomerKeyStr(c.name, c.phone);
    const encName = escapeHtml(c.name);
    const encPhone = escapeHtml(c.phone || '');
    return `<tr>
      <td style="font-weight:600">${encName}</td>
      <td>${encPhone || '—'}</td>
      <td>${(c.totalPurchases || 0).toLocaleString('ar-SA')} ₪</td>
      <td>${(c.totalPaid || 0).toLocaleString('ar-SA')} ₪</td>
      <td style="font-weight:600;color:${(c.balance || 0) > 0 ? 'var(--admin-danger)' : 'var(--admin-success)'}">${(c.balance || 0).toLocaleString('ar-SA')} ₪</td>
      <td>${c.invoiceCount || 0}</td>
      <td style="font-size:0.8rem">${lastInvoice}</td>
      <td>${statusBadge}</td>
      <td style="font-size:0.75rem">${tags}</td>
      <td><button class="topbar-btn btn-outline btn-sm" onclick="openCustomerProfile('${encName}', '${encPhone}')"><i data-lucide="user" style="width:12px;height:12px;vertical-align:middle;margin-left:2px"></i> ملف</button></td>
    </tr>`;
  }).join('');
  if (window.lucide) lucide.createIcons();
}

let _customerCache = [];

function filterCustomersTable() {
  const query = ($a('customer-search-input')?.value || '').toLowerCase().trim();
  if (!_customerCache || !_customerCache.length) return;
  const filtered = _customerCache.filter(c => {
    const matchesSearch = !query ||
      (c.name || '').toLowerCase().includes(query) ||
      (c.phone || '').toLowerCase().includes(query);
    return matchesSearch;
  });
  renderCustomersSection(filtered);
}

// ===== Customer Profile Modal (CRM Lite) =====
let _profileCustomerName = '';
let _profileCustomerPhone = '';
let _profileNotes = [];

const CRM_TAGS = ['VIP', 'عادي', 'تاجر جملة', 'يحتاج متابعة', 'متأخر بالسداد'];

async function openCustomerProfile(name, phone) {
  _profileCustomerName = name;
  _profileCustomerPhone = phone;
  _profileNotes = [];

  try {
    // Load statement
    const stmtRes = await fetchWithStability('/api/accounting/customer-statement?name=' + encodeURIComponent(name) + '&phone=' + encodeURIComponent(phone || ''));
    const statementData = stmtRes.success ? stmtRes.data : { entries: [], summary: {} };
    const { entries, summary } = statementData;

    // Load CRM notes
    const key = getCustomerKeyStr(name, phone);
    const notesRes = await fetchWithStability('/api/accounting/customer-notes?key=' + encodeURIComponent(key));
    const crmData = notesRes.success && notesRes.data ? notesRes.data : null;
    _profileNotes = (crmData && crmData.notes) || [];

    // Set title
    $a('customer-statement-title').innerHTML = '<i data-lucide="user" style="width:18px;height:18px;vertical-align:middle;margin-left:6px"></i> ' + escapeHtml(name);

    // Profile header
    $a('cs-customer-name').textContent = name;
    const phoneEl = $a('cs-customer-phone');
    phoneEl.textContent = phone || '(لا يوجد رقم)';

    // WhatsApp button
    const waBtn = $a('cs-whatsapp-btn');
    const digits = (phone || '').replace(/[^0-9]/g, '');
    if (digits) {
      waBtn.href = 'https://wa.me/' + digits;
      waBtn.style.display = 'inline-flex';
    } else {
      waBtn.style.display = 'none';
    }

    // Financial summary
    if ($a('cs-total-purchases')) $a('cs-total-purchases').textContent = (summary.totalPurchases || 0).toLocaleString('ar-SA') + ' ₪';
    if ($a('cs-total-paid')) $a('cs-total-paid').textContent = (summary.totalPaid || 0).toLocaleString('ar-SA') + ' ₪';
    if ($a('cs-balance')) {
      const bal = summary.balance || 0;
      $a('cs-balance').textContent = bal.toLocaleString('ar-SA') + ' ₪';
      $a('cs-balance').style.color = bal > 0 ? 'var(--admin-danger)' : 'var(--admin-success)';
    }
    if ($a('cs-invoice-count')) $a('cs-invoice-count').textContent = summary.invoiceCount || 0;
    if ($a('cs-last-invoice')) {
      $a('cs-last-invoice').textContent = summary.lastInvoice ? new Date(summary.lastInvoice).toLocaleDateString('ar-EG') : '—';
    }
    if ($a('cs-status-badge')) {
      const statusColors = { 'VIP': 'badge-success', 'مدين': 'badge-danger', 'جديد': 'badge-info', 'خامل': 'badge-warning', 'عادي': 'badge-status' };
      $a('cs-status-badge').innerHTML = '<span class="status-badge ' + (statusColors[summary.status] || 'badge-status') + '">' + (summary.status || '—') + '</span>';
    }

    // Tags
    renderProfileTags(crmData ? (crmData.tags || []) : []);

    // Notes
    renderProfileNotes();

    // Last contact
    const contactEl = $a('cs-last-contact-display');
    if (crmData && crmData.lastContactAt) {
      const dt = new Date(crmData.lastContactAt).toLocaleString('ar-EG');
      const note = crmData.lastContactNote ? ' — ' + escapeHtml(crmData.lastContactNote) : '';
      contactEl.innerHTML = '<span style="color:var(--admin-text)">' + dt + '</span>' + note;
    } else {
      contactEl.textContent = 'لم يتم تسجيل أي تواصل بعد';
    }

    // Statement entries
    const tbody = $a('customer-statement-body');
    if (!tbody) return;

    if (!entries || !entries.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:20px;">لا توجد حركات مالية لهذا العميل</td></tr>';
    } else {
      tbody.innerHTML = entries.map(e => {
        const dateStr = e.date ? new Date(e.date).toLocaleDateString('ar-EG') : '—';
        const ref = escapeHtml(e.reference || '—');
        const debit = e.debit ? e.debit.toLocaleString('ar-SA') + ' ₪' : '—';
        const credit = e.credit ? e.credit.toLocaleString('ar-SA') + ' ₪' : '—';
        const balance = (e.balance !== undefined) ? e.balance.toLocaleString('ar-SA') + ' ₪' : '—';
        const note = e.note ? escapeHtml(e.note) : '';
        const typeText = e.type === 'فاتورة' ? '<span style="color:var(--admin-danger)">فاتورة</span>' : '<span style="color:var(--admin-success)">سند قبض</span>';
        return `<tr>
          <td style="font-size:0.75rem">${dateStr}</td>
          <td>${typeText}</td>
          <td style="font-size:0.75rem;font-family:monospace">${ref}</td>
          <td style="color:var(--admin-danger)">${debit}</td>
          <td style="color:var(--admin-success)">${credit}</td>
          <td style="font-weight:600">${balance}</td>
          <td style="font-size:0.75rem;color:var(--admin-text2)">${note}</td>
        </tr>`;
      }).join('');
    }

    openModal('customer-statement-modal');
    if (window.lucide) lucide.createIcons();
  } catch (err) {
    console.error('Error loading customer profile:', err);
    showAdminToast('فشل تحميل ملف العميل', 'error');
  }
}

function renderProfileTags(tags) {
  const container = $a('cs-tags-container');
  if (!container) return;

  const available = CRM_TAGS.filter(t => !tags.includes(t));

  container.innerHTML = tags.map(t => {
    const colorMap = { 'VIP': '#16a34a', 'عادي': '#64748b', 'تاجر جملة': '#2563eb', 'يحتاج متابعة': '#d97706', 'متأخر بالسداد': '#dc2626' };
    const bg = colorMap[t] || '#64748b';
    return '<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 10px;border-radius:9999px;font-size:0.75rem;background:' + bg + ';color:#fff;cursor:pointer" onclick="removeCustomerTag(\'' + escapeHtml(t) + '\')">' + escapeHtml(t) + ' <span style="font-size:0.7rem;opacity:0.7">✕</span></span>';
  }).join('');

  if (available.length) {
    const sel = '<select id="cs-add-tag-select" onchange="addCustomerTag(this)" style="padding:2px 8px;border:1px solid var(--admin-border);border-radius:6px;font-size:0.75rem;background:var(--admin-bg);color:var(--admin-text);"><option value="">+ إضافة وسم</option>' + available.map(t => '<option value="' + escapeHtml(t) + '">' + escapeHtml(t) + '</option>').join('') + '</select>';
    container.innerHTML += sel;
  }
}

async function addCustomerTag(sel) {
  if (!sel || !sel.value) return;
  const tag = sel.value;
  sel.value = '';
  const currentTags = [];
  document.querySelectorAll('#cs-tags-container > span').forEach(el => {
    const txt = el.textContent.replace('✕', '').trim();
    if (txt) currentTags.push(txt);
  });
  if (!currentTags.includes(tag)) currentTags.push(tag);
  renderProfileTags(currentTags);
  await saveCustomerNotes({ tags: currentTags });
}

async function removeCustomerTag(tag) {
  const currentTags = [];
  document.querySelectorAll('#cs-tags-container > span').forEach(el => {
    const txt = el.textContent.replace('✕', '').trim();
    if (txt && txt !== tag) currentTags.push(txt);
  });
  renderProfileTags(currentTags);
  await saveCustomerNotes({ tags: currentTags });
}

async function addCustomerNote() {
  const input = $a('cs-new-note-input');
  if (!input || !input.value.trim()) return;
  const text = input.value.trim();
  input.value = '';

  _profileNotes.push({ text, createdAt: new Date().toISOString(), author: 'admin' });
  renderProfileNotes();
  await saveCustomerNotes({ notes: _profileNotes });
}

function renderProfileNotes() {
  const list = $a('cs-notes-list');
  if (!list) return;
  if (!_profileNotes || !_profileNotes.length) {
    list.innerHTML = '<div style="color:var(--admin-text2);font-size:0.85rem;padding:8px 0;">لا توجد ملاحظات</div>';
    return;
  }
  list.innerHTML = _profileNotes.slice().reverse().map(n => {
    const dt = n.createdAt ? new Date(n.createdAt).toLocaleString('ar-EG') : '';
    return '<div style="padding:6px 0;border-bottom:1px solid var(--admin-border);font-size:0.85rem;">' +
      '<div>' + escapeHtml(n.text) + '</div>' +
      '<div style="font-size:0.7rem;color:var(--admin-text2);">' + dt + (n.author ? ' — ' + escapeHtml(n.author) : '') + '</div>' +
    '</div>';
  }).join('');
}

async function recordContact() {
  const input = $a('cs-contact-note-input');
  const note = input ? input.value.trim() : '';
  if (input) input.value = '';
  const now = new Date().toISOString();

  const contactEl = $a('cs-last-contact-display');
  if (contactEl) {
    contactEl.innerHTML = '<span style="color:var(--admin-text)">' + new Date().toLocaleString('ar-EG') + '</span>' + (note ? ' — ' + escapeHtml(note) : '');
  }

  await saveCustomerNotes({ lastContactAt: now, lastContactNote: note });
}

async function saveCustomerNotes(updates) {
  const key = getCustomerKeyStr(_profileCustomerName, _profileCustomerPhone);
  try {
    const body = {
      key,
      name: _profileCustomerName,
      phone: _profileCustomerPhone,
      notes: updates.notes !== undefined ? updates.notes : _profileNotes,
      tags: updates.tags || [],
      lastContactAt: updates.lastContactAt || null,
      lastContactNote: updates.lastContactNote || null
    };
    // Fetch existing to preserve fields not being updated
    if (updates.tags && !updates.notes) {
      const existingRes = await fetchWithStability('/api/accounting/customer-notes?key=' + encodeURIComponent(key));
      if (existingRes.success && existingRes.data) {
        body.notes = existingRes.data.notes || [];
        body.lastContactAt = existingRes.data.lastContactAt || null;
        body.lastContactNote = existingRes.data.lastContactNote || null;
      }
    }
    if (updates.lastContactAt && !updates.tags && !updates.notes) {
      const existingRes = await fetchWithStability('/api/accounting/customer-notes?key=' + encodeURIComponent(key));
      if (existingRes.success && existingRes.data) {
        body.notes = existingRes.data.notes || [];
        body.tags = existingRes.data.tags || [];
      }
    }

    await fetchWithStability('/api/accounting/customer-notes', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  } catch (err) {
    console.error('Error saving customer notes:', err);
  }
}

function openCrmCustomerModal() {
  $a('crm-customer-name').value = '';
  $a('crm-customer-phone').value = '';
  $a('crm-customer-tag').value = '';
  openModal('crm-customer-modal');
  if (window.lucide) lucide.createIcons();
}

async function saveCrmCustomer(btn) {
  const name = $a('crm-customer-name').value.trim();
  const phone = $a('crm-customer-phone').value.trim();
  const tag = $a('crm-customer-tag').value;

  if (!name) { showAdminToast('الرجاء إدخال اسم العميل', 'error'); return; }

  const key = getCustomerKeyStr(name, phone);
  const originalHtml = btn.innerHTML;
  btn.classList.add('btn-loading');
  btn.innerHTML = 'جاري الحفظ...';

  try {
    const body = {
      key,
      name,
      phone,
      notes: [],
      tags: tag ? [tag] : [],
      lastContactAt: null,
      lastContactNote: null
    };

    const res = await fetchWithStability('/api/accounting/customer-notes', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (res.success) {
      closeModal('crm-customer-modal');
      showAdminToast('تم إضافة العميل بنجاح', 'success');
      loadCustomersSection();
    } else {
      showAdminToast(res.message || 'فشل حفظ العميل', 'error');
    }
  } catch (err) {
    console.error('Error saving CRM customer:', err);
    showAdminToast('فشل حفظ العميل', 'error');
  } finally {
    btn.innerHTML = originalHtml;
    btn.classList.remove('btn-loading');
  }
}

// ===== Aging Report =====
async function loadAgingReport() {
  try {
    const res = await fetchWithStability('/api/accounting/aging-report');
    if (!res.success) return;
    renderAgingReport(res.data || []);
  } catch (err) {
    console.error('Error loading aging report:', err);
  }
}

function renderAgingReport(report) {
  const section = $a('fin-aging-section');
  const tbody = $a('fin-aging-body');
  const empty = $a('fin-aging-empty');
  if (!section || !tbody) return;

  if (!report || !report.length) {
    section.style.display = 'block';
    tbody.innerHTML = '';
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';
  section.style.display = 'block';

  let grandTotal = 0;
  tbody.innerHTML = report.map(r => {
    grandTotal += r.total || 0;
    return `<tr>
      <td style="font-weight:600">${escapeHtml(r.name)}</td>
      <td>${(r['0to30'] || 0).toLocaleString('ar-SA')} ₪</td>
      <td>${(r['31to60'] || 0).toLocaleString('ar-SA')} ₪</td>
      <td>${(r['61to90'] || 0).toLocaleString('ar-SA')} ₪</td>
      <td>${(r['90plus'] || 0).toLocaleString('ar-SA')} ₪</td>
      <td style="font-weight:600">${(r.total || 0).toLocaleString('ar-SA')} ₪</td>
    </tr>`;
  }).join('') + `<tr style="background:var(--admin-bg2);font-weight:700">
    <td>المجموع</td>
    <td>${report.reduce((s, r) => s + (r['0to30'] || 0), 0).toLocaleString('ar-SA')} ₪</td>
    <td>${report.reduce((s, r) => s + (r['31to60'] || 0), 0).toLocaleString('ar-SA')} ₪</td>
    <td>${report.reduce((s, r) => s + (r['61to90'] || 0), 0).toLocaleString('ar-SA')} ₪</td>
    <td>${report.reduce((s, r) => s + (r['90plus'] || 0), 0).toLocaleString('ar-SA')} ₪</td>
    <td>${grandTotal.toLocaleString('ar-SA')} ₪</td>
  </tr>`;
}

// ===== KPI Update Functions =====
async function getAccountingCustomersCount() {
  try {
    const data = await fetchAccountingCustomers('/api/accounting/customers');
    const customers = Array.isArray(data) ? data : (data.data || []);
    return customers.length;
  } catch (error) {
    console.error('Error fetching customers count:', error);
    return 0;
  }
}

async function getAccountingSuppliersCount() {
  try {
    const data = await fetchAccountingCustomers('/api/accounting/suppliers');
    const suppliers = Array.isArray(data) ? data : (data.data || []);
    return suppliers.length;
  } catch (error) {
    console.error('Error fetching suppliers count:', error);
    return 0;
  }
}

async function getAccountingProductsCount() {
  try {
    const products = await API.getProducts();
    const activeProducts = Array.isArray(products) ? products.filter(p => p.active !== false) : [];
    return activeProducts.length;
  } catch (error) {
    console.error('Error fetching products count:', error);
    return 0;
  }
}

async function getLowStockProductsCount() {
  try {
    const products = await API.getProducts();
    const lowStock = Array.isArray(products) ? products.filter(p => p.stock < 10) : [];
    return lowStock.length;
  } catch (error) {
    console.error('Error fetching low stock count:', error);
    return 0;
  }
}

async function getTodaySales() {
  try {
    const orders = await API.getOrders();
    if (!Array.isArray(orders)) return 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayEnd = new Date(today);
    todayEnd.setHours(23, 59, 59, 999);
    
    return orders.reduce((total, order) => {
      const orderDate = new Date(order.date);
      orderDate.setHours(0, 0, 0, 0);
      if (orderDate.getTime() === today.getTime()) {
        return total + (order.total || 0);
      }
      return total;
    }, 0);
  } catch (error) {
    console.error('Error fetching today sales:', error);
    return 0;
  }
}

async function getMonthSales() {
  try {
    const orders = await API.getOrders();
    if (!Array.isArray(orders)) return 0;
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    
    return orders.reduce((total, order) => {
      const orderDate = new Date(order.date);
      if (orderDate.getMonth() === currentMonth && orderDate.getFullYear() === currentYear) {
        return total + (order.total || 0);
      }
      return total;
    }, 0);
  } catch (error) {
    console.error('Error fetching month sales:', error);
    return 0;
  }
}

async function getCompletedOrdersCount() {
  try {
    const orders = await API.getOrders();
    if (!Array.isArray(orders)) return 0;
    return orders.filter(o => o.status === 'delivered').length;
  } catch (error) {
    console.error('Error fetching completed orders:', error);
    return 0;
  }
}

async function getOutOfStockProductsCount() {
  try {
    const products = await API.getProducts();
    if (!Array.isArray(products)) return 0;
    return products.filter(p => Number(p.stock) <= 0).length;
  } catch (error) {
    console.error('Error fetching out of stock products count:', error);
    return 0;
  }
}

async function getProcessingOrdersCount() {
  try {
    const orders = await API.getOrders();
    if (!Array.isArray(orders)) return 0;
    return orders.filter(o => o.status === 'processing').length;
  } catch (error) {
    console.error('Error fetching processing orders count:', error);
    return 0;
  }
}

async function hasNoTodaySales() {
  const todaySales = await getTodaySales();
  return todaySales === 0;
}

async function renderBusinessAlerts() {
  try {
    const [lowStockCount, outOfStockCount, processingOrdersCount, noSalesToday] = await Promise.all([
      getLowStockProductsCount(),
      getOutOfStockProductsCount(),
      getProcessingOrdersCount(),
      hasNoTodaySales()
    ]);

    const container = $a('business-alerts-list');
    if (!container) return;

    const alerts = [
      { label: 'عدد المنتجات منخفضة المخزون', value: lowStockCount },
      { label: 'عدد المنتجات النافدة', value: outOfStockCount },
      { label: 'الطلبات قيد المعالجة', value: processingOrdersCount }
    ];

    if (noSalesToday) {
      alerts.push({ label: 'تنبيه', value: 'لا توجد مبيعات اليوم', isMessage: true });
    }

    container.innerHTML = alerts.map(alert => {
      if (alert.isMessage) {
        return `<div class="quick-list-item"><span>${escapeHtml(alert.label)}</span><strong>${escapeHtml(alert.value)}</strong></div>`;
      }
      return `<div class="quick-list-item"><span>${escapeHtml(alert.label)}</span><strong>${Number(alert.value).toLocaleString('ar-SA')}</strong></div>`;
    }).join('');
  } catch (error) {
    console.error('Error rendering business alerts:', error);
  }
}

async function updateAccountingKPIs() {
  try {
    const customersCount = await getAccountingCustomersCount();
    const suppliersCount = await getAccountingSuppliersCount();
    const productsCount = await getAccountingProductsCount();
    const lowStockCount = await getLowStockProductsCount();
    const todaySales = await getTodaySales();
    const monthSales = await getMonthSales();
    const completedOrders = await getCompletedOrdersCount();
    
    const customersKPI = $a('kpi-customers-count');
    const suppliersKPI = $a('kpi-suppliers-count');
    const productsKPI = $a('kpi-products-count');
    const lowStockKPI = $a('kpi-low-stock-count');
    const todaySalesKPI = $a('kpi-today-sales');
    const monthSalesKPI = $a('kpi-month-sales');
    const completedOrdersKPI = $a('kpi-completed-orders');
    
    if (customersKPI) {
      customersKPI.textContent = customersCount.toLocaleString('ar-SA');
    }
    if (suppliersKPI) {
      suppliersKPI.textContent = suppliersCount.toLocaleString('ar-SA');
    }
    if (productsKPI) {
      productsKPI.textContent = productsCount.toLocaleString('ar-SA');
    }
    if (lowStockKPI) {
      lowStockKPI.textContent = lowStockCount.toLocaleString('ar-SA');
    }
    const directSalesCount = await getDirectSalesCount();
    const directSalesKPI = $a('kpi-direct-sales-count');

    if (todaySalesKPI) {
      todaySalesKPI.textContent = todaySales.toLocaleString('ar-SA') + ' ₪';
    }
    if (monthSalesKPI) {
      monthSalesKPI.textContent = monthSales.toLocaleString('ar-SA') + ' ₪';
    }
    if (completedOrdersKPI) {
      completedOrdersKPI.textContent = completedOrders.toLocaleString('ar-SA');
    }
    if (directSalesKPI) {
      directSalesKPI.textContent = directSalesCount.toLocaleString('ar-SA');
    }
  } catch (error) {
    console.error('Error updating accounting KPIs:', error);
  }
}

async function loadDirectSalesLog() {
  try {
    const response = await fetchWithStability('/api/direct-sales');
    const sales = Array.isArray(response) ? response : Array.isArray(response.data) ? response.data : [];

    directSaleLog = sales
      .slice(-50)
      .reverse()
      .map(sale => ({
        id: sale.id,
        productId: sale.productId,
        productName: sale.productName,
        quantity: sale.quantity,
        listedPrice: sale.listedPrice,
        salePrice: sale.salePrice,
        total: sale.total,
        note: sale.note || '',
        customerName: sale.customerName || '',
        customerPhone: sale.customerPhone || '',
        customerAddress: sale.customerAddress || '',
        saleStatus: sale.saleStatus || 'completed',
        cancelReason: sale.cancelReason || '',
        cancelledAt: sale.cancelledAt || '',
        cancelledBy: sale.cancelledBy || '',
        newStock: null,
        timestamp: new Date(sale.createdAt).toLocaleTimeString('ar-SA'),
        date: new Date(sale.createdAt).toLocaleDateString('ar-SA')
      }));
  } catch (error) {
    console.error('Error loading direct sales log:', error);
    directSaleLog = [];
  }
}

async function getDirectSalesCount() {
  try {
    const response = await fetchWithStability('/api/direct-sales');
    const sales = Array.isArray(response) ? response : Array.isArray(response.data) ? response.data : [];
    return sales.length;
  } catch (error) {
    console.error('Error fetching direct sales count:', error);
    return 0;
  }
}

async function getLowStockProducts() {
  try {
    const products = await API.getProducts();
    const list = Array.isArray(products) ? products.filter(p => p.stock < 10) : [];
    return list.slice(0, 5);
  } catch (error) {
    console.error('Error fetching low stock products:', error);
    return [];
  }
}

async function getRecentOrders() {
  try {
    const orders = await API.getOrders();
    if (!Array.isArray(orders)) return [];
    return orders.slice().sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);
  } catch (error) {
    console.error('Error fetching recent orders:', error);
    return [];
  }
}

function renderLowStockProducts(products) {
  const container = $a('low-stock-products-list');
  if (!container) return;
  if (!products.length) {
    container.innerHTML = '<div class="quick-empty">لا توجد منتجات منخفضة المخزون حالياً</div>';
    return;
  }
  container.innerHTML = products.map(product => {
    const name = escapeHtml(product.name || product.title || 'منتج غير معروف');
    const stock = Number(product.stock || 0).toLocaleString('ar-SA');
    return `<div class="quick-list-item"><span>${name}</span><strong>${stock}</strong></div>`;
  }).join('');
}

function renderRecentOrders(orders) {
  const container = $a('recent-orders-list');
  if (!container) return;
  if (!orders.length) {
    container.innerHTML = '<div class="quick-empty">لا توجد طلبات حالياً</div>';
    return;
  }
  container.innerHTML = orders.map(order => {
    const orderNumber = escapeHtml(order.orderNumber || order.id || '---');
    const total = Number(order.total || 0).toLocaleString('ar-SA') + ' ₪';
    const status = escapeHtml(order.status || 'غير معروف');
    return `<div class="quick-list-item"><span>${orderNumber}</span><strong>${total} • ${status}</strong></div>`;
  }).join('');
}

async function renderQuickBusinessInsights() {
  try {
    const [lowStockProducts, recentOrders] = await Promise.all([getLowStockProducts(), getRecentOrders()]);
    renderLowStockProducts(lowStockProducts);
    renderRecentOrders(recentOrders);
  } catch (error) {
    console.error('Error rendering quick business insights:', error);
  }
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
    ...getAuthHeaders(),
    ...(options.headers || {})
  };
  
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
    ...getAuthHeaders(),
    ...(options.headers || {})
  };
  
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
    ...getAuthHeaders(),
    ...(options.headers || {})
  };
  
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
  const kpiCash = $a('kpi-cash'); if (kpiCash) kpiCash.textContent = '0 ₪';
  const kpiSales = $a('kpi-sales'); if (kpiSales) kpiSales.textContent = '0 ₪';
  const kpiReceiv = $a('kpi-receivables'); if (kpiReceiv) kpiReceiv.textContent = '0 ₪';
  const kpiExp = $a('kpi-expenses'); if (kpiExp) kpiExp.textContent = '0 ₪';
  renderAccountingPage();
});

// ===== Pending Badge =====
async function updatePendingBadge() {
  try {
    const orders = await API.getOrders();
    const pending = (orders || []).filter(o => o.status === 'pending').length;
    const badge = $a('orders-badge');
    if (badge) { badge.textContent = pending; badge.style.display = pending > 0 ? 'inline' : 'none'; }
    const badgeSimple = $a('orders-badge-simple');
    if (badgeSimple) { badgeSimple.textContent = pending; badgeSimple.style.display = pending > 0 ? 'inline' : 'none'; }
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
}

// ===================================================
// ===== RECEIPT & EXPENSE VOUCHER FUNCTIONS =====
// ===================================================

function computeInvoicePaymentStatus(invoice, allReceipts) {
  if (!invoice || invoice.status === 'cancelled') {
    return { paymentStatus: 'cancelled', totalPaid: 0, remaining: 0, badgeClass: 'badge-danger', badgeText: 'ملغاة', receiptCount: 0 };
  }
  const linked = (allReceipts || []).filter(r =>
    r.linkedTo === 'invoice' && String(r.linkedId) === String(invoice.id) && r.status !== 'cancelled'
  );
  const totalPaid = linked.reduce((s, r) => {
    if (!isReceiptCreditable(r)) return s;
    return s + (Number(r.amount) || 0);
  }, 0);
  const total = Number(invoice.total) || 0;
  const remaining = Math.max(0, total - totalPaid);
  let paymentStatus, badgeClass, badgeText;
  if (totalPaid <= 0) {
    paymentStatus = 'unpaid'; badgeClass = 'badge-warning'; badgeText = 'غير مدفوعة';
  } else if (totalPaid >= total) {
    paymentStatus = 'paid'; badgeClass = 'badge-success'; badgeText = 'مدفوعة';
  } else {
    paymentStatus = 'partial'; badgeClass = 'badge-info'; badgeText = 'مدفوعة جزئياً';
  }
  return { paymentStatus, totalPaid, remaining, badgeClass, badgeText, receiptCount: linked.length };
}

function isReceiptCreditable(r) {
  if (r.status === 'cancelled') return false;
  if (r.paymentMethod === 'cheque') {
    if (!r.chequeStatus) return true;
    if (r.chequeStatus !== 'collected') return false;
  }
  return true;
}

function getPaymentMethodText(method) {
  const m = { cash: 'نقداً', cheque: 'شيك', bank_transfer: 'تحويل بنكي', card: 'بطاقة', installment: 'تقسيط' };
  return m[method] || method;
}

function getLinkedToText(linkedTo, linkedId) {
  if (linkedTo === 'none' || !linkedTo) return '—';
  const labels = { invoice: 'فاتورة', order: 'طلب', direct_sale: 'بيع مباشر' };
  return (labels[linkedTo] || linkedTo) + (linkedId ? ' #' + linkedId : '');
}

// ===== Receipt Vouchers =====
async function loadReceiptsSection() {
  try {
    const tbody = $a('receipts-table-body');
    if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:20px;">جاري التحميل...</td></tr>';
    const res = await fetchWithStability('/api/receipts');
    _receiptsCache = (res && res.success && Array.isArray(res.data)) ? res.data : (Array.isArray(res) ? res : []);
    renderReceiptsSection();
  } catch (err) {
    console.error('Error loading receipts:', err);
    showAdminToast('فشل تحميل سندات القبض', 'error');
  }
}

function renderReceiptsSection() {
  const tbody = $a('receipts-table-body');
  const emptyState = $a('receipts-empty-state');
  if (!tbody) return;
  if (!_receiptsCache.length) {
    tbody.innerHTML = '';
    if (emptyState) emptyState.style.display = 'block';
    return;
  }
  if (emptyState) emptyState.style.display = 'none';
  tbody.innerHTML = _receiptsCache.slice().reverse().map(r => {
    const isCancelled = r.status === 'cancelled';
    const rowStyle = isCancelled ? 'opacity:0.5;text-decoration:line-through;' : '';
    const statusBadge = isCancelled
      ? '<span class="status-badge badge-danger" style="font-size:0.75rem">ملغي</span>'
      : '<span class="status-badge badge-success" style="font-size:0.75rem">نشط</span>';
    const actions = isCancelled
      ? '<span style="color:var(--admin-text2);font-size:0.8rem">ملغي</span>'
      : '<div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:center">' +
        '<button class="topbar-btn btn-outline btn-sm" onclick="printReceiptById(\'' + r.id + '\')" style="padding:2px 6px;font-size:0.7rem" title="طباعة"><i data-lucide="printer" style="width:10px;height:10px"></i></button>' +
        '<button class="topbar-btn btn-outline btn-sm" onclick="downloadReceiptPdfById(this,\'' + r.id + '\')" style="padding:2px 6px;font-size:0.7rem" title="PDF"><i data-lucide="file-text" style="width:10px;height:10px"></i></button>' +
        '<button class="topbar-btn btn-outline btn-sm" onclick="openCancelReceipt(\'' + r.id + '\')" style="padding:2px 6px;font-size:0.7rem;color:var(--admin-danger)" title="إلغاء"><i data-lucide="x-circle" style="width:10px;height:10px"></i></button>' +
        '</div>';
    return '<tr style="' + rowStyle + '">' +
      '<td style="padding:8px 12px;font-weight:600">' + (r.voucherNumber || r.id) + '</td>' +
      '<td style="padding:8px 12px">' + (r.date ? new Date(r.date).toLocaleDateString('ar-EG') : '—') + '</td>' +
      '<td style="padding:8px 12px">' + escapeHtml(r.customerName || '—') + '</td>' +
      '<td style="padding:8px 12px;font-weight:600">' + Number(r.amount).toFixed(2) + ' ₪</td>' +
      '<td style="padding:8px 12px">' + getPaymentMethodText(r.paymentMethod) + (r.paymentMethod === 'cheque' && r.chequeStatus ? '<br><span class="status-badge badge-warning" style="font-size:0.65rem;margin-top:2px">' + chequeStatusLabel(r.chequeStatus) + '</span>' : '') + '</td>' +
      '<td style="padding:8px 12px;font-size:0.8rem">' + getLinkedToText(r.linkedTo, r.linkedId) + '</td>' +
      '<td style="padding:8px 12px">' + statusBadge + '</td>' +
      '<td style="padding:8px 12px">' + actions + '</td></tr>';
  }).join('');
  if (window.lucide) lucide.createIcons();
}

function openAddReceipt() {
  _activeReceiptInvoiceId = null;
  $a('receipt-modal-title').innerHTML = '<i data-lucide="arrow-down-circle" style="width:18px;height:18px;vertical-align:middle;margin-left:6px"></i>تسجيل سند قبض جديد';
  $a('receipt-invoice-row').style.display = 'none';
  $a('receipt-customer-row').style.display = '';
  $a('rcpt-linked-id').value = '';
  $a('rcpt-customer').value = '';
  $a('rcpt-amount').value = '';
  $a('rcpt-method').value = 'cash';
  $a('rcpt-reference').value = '';
  $a('rcpt-cheque').value = '';
  $a('rcpt-bank').value = '';
  $a('rcpt-due').value = '';
  $a('rcpt-notes').value = '';
  toggleChequeFields();
  openModal('receipt-modal');
}

let _activeReceiptInvoiceId = null;

function recordInvoicePayment(invoiceId) {
  _activeReceiptInvoiceId = invoiceId;
  const inv = _currentPrintInvoice;
  $a('receipt-modal-title').innerHTML = '<i data-lucide="arrow-down-circle" style="width:18px;height:18px;vertical-align:middle;margin-left:6px"></i>تسديد دفعة للفاتورة ' + invoiceId;
  $a('receipt-invoice-row').style.display = '';
  $a('rcpt-linked-id').value = invoiceId;
  $a('receipt-customer-row').style.display = '';
  $a('rcpt-customer').value = inv && inv.customer ? (inv.customer.name || '') : '';
  $a('rcpt-amount').value = '';
  $a('rcpt-method').value = 'cash';
  $a('rcpt-reference').value = '';
  $a('rcpt-cheque').value = '';
  $a('rcpt-bank').value = '';
  $a('rcpt-due').value = '';
  $a('rcpt-notes').value = '';
  toggleChequeFields();
  openModal('receipt-modal');
}

// ===== Cheque Fields Toggle =====
function toggleChequeFields() {
  const method = $a('rcpt-method')?.value;
  const fields = document.querySelectorAll('.cheque-field');
  const row = $a('rcpt-cheque-row');
  if (method === 'cheque') {
    fields.forEach(f => f.style.display = '');
    if (row) row.style.display = '';
  } else {
    fields.forEach(f => f.style.display = 'none');
    if (row) row.style.display = 'none';
  }
}

async function saveReceipt() {
  const amount = parseFloat($a('rcpt-amount')?.value);
  const method = $a('rcpt-method')?.value || 'cash';
  const customerName = $a('rcpt-customer')?.value?.trim() || '';
  const reference = $a('rcpt-reference')?.value?.trim() || '';
  const cheque = $a('rcpt-cheque')?.value?.trim() || '';
  const bankName = $a('rcpt-bank')?.value?.trim() || '';
  const dueDate = $a('rcpt-due')?.value || '';
  const notes = $a('rcpt-notes')?.value?.trim() || '';
  if (!amount || amount <= 0) { showAdminToast('المبلغ مطلوب ويجب أن يكون أكبر من صفر', 'error'); return; }
  const payload = {
    amount,
    paymentMethod: method,
    customerName,
    customerPhone: '',
    referenceNumber: reference,
    chequeNumber: cheque,
    bankName,
    dueDate,
    notes,
    linkedTo: _activeReceiptInvoiceId ? 'invoice' : 'none',
    linkedId: _activeReceiptInvoiceId || null
  };
  try {
    const res = await fetchWithStability('/api/receipts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.success) { showAdminToast(res.message || 'فشل تسجيل سند القبض', 'error'); return; }
    showAdminToast('تم تسجيل سند القبض بنجاح');
    closeModal('receipt-modal');
    await loadReceiptsSection();
    if (_activeReceiptInvoiceId) {
      _activeReceiptInvoiceId = null;
      const invId = $a('rcpt-linked-id')?.value;
      if (invId) await viewInvoice(invId);
    }
  } catch (err) {
    console.error('Save receipt error:', err);
    showAdminToast('فشل تسجيل سند القبض', 'error');
  }
}

function openCancelReceipt(receiptId) {
  $a('cancel-receipt-modal').dataset.receiptId = receiptId;
  $a('rcpt-cancel-reason').value = '';
  openModal('cancel-receipt-modal');
}

async function confirmCancelReceipt() {
  const receiptId = $a('cancel-receipt-modal').dataset.receiptId;
  if (!receiptId) { showAdminToast('خطأ في تحديد سند القبض', 'error'); return; }
  const reason = $a('rcpt-cancel-reason')?.value?.trim() || '';
  try {
    const res = await fetchWithStability('/api/receipts/' + receiptId + '/cancel', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cancelReason: reason })
    });
    if (!res.success) { showAdminToast(res.message || 'فشل إلغاء سند القبض', 'error'); return; }
    showAdminToast('تم إلغاء سند القبض');
    closeModal('cancel-receipt-modal');
    await loadReceiptsSection();
    if (_currentPrintInvoice) viewInvoice(_currentPrintInvoice.id);
  } catch (err) {
    console.error('Cancel receipt error:', err);
    showAdminToast('فشل إلغاء سند القبض', 'error');
  }
}

// ===== Receipt Print & PDF =====
let _lastPrintedReceiptId = null;
let _lastPrintedExpenseId = null;

function printReceipt() {
  const id = $a('rcpt-linked-id')?.value || _lastPrintedReceiptId;
  if (!id) { showAdminToast('لا يوجد سند للطباعة', 'error'); return; }
  printReceiptById(id);
}

async function downloadReceiptPdf(btn) {
  const id = $a('rcpt-linked-id')?.value || _lastPrintedReceiptId;
  if (!id) { showAdminToast('لا يوجد سند للتحميل', 'error'); return; }
  await downloadReceiptPdfById(btn, id);
}

function printReceiptById(id) {
  _lastPrintedReceiptId = id;
  const r = _receiptsCache.find(x => x.id === id);
  if (!r) { showAdminToast('سند القبض غير موجود', 'error'); return; }
  const methodLabels = { cash: 'نقداً', cheque: 'شيك', bank_transfer: 'تحويل بنكي', visa: 'بطاقة ائتمان' };
  const win = window.open('', '_blank');
  if (!win) { showAdminToast('الرجاء السماح للنوافذ المنبثقة', 'error'); return; }
  win.document.write('<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"><title>سند قبض - ' + r.voucherNumber + '</title><style>@page{size:A4;margin:12mm}*{margin:0;padding:0;box-sizing:border-box}body{font-family:"Segoe UI",Tahoma,Arial,sans-serif;color:#222;font-size:13px;line-height:1.5;direction:rtl;background:#fff}.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px}.store{text-align:right}.store-logo{max-height:70px;margin-bottom:10px;display:block}.store-name{font-size:22px;font-weight:700;color:#111}.store-info{font-size:12px;color:#555;line-height:1.6}.meta{text-align:left}.doc-title{font-size:20px;font-weight:700;color:#111;margin-bottom:6px}.doc-info{font-size:12px;color:#555}.divider{height:1px;background:#ddd;margin:16px 0}.section-title{font-size:14px;font-weight:700;color:#333;margin-bottom:8px}.info-table{width:100%;border-collapse:collapse;font-size:13px}.info-table td{padding:3px 0;border:none}.info-table td.lbl{width:120px;font-weight:600;color:#555}.signature-area{margin-top:50px;display:flex;justify-content:space-between}.signature-box{text-align:center}.signature-line{width:200px;height:1px;background:#333;margin:40px auto 6px}.signature-label{font-size:12px;color:#555}.footer{text-align:center;margin-top:40px;padding-top:16px;border-top:1px solid #ddd}.footer-text{font-size:16px;font-weight:600;color:#333;margin-bottom:4px}.footer-sub{font-size:11px;color:#888}</style></head><body>');
  win.document.write('<div class="header"><div class="store"><div class="store-name">' + escapeHtml(window.storeName || '') + '</div></div><div class="meta"><div class="doc-title">سند قبض</div><div class="doc-info">الرقم: ' + (r.voucherNumber || r.id) + '</div><div class="doc-info">التاريخ: ' + new Date(r.date || r.createdAt).toLocaleString('ar-EG') + '</div></div></div>');
  win.document.write('<div class="divider"></div><div class="section-title">بيانات العميل</div><table class="info-table"><tr><td class="lbl">الاسم</td><td>' + escapeHtml(r.customerName || '—') + '</td></tr><tr><td class="lbl">الهاتف</td><td>' + escapeHtml(r.customerPhone || '—') + '</td></tr></table>');
  win.document.write('<div class="divider"></div><div class="section-title">تفاصيل السند</div><table class="info-table"><tr><td class="lbl">المبلغ</td><td style="font-weight:700;font-size:15px">' + Number(r.amount).toFixed(2) + ' ₪</td></tr><tr><td class="lbl">طريقة الدفع</td><td>' + (methodLabels[r.paymentMethod] || r.paymentMethod) + '</td></tr>' + (r.referenceNumber ? '<tr><td class="lbl">رقم المرجع</td><td>' + escapeHtml(r.referenceNumber) + '</td></tr>' : '') + (r.linkedTo === 'invoice' && r.linkedId ? '<tr><td class="lbl">مرتبط بفاتورة</td><td>' + escapeHtml(r.linkedId) + '</td></tr>' : '') + (r.chequeNumber ? '<tr><td class="lbl">رقم الشيك</td><td>' + escapeHtml(r.chequeNumber) + '</td></tr>' : '') + (r.bankName ? '<tr><td class="lbl">البنك</td><td>' + escapeHtml(r.bankName) + '</td></tr>' : '') + (r.dueDate ? '<tr><td class="lbl">تاريخ الاستحقاق</td><td>' + new Date(r.dueDate).toLocaleDateString('ar-EG') + '</td></tr>' : '') + (r.paymentMethod === 'cheque' && r.chequeStatus ? '<tr><td class="lbl">حالة الشيك</td><td>' + chequeStatusLabel(r.chequeStatus) + '</td></tr>' : '') + (r.notes ? '<tr><td class="lbl">ملاحظات</td><td>' + escapeHtml(r.notes) + '</td></tr>' : '') + '</table>');
  win.document.write('<div class="signature-area"><div class="signature-box"><div class="signature-line"></div><div class="signature-label">التوقيع</div></div><div class="signature-box"><div class="signature-line"></div><div class="signature-label">ختم الشركة</div></div></div>');
  win.document.write('<div class="footer"><div class="footer-text">شكراً لتعاملكم معنا</div><div class="footer-sub">Generated by EVA System</div></div>');
  win.document.write('</body></html>');
  win.document.close();
  win.focus();
  setTimeout(function() { win.print(); }, 500);
}

async function downloadReceiptPdfById(btn, id) {
  if (!id) { showAdminToast('سند القبض غير موجود', 'error'); return; }
  const origHtml = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.classList.add('btn-loading'); btn.innerHTML = '...'; }
  try {
    const res = await API.downloadReceiptPdf(id);
    if (!res.success) { showAdminToast(res.message || 'فشل تحميل PDF', 'error'); return; }
    const r = _receiptsCache.find(x => x.id === id);
    downloadBlobFile(res.blob, (r ? (r.voucherNumber || id) : id) + '.pdf');
  } catch (err) {
    console.error('Download receipt PDF error:', err);
    showAdminToast('فشل تحميل PDF', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = origHtml; btn.classList.remove('btn-loading'); }
  }
}

// ===== Expense Print & PDF =====
function printExpense() {
  const id = _lastPrintedExpenseId;
  if (!id) { showAdminToast('لا يوجد سند للطباعة', 'error'); return; }
  printExpenseById(id);
}

async function downloadExpensePdf(btn) {
  const id = _lastPrintedExpenseId;
  if (!id) { showAdminToast('لا يوجد سند للتحميل', 'error'); return; }
  await downloadExpensePdfById(btn, id);
}

function printExpenseById(id) {
  _lastPrintedExpenseId = id;
  const e = _expensesCache.find(x => x.id === id);
  if (!e) { showAdminToast('سند الصرف غير موجود', 'error'); return; }
  const methodLabels = { cash: 'نقداً', cheque: 'شيك', bank_transfer: 'تحويل بنكي', visa: 'بطاقة ائتمان' };
  const catLabels = { rent: 'إيجار', salaries: 'رواتب', marketing: 'تسويق', shipping: 'شحن', inventory_purchase: 'مشتريات مخزون', maintenance: 'صيانة', utilities: 'فواتير خدمات', other: 'أخرى' };
  const win = window.open('', '_blank');
  if (!win) { showAdminToast('الرجاء السماح للنوافذ المنبثقة', 'error'); return; }
  win.document.write('<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"><title>سند صرف - ' + e.voucherNumber + '</title><style>@page{size:A4;margin:12mm}*{margin:0;padding:0;box-sizing:border-box}body{font-family:"Segoe UI",Tahoma,Arial,sans-serif;color:#222;font-size:13px;line-height:1.5;direction:rtl;background:#fff}.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px}.store{text-align:right}.store-logo{max-height:70px;margin-bottom:10px;display:block}.store-name{font-size:22px;font-weight:700;color:#111}.store-info{font-size:12px;color:#555;line-height:1.6}.meta{text-align:left}.doc-title{font-size:20px;font-weight:700;color:#111;margin-bottom:6px}.doc-info{font-size:12px;color:#555}.divider{height:1px;background:#ddd;margin:16px 0}.section-title{font-size:14px;font-weight:700;color:#333;margin-bottom:8px}.info-table{width:100%;border-collapse:collapse;font-size:13px}.info-table td{padding:3px 0;border:none}.info-table td.lbl{width:120px;font-weight:600;color:#555}.signature-area{margin-top:50px;display:flex;justify-content:center}.signature-box{text-align:center}.signature-line{width:200px;height:1px;background:#333;margin:40px auto 6px}.signature-label{font-size:12px;color:#555}.footer{text-align:center;margin-top:40px;padding-top:16px;border-top:1px solid #ddd}.footer-text{font-size:16px;font-weight:600;color:#333;margin-bottom:4px}.footer-sub{font-size:11px;color:#888}</style></head><body>');
  win.document.write('<div class="header"><div class="store"><div class="store-name">' + escapeHtml(window.storeName || '') + '</div></div><div class="meta"><div class="doc-title">سند صرف</div><div class="doc-info">الرقم: ' + (e.voucherNumber || e.id) + '</div><div class="doc-info">التاريخ: ' + new Date(e.date || e.createdAt).toLocaleString('ar-EG') + '</div></div></div>');
  win.document.write('<div class="divider"></div><div class="section-title">تفاصيل السند</div><table class="info-table"><tr><td class="lbl">المدفوع له</td><td>' + escapeHtml(e.payee || '—') + '</td></tr><tr><td class="lbl">التصنيف</td><td>' + (catLabels[e.category] || e.category) + '</td></tr><tr><td class="lbl">المبلغ</td><td style="font-weight:700;font-size:15px">' + Number(e.amount).toFixed(2) + ' ₪</td></tr><tr><td class="lbl">طريقة الدفع</td><td>' + (methodLabels[e.paymentMethod] || e.paymentMethod) + '</td></tr>' + (e.notes ? '<tr><td class="lbl">ملاحظات</td><td>' + escapeHtml(e.notes) + '</td></tr>' : '') + '</table>');
  win.document.write('<div class="signature-area"><div class="signature-box"><div class="signature-line"></div><div class="signature-label">التوقيع</div></div></div>');
  win.document.write('<div class="footer"><div class="footer-text">شكراً لتعاملكم معنا</div><div class="footer-sub">Generated by EVA System</div></div>');
  win.document.write('</body></html>');
  win.document.close();
  win.focus();
  setTimeout(function() { win.print(); }, 500);
}

async function downloadExpensePdfById(btn, id) {
  if (!id) { showAdminToast('سند الصرف غير موجود', 'error'); return; }
  const origHtml = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.classList.add('btn-loading'); btn.innerHTML = '...'; }
  try {
    const res = await API.downloadExpensePdf(id);
    if (!res.success) { showAdminToast(res.message || 'فشل تحميل PDF', 'error'); return; }
    const e = _expensesCache.find(x => x.id === id);
    downloadBlobFile(res.blob, (e ? (e.voucherNumber || id) : id) + '.pdf');
  } catch (err) {
    console.error('Download expense PDF error:', err);
    showAdminToast('فشل تحميل PDF', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = origHtml; btn.classList.remove('btn-loading'); }
  }
}

// ===== Customer Statement PDF =====
async function downloadStatementPdf() {
  const name = _profileCustomerName;
  const phone = _profileCustomerPhone;
  if (!name) { showAdminToast('لا يوجد عميل', 'error'); return; }
  try {
    const res = await API.downloadStatementPdf(name, phone);
    if (!res.success) { showAdminToast(res.message || 'فشل تحميل PDF', 'error'); return; }
    downloadBlobFile(res.blob, 'statement-' + name.replace(/[^a-zA-Z0-9]/g, '_') + '.pdf');
  } catch (err) {
    console.error('Download statement PDF error:', err);
    showAdminToast('فشل تحميل PDF', 'error');
  }
}

// ===== Cheque Status Label =====
function chequeStatusLabel(status) {
  const labels = { collected: 'تم التحصيل', pending: 'قيد التحصيل', returned: 'مرتجع', cancelled: 'ملغي' };
  return labels[status] || status;
}

// ===== Cheques Section =====
let _chequesCache = [];

async function loadChequesSection() {
  try {
    const tbody = $a('cheques-table-body');
    if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:20px;">جاري التحميل...</td></tr>';
    const res = await fetchWithStability('/api/accounting/cheques');
    _chequesCache = (res && res.success && Array.isArray(res.data)) ? res.data : (Array.isArray(res) ? res : []);
    renderChequesSection();
  } catch (err) {
    console.error('Error loading cheques:', err);
    showAdminToast('فشل تحميل الشيكات', 'error');
    _chequesCache = [];
    renderChequesSection();
  }
  if (window.lucide) lucide.createIcons();
}

function renderChequesSection() {
  const tbody = $a('cheques-table-body');
  const emptyState = $a('cheques-empty-state');
  if (!tbody) return;
  if (!_chequesCache.length) {
    tbody.innerHTML = '';
    if (emptyState) emptyState.style.display = 'block';
    return;
  }
  if (emptyState) emptyState.style.display = 'none';
  tbody.innerHTML = _chequesCache.map(c => {
    const statusClass = {
      pending: 'badge-warning',
      collected: 'badge-success',
      returned: 'badge-danger',
      cancelled: 'badge-secondary'
    };
    const dueColor = c.daysLabel && c.daysLabel.indexOf('متأخر') === 0 ? 'color:#991b1b' : (c.daysLabel === 'اليوم' ? 'color:#d97706' : '');
    const isPending = c.chequeStatus === 'pending';
    const actions = isPending
      ? '<div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:center">' +
        '<button class="topbar-btn btn-outline btn-sm" onclick="collectCheque(\'' + c.id + '\')" style="padding:2px 6px;font-size:0.7rem;color:var(--admin-success)" title="تحصيل"><i data-lucide="check-circle" style="width:10px;height:10px"></i></button>' +
        '<button class="topbar-btn btn-outline btn-sm" onclick="returnCheque(\'' + c.id + '\')" style="padding:2px 6px;font-size:0.7rem;color:var(--admin-danger)" title="إرجاع"><i data-lucide="undo-2" style="width:10px;height:10px"></i></button>' +
        '<button class="topbar-btn btn-outline btn-sm" onclick="cancelCheque(\'' + c.id + '\')" style="padding:2px 6px;font-size:0.7rem;color:var(--admin-text2)" title="إلغاء"><i data-lucide="x-circle" style="width:10px;height:10px"></i></button>' +
        '</div>'
      : '<span style="color:var(--admin-text2);font-size:0.8rem">—</span>';
    return '<tr>' +
      '<td style="padding:8px 12px">' + escapeHtml(c.customerName || '—') + '</td>' +
      '<td style="padding:8px 12px;font-family:monospace;font-size:0.8rem">' + escapeHtml(c.chequeNumber) + '</td>' +
      '<td style="padding:8px 12px">' + escapeHtml(c.bankName) + '</td>' +
      '<td style="padding:8px 12px;font-weight:600">' + Number(c.amount).toFixed(2) + ' ₪</td>' +
      '<td style="padding:8px 12px;font-size:0.8rem">' + (c.dueDate ? new Date(c.dueDate).toLocaleDateString('ar-EG') : '—') + '</td>' +
      '<td style="padding:8px 12px;font-size:0.8rem;' + dueColor + '">' + c.daysLabel + '</td>' +
      '<td style="padding:8px 12px"><span class="status-badge ' + statusClass[c.chequeStatus] + '" style="font-size:0.75rem">' + chequeStatusLabel(c.chequeStatus) + '</span></td>' +
      '<td style="padding:8px 12px">' + actions + '</td></tr>';
  }).join('');
}

function filterChequesTable() {
  const filter = $a('cheque-status-filter')?.value || 'all';
  const search = ($a('cheque-search-input')?.value || '').trim().toLowerCase();
  const filtered = _chequesCache.filter(c => {
    if (filter !== 'all' && c.chequeStatus !== filter) return false;
    if (search) {
      const name = (c.customerName || '').toLowerCase();
      const num = (c.chequeNumber || '').toLowerCase();
      if (name.indexOf(search) === -1 && num.indexOf(search) === -1) return false;
    }
    return true;
  });
  const tbody = $a('cheques-table-body');
  const emptyState = $a('cheques-empty-state');
  if (!tbody) return;
  if (!filtered.length) {
    tbody.innerHTML = '';
    if (emptyState) emptyState.style.display = 'block';
    return;
  }
  if (emptyState) emptyState.style.display = 'none';
  const orig = _chequesCache;
  _chequesCache = filtered;
  renderChequesSection();
  _chequesCache = orig;
}

// ===== Cheque Actions =====
async function updateChequeStatus(id, status, actionLabel) {
  const origTxt = event?.target?.innerHTML;
  if (event?.target) { event.target.disabled = true; event.target.innerHTML = '...'; }
  try {
    const res = await fetchWithStability('/api/receipts/' + encodeURIComponent(id) + '/cheque-status', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chequeStatus: status })
    });
    if (!res.success) { showAdminToast(res.message || 'فشل تحديث حالة الشيك', 'error'); return; }
    showAdminToast('تم ' + actionLabel + ' الشيك بنجاح');
    await loadChequesSection();
  } catch (err) {
    console.error('Update cheque status error:', err);
    showAdminToast('فشل تحديث حالة الشيك', 'error');
  } finally {
    if (event?.target) { event.target.disabled = false; event.target.innerHTML = origTxt; }
  }
}

async function collectCheque(id) {
  if (!confirm('تأكيد تحصيل الشيك؟')) return;
  await updateChequeStatus(id, 'collected', 'تحصيل');
}

async function returnCheque(id) {
  if (!confirm('تأكيد إرجاع الشيك؟')) return;
  await updateChequeStatus(id, 'returned', 'إرجاع');
}

async function cancelCheque(id) {
  if (!confirm('تأكيد إلغاء الشيك؟')) return;
  await updateChequeStatus(id, 'cancelled', 'إلغاء');
}
async function loadExpensesSection() {
  try {
    const tbody = $a('expenses-table-body');
    if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:20px;">جاري التحميل...</td></tr>';
    const res = await fetchWithStability('/api/expenses');
    _expensesCache = (res && res.success && Array.isArray(res.data)) ? res.data : (Array.isArray(res) ? res : []);
    renderExpensesSection();
  } catch (err) {
    console.error('Error loading expenses:', err);
    showAdminToast('فشل تحميل سندات الصرف', 'error');
  }
}

function renderExpensesSection() {
  const tbody = $a('expenses-table-body');
  const emptyState = $a('expenses-empty-state');
  if (!tbody) return;
  if (!_expensesCache.length) {
    tbody.innerHTML = '';
    if (emptyState) emptyState.style.display = 'block';
    return;
  }
  if (emptyState) emptyState.style.display = 'none';

  const catLabels = { rent: 'إيجار', salaries: 'رواتب', marketing: 'تسويق', shipping: 'شحن', inventory_purchase: 'مشتريات مخزون', maintenance: 'صيانة', utilities: 'فواتير خدمات', other: 'أخرى' };

  tbody.innerHTML = _expensesCache.slice().reverse().map(function(e) {
    return '<tr>' +
      '<td style="padding:8px 12px;font-weight:600">' + (e.voucherNumber || e.id) + '</td>' +
      '<td style="padding:8px 12px">' + (e.date ? new Date(e.date).toLocaleDateString('ar-EG') : '—') + '</td>' +
      '<td style="padding:8px 12px">' + (catLabels[e.category] || e.category) + '</td>' +
      '<td style="padding:8px 12px">' + escapeHtml(e.payee || '—') + '</td>' +
      '<td style="padding:8px 12px;font-weight:600">' + Number(e.amount).toFixed(2) + ' ₪</td>' +
      '<td style="padding:8px 12px">' + getPaymentMethodText(e.paymentMethod) + '</td>' +
      '<td style="padding:8px 12px"><div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:center">' +
        '<button class="topbar-btn btn-outline btn-sm" onclick="printExpenseById(\'' + e.id + '\')" style="padding:2px 6px;font-size:0.7rem" title="طباعة"><i data-lucide="printer" style="width:10px;height:10px"></i></button>' +
        '<button class="topbar-btn btn-outline btn-sm" onclick="downloadExpensePdfById(this,\'' + e.id + '\')" style="padding:2px 6px;font-size:0.7rem" title="PDF"><i data-lucide="file-text" style="width:10px;height:10px"></i></button>' +
        '<button class="topbar-btn btn-danger btn-sm" onclick="deleteExpense(\'' + e.id + '\')" style="padding:2px 6px;font-size:0.7rem" title="حذف"><i data-lucide="trash-2" style="width:10px;height:10px"></i></button>' +
        '</div></td></tr>';
  }).join('');
  if (window.lucide) lucide.createIcons();
}

function openAddExpense() {
  $a('exp-category').value = 'rent';
  $a('exp-payee').value = '';
  $a('exp-amount').value = '';
  $a('exp-method').value = 'cash';
  $a('exp-notes').value = '';
  openModal('expense-modal');
}

async function saveExpense() {
  const category = $a('exp-category')?.value;
  const payee = $a('exp-payee')?.value?.trim();
  const amount = parseFloat($a('exp-amount')?.value);
  const method = $a('exp-method')?.value || 'cash';
  const notes = $a('exp-notes')?.value?.trim() || '';
  if (!payee) { showAdminToast('المدفوع له مطلوب', 'error'); return; }
  if (!amount || amount <= 0) { showAdminToast('المبلغ مطلوب ويجب أن يكون أكبر من صفر', 'error'); return; }
  try {
    const res = await fetchWithStability('/api/expenses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category, payee, amount, paymentMethod: method, notes })
    });
    if (!res.success) { showAdminToast(res.message || 'فشل تسجيل سند الصرف', 'error'); return; }
    showAdminToast('تم تسجيل سند الصرف بنجاح');
    closeModal('expense-modal');
    await loadExpensesSection();
  } catch (err) {
    console.error('Save expense error:', err);
    showAdminToast('فشل تسجيل سند الصرف', 'error');
  }
}

async function deleteExpense(id) {
  if (!confirm('هل أنت متأكد من حذف سند الصرف هذا؟')) return;
  try {
    const res = await fetchWithStability('/api/expenses/' + id, { method: 'DELETE' });
    if (!res.success) { showAdminToast(res.message || 'فشل حذف سند الصرف', 'error'); return; }
    showAdminToast('تم حذف سند الصرف');
    await loadExpensesSection();
  } catch (err) {
    console.error('Delete expense error:', err);
    showAdminToast('فشل حذف سند الصرف', 'error');
  }
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
      <td><span class="status-badge status-${o.status}">${statusText(o.status, o.orderType)}</span></td>
      <td>${o.date}</td>
    </tr>`).join('');
  } catch(e) {
    console.error('Dashboard render failed', e);
    const tbody = $a('recent-orders-body');
    if (tbody) tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state" style="margin:20px"><div class="empty-icon"><i data-lucide="alert-circle"></i></div><h3>خطأ في التحميل</h3><p>حدث خطأ أثناء تحميل البيانات.</p></div></td></tr>`;
    if (window.lucide) lucide.createIcons();
  }
}

function statusText(s, orderType) {
  const type = orderType || 'delivery';
  const labels = {
    pending: 'قيد الانتظار',
    confirmed: 'تم التأكيد',
    processing: 'جاري التجهيز',
    shipped: type !== 'delivery' ? 'جاهز' : 'تم الشحن',
    delivered: type !== 'delivery' ? 'تم' : 'تم التوصيل',
    cancelled: 'ملغي'
  };
  return labels[s] || s;
}

// ===== Simplified Merchant Dashboard (with caching) =====
let _merchantOrdersCache = [];

async function renderMerchantDashboard() {
  try {
    const [orders, products, store, categories] = await Promise.all([
      API.getOrders(),
      API.getProducts(),
      API.getStoreSettings(),
      API.getCategories()
    ]);
    _merchantOrdersCache = orders;
    const sym = store.currencySymbol || store.currency || 'USD';

    const today = new Date().toDateString();
    const todayOrders = orders.filter(o => {
      const d = o.date || o.createdAt;
      return d && new Date(d).toDateString() === today;
    });
    const revenueToday = todayOrders.reduce((sum, o) => sum + (o.total || 0), 0);
    const invoicesToday = todayOrders.filter(o => o.status !== 'cancelled').length;

    const pendingOrdersCount = orders.filter(o => o.status === 'pending').length;

    // Yesterday's data for trend comparison
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    const yesterdayOrders = orders.filter(o => {
      const d = o.date || o.createdAt;
      return d && new Date(d).toDateString() === yesterday;
    });
    const revenueYesterday = yesterdayOrders.reduce((sum, o) => sum + (o.total || 0), 0);

    const safeSet = (id, val) => { const el = $a(id); if(el) el.textContent = val; };
    safeSet('ms-orders-today', todayOrders.length);
    safeSet('ms-revenue-today', revenueToday.toLocaleString('ar-SA') + ` ${sym}`);
    safeSet('ms-products-active', products.length);
    safeSet('ms-invoices-today', invoicesToday);

    // ===== SECTION 1: Smart Welcome + Insight =====
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'صباح الخير' : 'مساء الخير';
    safeSet('dash-greeting-text', greeting);
    safeSet('dash-store-name', store.name || 'متجرك');
    const planBadge = $a('dash-plan-badge');
    if (planBadge) planBadge.textContent = window.storePlan?.name || 'الخطة الأساسية';
    const dateEl = $a('dash-current-date');
    if (dateEl) dateEl.textContent = new Date().toLocaleDateString('ar-SA', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
    // Dynamic business insight
    const insightEl = $a('dash-insight-line');
    if (insightEl) {
      let text = '', icon = 'info';
      if (todayOrders.length > 0) { text = `تم استلام ${todayOrders.length} طلب${todayOrders.length>1?'ات':''} جديد${todayOrders.length>1?'ة':''} اليوم`; icon = 'shopping-cart'; }
      else if (pendingOrdersCount > 0) { text = `يوجد ${pendingOrdersCount} طلب${pendingOrdersCount>1?'ات':''} بانتظار المعالجة`; icon = 'alert-circle'; }
      else { const ls = products.filter(p => p.active!==false && p.stock!==undefined && Number(p.stock)<=3 && p.stock!==''); if(ls.length>0) { text=`يوجد ${ls.length} منتج${ls.length>1?'ات':''} تحتاج إعادة تخزين`; icon='alert-triangle'; } else { text='كل شيء على ما يرام — متجرك يعمل بكفاءة'; icon='check-circle'; } }
      insightEl.innerHTML = `<i data-lucide="${icon}" style="width:16px;height:16px"></i> ${text}`;
    }

    // ===== SECTION 2: Business Snapshot with Trends =====
    safeSet('dash-orders-today', todayOrders.length);
    safeSet('dash-revenue-today', revenueToday.toLocaleString('ar-SA') + ` ${sym}`);
    safeSet('dash-pending-orders', pendingOrdersCount);
    safeSet('dash-products-count', products.length);
    const tEl = (id,val,cls) => { const e=$a(id); if(e){e.textContent=val;e.className='dash-kpi-trend '+cls;} };
    const cEl = (id,val) => { const e=$a(id); if(e)e.textContent=val; };
    const orderDiff = todayOrders.length - yesterdayOrders.length;
    if (yesterdayOrders.length>0) { const p=Math.round(orderDiff/yesterdayOrders.length*100); tEl('kpi-trend-orders',(p>0?'+':'')+p+'%',p>0?'up':p<0?'down':'neutral'); }
    else if (todayOrders.length>0) tEl('kpi-trend-orders','+ جديد','up');
    else tEl('kpi-trend-orders','—','neutral');
    cEl('kpi-context-orders',yesterdayOrders.length>0?`مقارنة بالأمس (${yesterdayOrders.length})`:todayOrders.length>0?'أول طلبات اليوم':'');
    const revDiff = revenueToday - revenueYesterday;
    if (revenueYesterday>0) { const p=Math.round(revDiff/revenueYesterday*100); tEl('kpi-trend-revenue',(p>0?'+':'')+p+'%',p>0?'up':p<0?'down':'neutral'); }
    else if (revenueToday>0) tEl('kpi-trend-revenue','+ جديد','up');
    else tEl('kpi-trend-revenue','—','neutral');
    cEl('kpi-context-revenue',revenueToday>0?`اليوم: ${revenueToday.toLocaleString('ar-SA')} ${sym}`:revenueYesterday>0?`الأمس: ${revenueYesterday.toLocaleString('ar-SA')} ${sym}`:'');
    const totalOrders = orders.length;
    if (totalOrders>0) { const p=Math.round(pendingOrdersCount/totalOrders*100); tEl('kpi-trend-pending',p+'%',p>20?'down':p>0?'neutral':'up'); }
    else tEl('kpi-trend-pending','—','neutral');
    cEl('kpi-context-pending',`من ${totalOrders} إجمالي الطلبات`);
    const activeProducts = products.filter(p=>p.active!==false).length;
    tEl('kpi-trend-products',activeProducts+'/'+products.length,'neutral');
    cEl('kpi-context-products',`${products.length-activeProducts} غير نشط`);

    // ===== SECTION 3: Attention Center (collect items from both sides of invoice fetch) =====
    const attentionArea = $a('dash-attention-area');
    const attentionList = $a('dash-attention-list');
    const aItems = [];
    if (attentionArea && attentionList) {
      if (pendingOrdersCount>0) aItems.push({ sev:'critical', icon:'shopping-cart', text:`${pendingOrdersCount} طلب بانتظار التأكيد`, page:'orders', action:'معالجة' });
      const ls = products.filter(p=>p.active!==false && p.stock!==undefined && Number(p.stock)<=3 && p.stock!=='');
      ls.slice(0,3).forEach(p=>aItems.push({ sev:'warning', icon:'alert-triangle', text:`مخزون منخفض: ${p.name} (${p.stock})`, page:'products', action:'تزويد' }));
    }

    // ===== Fetch invoices for timeline + attention =====
    let invoices = appState.invoices || [];
    if (!invoices.length) {
      try {
        const invRes = await fetchWithStability('/api/invoices');
        if (invRes && invRes.success && Array.isArray(invRes.invoices)) { invoices = invRes.invoices; appState.invoices = invoices; }
        else if (Array.isArray(invRes)) { invoices = invRes; appState.invoices = invoices; }
      } catch(e) { invoices = []; }
    }

    // Ensure receipt cache is populated for unpaid invoice computation
    if (!_receiptsCache.length) {
      try {
        const rRes = await fetchWithStability('/api/receipts');
        if (rRes && rRes.success && Array.isArray(rRes.data)) _receiptsCache = rRes.data;
      } catch(e) { /* ignore */ }
    }

    // Finalize attention with unpaid invoices
    if (attentionArea && attentionList) {
      const unpaidCount = invoices.filter(inv => {
      if (inv.status === 'cancelled') return false;
      const linked = (_receiptsCache || []).filter(r => r.linkedTo === 'invoice' && String(r.linkedId) === String(inv.id) && r.status !== 'cancelled');
      const totalPaid = linked.reduce((s, r) => s + (Number(r.amount) || 0), 0);
      return totalPaid < (Number(inv.total) || 0);
    }).length;
      if (unpaidCount>0) aItems.push({ sev:'info', icon:'file-text', text:`${unpaidCount} فاتورة غير مدفوعة`, page:'invoices', action:'دفع' });
      if (aItems.length>0) {
        attentionArea.style.display = '';
        attentionList.innerHTML = aItems.map(i =>
          `<div class="dash-attention-item">
            <div class="dash-attention-left">
              <span class="dash-attention-severity ${i.sev}"></span>
              <i data-lucide="${i.icon}" style="width:16px;height:16px;color:${i.sev==='critical'?'#dc2626':i.sev==='warning'?'#d97706':'#2563eb'}"></i>
              <span>${i.text}</span>
            </div>
            <button class="dash-attention-action ${i.sev}" onclick="navigateTo('${i.page}')">${i.action}</button>
          </div>`).join('');
      } else {
        attentionArea.style.display = '';
        attentionList.innerHTML = `<div class="dash-attention-item" style="border-right-color:#059669;cursor:default">
          <div class="dash-attention-left">
            <span class="dash-attention-severity success"></span>
            <i data-lucide="check-circle" style="width:16px;height:16px;color:#059669"></i>
            <span>كل شيء على ما يرام — لا توجد متطلبات متابعة</span>
          </div>
        </div>`;
      }
    }

    // ===== SECTION 4: Activity Timeline =====
    const timelineEl = $a('dash-timeline-list');
    if (timelineEl) {
      const fm = d => d ? new Date(d).toLocaleTimeString('ar-SA',{hour:'2-digit',minute:'2-digit'}) : '';
      const ti = [];
      orders.slice(0,10).forEach(o => ti.push({
        dot:'order', title:`طلب جديد #${o.id||o.orderNumber||''}`, sub:o.customer||'عميل',
        tm:fm(o.date||o.createdAt), sd:o.date||o.createdAt,
        r:`<span class="dash-timeline-status status-badge status-${o.status}">${statusText(o.status, o.orderType)}</span><span class="dash-timeline-total">${Number(o.total||0).toLocaleString('ar-SA')} ${sym}</span>`,
        pg:'orders' }));
      invoices.sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).slice(0,5).forEach(inv => ti.push({
        dot:'invoice', title:`فاتورة #${inv.id}`, sub:inv.customer?.name||'عميل',
        tm:fm(inv.createdAt), sd:inv.createdAt,
        r:`<span class="dash-timeline-total">${Number(inv.total||0).toLocaleString('ar-SA')} ${sym}</span>`,
        pg:'invoices' }));
      (stockReceiptsLog||[]).slice(0,5).forEach(r => ti.push({
        dot:'stock', title:r.productName||'منتج', sub:`تم إضافة ${r.qty||0} إلى المخزون`,
        tm:fm(r.date), sd:r.date, r:'', pg:'stock-receiving' }));
      const top = ti.sort((a,b)=>new Date(b.sd)-new Date(a.sd)).slice(0,10);
      if (top.length===0) timelineEl.innerHTML='<div class="dash-empty">لا توجد نشاطات حتى الآن</div>';
      else timelineEl.innerHTML = top.map(i =>
        `<div class="dash-timeline-item" onclick="navigateTo('${i.pg}')">
          <div class="dash-timeline-left">
            <span class="dash-timeline-time">${i.tm}</span>
            <div class="dash-timeline-dot ${i.dot}"></div>
            <div class="dash-timeline-info">
              <span class="dash-timeline-title">${i.title}</span>
              <span class="dash-timeline-sub">${i.sub}</span>
            </div>
          </div>
          <div class="dash-timeline-right">${i.r}</div>
        </div>`).join('');
    }

    // ===== SECTION 6: Smart Analytics =====
    // Top Products
    const topP = $a('dash-analytics-top-products');
    if (topP) {
      const pc = {}; orders.forEach(o=>(o.items||[]).forEach(it=>{const n=it.name||'منتج';pc[n]=(pc[n]||0)+(it.qty||1);}));
      const tp = Object.entries(pc).sort((a,b)=>b[1]-a[1]).slice(0,5); const mx = tp.length?tp[0][1]:1;
      const b = topP.querySelector('.dash-analytics-card-body');
      if (b) b.innerHTML = tp.length ? tp.map(([n,c])=>`<div class="dash-analytics-row"><span class="dash-analytics-row-name">${n}</span><span class="dash-analytics-row-value">${c}</span></div><div class="dash-analytics-bar"><div class="dash-analytics-bar-fill" style="width:${(c/mx*100).toFixed(0)}%"></div></div>`).join('') : '<div class="dash-analytics-empty">لا توجد مبيعات بعد</div>';
    }
    // Best Categories
    const catE = $a('dash-analytics-categories');
    if (catE) {
      const cc = {}; products.forEach(p=>{const cn=categories.find(c=>c.id===p.category)?.name||p.category||'غير مصنف';cc[cn]=(cc[cn]||0)+1;});
      const tc = Object.entries(cc).sort((a,b)=>b[1]-a[1]).slice(0,5); const mx = tc.length?tc[0][1]:1;
      const b = catE.querySelector('.dash-analytics-card-body');
      if (b) b.innerHTML = tc.length ? tc.map(([n,c])=>`<div class="dash-analytics-row"><span class="dash-analytics-row-name">${n}</span><span class="dash-analytics-row-value">${c}</span></div><div class="dash-analytics-bar"><div class="dash-analytics-bar-fill" style="width:${(c/mx*100).toFixed(0)}%"></div></div>`).join('') : '<div class="dash-analytics-empty">لا توجد تصنيفات</div>';
    }
    // Sales This Week
    const wE = $a('dash-analytics-weekly-sales');
    if (wE) {
      const wd = ['الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
      const nw = new Date(); const ws = new Date(nw); ws.setDate(nw.getDate()-nw.getDay()); ws.setHours(0,0,0,0);
      const ds = wd.map((n,i)=>{const d=new Date(ws);d.setDate(ws.getDate()+i);return{name:n,total:orders.filter(o=>{const od=o.date||o.createdAt;return od&&new Date(od).toDateString()===d.toDateString();}).reduce((s,o)=>s+(o.total||0),0),day:d};});
      const mx = Math.max(...ds.map(d=>d.total),1); const td = nw.getDay();
      const b = wE.querySelector('.dash-analytics-card-body');
      if (b) b.innerHTML = ds.map((d,i)=>`<div class="dash-analytics-row"><span class="dash-analytics-row-name" style="${i===td?'color:#B88746;font-weight:800':''}">${d.name}${i===td?' (اليوم)':''}</span><span class="dash-analytics-row-value">${d.total.toLocaleString('ar-SA')}</span></div><div class="dash-analytics-bar"><div class="dash-analytics-bar-fill" style="width:${(d.total/mx*100).toFixed(0)}%"></div></div>`).join('');
    }
    // Orders Status Distribution
    const sE = $a('dash-analytics-order-status');
    if (sE) {
      const ss = {}; orders.forEach(o=>{ss[o.status]=(ss[o.status]||0)+1;});
      const so = ['pending','processing','delivered','cancelled'];
      const sl = {pending:'قيد الانتظار',processing:'قيد المعالجة',delivered:'تم التسليم',cancelled:'ملغي'};
      const tl = orders.length||1; const sc = {pending:'#d97706',processing:'#2563eb',delivered:'#059669',cancelled:'#64748b'};
      const b = sE.querySelector('.dash-analytics-card-body');
      if (b) b.innerHTML = orders.length ? so.map(s=>`<div class="dash-analytics-row"><span class="dash-analytics-row-name"><span class="dash-analytics-pill ${s}">${sl[s]||s}</span></span><span class="dash-analytics-row-value">${ss[s]||0}</span></div><div class="dash-analytics-bar"><div class="dash-analytics-bar-fill" style="width:${((ss[s]||0)/tl*100).toFixed(0)}%;background:${sc[s]}"></div></div>`).join('') : '<div class="dash-analytics-empty">لا توجد طلبات</div>';
    }
    // Low Stock Summary
    const lE = $a('dash-analytics-low-stock');
    if (lE) {
      const li = products.filter(p=>p.active!==false && p.stock!==undefined && Number(p.stock)<=5 && p.stock!=='').sort((a,b)=>Number(a.stock)-Number(b.stock)).slice(0,5);
      const mx = Math.max(...li.map(p=>Number(p.stock)),1);
      const b = lE.querySelector('.dash-analytics-card-body');
      if (b) b.innerHTML = li.length ? li.map(p=>`<div class="dash-analytics-row"><span class="dash-analytics-row-name">${p.name||'منتج'}</span><span class="dash-analytics-row-value" style="color:${Number(p.stock)<=3?'#dc2626':'#d97706'}">${p.stock}</span></div><div class="dash-analytics-bar"><div class="dash-analytics-bar-fill" style="width:${(Number(p.stock)/mx*100).toFixed(0)}%;background:${Number(p.stock)<=3?'#dc2626':'#d97706'}"></div></div>`).join('') : '<div class="dash-analytics-empty">جميع المنتجات متوفرة بمخزون كافٍ</div>';
    }

    // ===== SECTION 7: Notification Center =====
    const nList = $a('dash-notif-list');
    if (nList) {
      const ni = [];
      if (todayOrders.length>0) ni.push({icon:'shopping-cart', text:`${todayOrders.length} طلب${todayOrders.length>1?'ات':''} جديد${todayOrders.length>1?'ة':''}`});
      const lsc = products.filter(p=>p.active!==false && p.stock!==undefined && Number(p.stock)<=3 && p.stock!=='').length;
      if (lsc>0) ni.push({icon:'alert-triangle', text:`${lsc} منتج منخفض المخزون`});
      const upc = invoices.filter(inv => {
      if (inv.status === 'cancelled') return false;
      const linked = (_receiptsCache || []).filter(r => r.linkedTo === 'invoice' && String(r.linkedId) === String(inv.id) && r.status !== 'cancelled');
      const totalPaid = linked.reduce((s, r) => s + (Number(r.amount) || 0), 0);
      return totalPaid < (Number(inv.total) || 0);
    }).length;
      if (upc>0) ni.push({icon:'file-text', text:`${upc} فاتورة غير مدفوعة`});
      const nC = $a('dash-notif-count');
      if (nC) nC.textContent = ni.length;
      nList.innerHTML = ni.length ? ni.map(i=>`<div class="dash-notif-item"><i data-lucide="${i.icon}" style="width:14px;height:14px;color:#B88746"></i><span>${i.text}</span></div>`).join('') : '<div class="dash-notif-item dash-notif-empty">لا توجد إشعارات جديدة</div>';
    }

    if (window.lucide) lucide.createIcons();
  } catch(e) {
    console.error('Merchant dashboard render failed', e);
  }
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
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state" style="margin:20px"><div class="empty-icon"><i data-lucide="package-x"></i></div><h3>لا توجد منتجات</h3><p>أضف منتجات جديدة للمتجر.</p></div></td></tr>`;
    if (window.lucide) lucide.createIcons();
    return;
  }
  const canEdit = Auth.can('edit_products');
  const storeSettings = await API.getStoreSettings();
  const sym = storeSettings.currencySymbol || storeSettings.currency || 'USD';
  
  tbody.innerHTML = products.map(p => {
    const catName = categories.find(c => c.id === p.category)?.name || p.category;
    return `
    <tr>
      <td>
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:56px;height:56px;border-radius:10px;background:${p.bg};display:flex;align-items:center;justify-content:center;font-size:1.5rem;overflow:hidden;box-shadow:0 2px 6px rgba(0,0,0,0.06)">
            ${p.image || (p.images && p.images[0]) 
              ? `<img src="${p.image || p.images[0]}" style="width:100%;height:100%;object-fit:cover" />` 
              : (p.emoji && p.emoji.length <= 4 ? p.emoji : `<i data-lucide="package" style="width:20px;height:20px;opacity:0.5"></i>`)}
          </div>
          <div style="font-weight:600">${p.name}</div>
        </div>
      </td>
      <td>${catName}</td>
      <td><strong>${p.price.toLocaleString('ar-SA')} ${sym}</strong>${p.oldPrice ? `<br><span style="text-decoration:line-through;color:var(--admin-text2);font-size:0.8rem">${p.oldPrice} ${sym}</span>` : ''}</td>
      <td>${typeof p.costPrice !== 'undefined' && p.costPrice !== null ? `${Number(p.costPrice).toLocaleString('ar-SA')} ${sym}` : '-'}</td>
      <td>${renderStockCell(p)}</td>
      <td><i data-lucide="star" style="width:14px;height:14px;color:#F59E0B;vertical-align:middle;margin-left:2px"></i> ${p.rating}</td>
      <td>
        <span class="${canEdit ? 'product-toggle' : ''}" ${canEdit ? `onclick="toggleProduct(${p.id})"` : ''} style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;${(() => {
          if (p.active === false) return 'background:#ef444422';
          if (p.temporarilyUnavailable) return 'background:#f59e0b22';
          return 'background:#22c55e22';
        })()}">
          <i data-lucide="${p.active === false ? 'x-circle' : (p.temporarilyUnavailable ? 'alert-circle' : 'check-circle')}" style="width:16px;height:16px;color:${p.active === false ? '#ef4444' : (p.temporarilyUnavailable ? '#f59e0b' : '#22c55e')}"></i>
        </span>
      </td>
      <td>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
          ${canEdit ? `
          <button class="topbar-btn btn-outline btn-sm btn-action" onclick="openEditProduct(${p.id})"><i data-lucide="edit" style="width:14px;height:14px;vertical-align:middle;margin-left:2px"></i> تعديل</button>
          <button class="topbar-btn btn-danger btn-sm btn-action" onclick="deleteProduct(${p.id})" style="margin-right:4px"><i data-lucide="trash-2" style="width:14px;height:14px;vertical-align:middle"></i></button>
          ` : ''}
          <button class="topbar-btn btn-outline btn-sm btn-action" onclick="printProductLabel(${p.id})"><i data-lucide="printer" style="width:14px;height:14px;vertical-align:middle;margin-left:2px"></i> طباعة ليبل</button>
          <button class="topbar-btn btn-outline btn-sm btn-action" onclick="downloadProductLabelPdf(this,${p.id})"><i data-lucide="file-down" style="width:14px;height:14px;vertical-align:middle;margin-left:2px"></i> تحميل PDF</button>
        </div>
      </td>
    </tr>`;
  }).join('');
  if (window.lucide) lucide.createIcons();
}

function renderStockCell(p) {
  const stock = p.stock != null && Number.isFinite(Number(p.stock)) ? Number(p.stock) : 0;
  if (stock <= 0) {
    return `<span class="stock-badge stock-empty">نافد</span>`;
  }
  if (stock < 10) {
    return `<span class="stock-badge stock-low">${stock} <span style="margin-left:6px;font-weight:600;color:var(--admin-warning)">منخفض</span></span>`;
  }
  return `<span class="stock-badge">${stock}</span>`;
}

function toggleProduct(productId) {
  withLock('toggle-' + productId, () => {
    return API.getProduct(productId).then(p => {
      if (p) {
        const isHidden = p.active === false;
        return API.updateProduct(productId, { ...p, active: isHidden ? true : false, temporarilyUnavailable: false }).then(res => {
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
  ['pm-name','pm-price','pm-oldprice','pm-badge','pm-stock','pm-costPrice'].forEach(id => $a(id).value = '');
  $a('pm-stock').value   = '0';
  $a('pm-costPrice').value = '0';
  $a('pm-bg').value      = '#FFE8F0,#FFB3D1';
  $a('pm-rating').value  = '4.5';
  $a('pm-reviews').value = '0';
  $a('pm-state').value   = 'available';
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
    $a('pm-stock').value      = p.stock != null ? p.stock : 0;
    $a('pm-costPrice').value  = (typeof p.costPrice !== 'undefined' && p.costPrice !== null) ? p.costPrice : 0;
    const bgColors = (p.bg || '').replace(/linear-gradient\(135deg,/, '').replace(/\)/, '');
    $a('pm-bg').value         = bgColors;
    $a('pm-badge').value      = p.badge || '';
    $a('pm-rating').value     = p.rating;
    $a('pm-reviews').value    = p.reviews;
    if (p.active === false) {
      $a('pm-state').value = 'hidden';
    } else if (p.temporarilyUnavailable) {
      $a('pm-state').value = 'temporary';
    } else {
      $a('pm-state').value = 'available';
    }
    
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
    costPrice: parseFloat($a('pm-costPrice').value) || 0,
    oldPrice: parseFloat($a('pm-oldprice').value) || null,
    stock:    parseInt($a('pm-stock').value, 10) || 0,
    bg:       bgVal.startsWith('linear') ? bgVal : `linear-gradient(135deg,${bgVal})`,
    badge:    $a('pm-badge').value || null,
    rating:   parseFloat($a('pm-rating').value) || 4.5,
    reviews:  parseInt($a('pm-reviews').value) || 0,
  };
  const pmState = $a('pm-state').value;
  data.active = pmState !== 'hidden';
  data.temporarilyUnavailable = pmState === 'temporary';
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

// ===== Category Helpers =====
function normalizeCategory(cat) {
  return {
    id: cat.id,
    name: cat.name || 'غير مصنف',
    image: cat.image || '',
    emoji: cat.emoji || '',
    parentId: cat.parentId && String(cat.parentId).trim() ? String(cat.parentId).trim() : null,
    sortOrder: typeof cat.sortOrder === 'number' ? cat.sortOrder : undefined
  };
}

function getRootCategories(cats) {
  return cats.filter(c => !normalizeCategory(c).parentId);
}

function getChildCategories(cats, parentId) {
  return cats.filter(c => normalizeCategory(c).parentId === String(parentId));
}

function buildCategoryTree(cats) {
  const root = getRootCategories(cats);
  const sorted = [...root].sort((a, b) => {
    const aOrder = normalizeCategory(a).sortOrder;
    const bOrder = normalizeCategory(b).sortOrder;
    if (aOrder !== undefined && bOrder !== undefined) return aOrder - bOrder;
    return 0;
  });
  return sorted.map(c => ({
    ...normalizeCategory(c),
    children: getChildCategories(cats, c.id).map(child => ({
      ...normalizeCategory(child),
      children: getChildCategories(cats, child.id)
    }))
  }));
}

function wouldCreateCategoryLoop(cats, categoryId, proposedParentId) {
  if (!proposedParentId || String(proposedParentId).trim() === '') return false;
  if (String(proposedParentId) === String(categoryId)) return true;
  const visited = new Set();
  let current = String(proposedParentId);
  while (current) {
    if (current === String(categoryId)) return true;
    if (visited.has(current)) return false;
    visited.add(current);
    const parent = cats.find(c => String(c.id) === current);
    current = parent && normalizeCategory(parent).parentId ? normalizeCategory(parent).parentId : null;
  }
  return false;
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
    const tree = buildCategoryTree(cats);
    function renderNode(node, depth) {
      const indent = depth * 20;
      const hasChildren = node.children && node.children.length > 0;
      const prefix = depth === 0 ? '' : (hasChildren ? '└─ ' : '├─ ');
      const isAll = node.id === 'all';
      return `
        <div class="store-card" style="min-height:auto;padding:12px 20px;margin-bottom:2px;border-right:${depth > 0 ? '2px solid var(--admin-border)' : 'none'};margin-right:${indent}px">
          <div style="display:flex;align-items:center;gap:14px;justify-content:space-between">
            <div style="display:flex;align-items:center;gap:12px">
              ${depth > 0 ? `<span style="color:var(--admin-text2);font-size:0.85rem;margin-left:4px">${prefix}</span>` : ''}
              <div style="width:40px;height:40px;border-radius:10px;background:var(--admin-surface2);display:flex;align-items:center;justify-content:center;font-size:1.2rem;overflow:hidden">
                ${node.image ? `<img src="${node.image}" alt="${node.name}" style="width:100%;height:100%;object-fit:cover" />` : `<i data-lucide="folder" style="width:20px;height:20px;opacity:0.6"></i>`}
              </div>
              <div>
                <div style="font-weight:700;font-size:0.95rem">${node.name}</div>
                <div style="font-size:0.75rem;color:var(--admin-text2)">المعرّف: ${node.id}${node.parentId ? ` | الأب: ${(cats.find(p => p.id === node.parentId) || {}).name || node.parentId}` : ''}</div>
              </div>
            </div>
            ${!isAll ? `
            <div style="display:flex;gap:6px">
              <button class="topbar-btn btn-outline btn-sm" onclick="openEditCategory('${node.id}')"><i data-lucide="edit" style="width:14px;height:14px"></i></button>
              <button class="topbar-btn btn-danger btn-sm" onclick="deleteCategory('${node.id}')"><i data-lucide="trash-2" style="width:14px;height:14px"></i></button>
            </div>
            ` : `<span style="font-size:0.75rem;color:var(--admin-text2);background:var(--admin-surface2);padding:4px 10px;border-radius:20px">تصنيف افتراضي</span>`}
          </div>
        </div>
        ${hasChildren ? node.children.map(child => renderNode(child, depth + 1)).join('') : ''}
      `;
    }
    container.innerHTML = tree.map(node => renderNode(node, 0)).join('');
    if (window.lucide) lucide.createIcons();
  });
}

function populateCategoryParentSelect(selectedParentId, excludeId) {
  const select = $a('cm-parentId');
  if (!select) return;
  API.getCategories().then(cats => {
    const filtered = cats.filter(c => c.id !== 'all' && c.id !== excludeId);
    const rootLabel = 'بدون — تصنيف رئيسي';
    let html = `<option value="">${rootLabel}</option>`;
    filtered.forEach(c => {
      const isChildOfExcluded = wouldCreateCategoryLoop(cats, excludeId, c.id);
      if (excludeId && (c.id === excludeId || isChildOfExcluded)) return;
      const parentName = c.parentId ? (cats.find(p => p.id === c.parentId)?.name || '') + ' / ' : '';
      const label = parentName + c.name;
      const selected = selectedParentId && String(c.id) === String(selectedParentId) ? 'selected' : '';
      html += `<option value="${c.id}" ${selected}>${label}</option>`;
    });
    select.innerHTML = html;
  });
}

function openAddCategory() {
  editingCategory = null;
  categoryImageMarkedForRemoval = false;
  $a('category-modal-title').innerHTML = '<i data-lucide="plus-circle" style="width:18px;height:18px;vertical-align:middle;margin-left:4px"></i> إضافة تصنيف جديد';
  $a('cm-name').value = '';
  clearCategoryImagePreview();
  populateCategoryParentSelect(null, null);
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
    populateCategoryParentSelect(cat.parentId || '', catId);
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

  const parentId = $a('cm-parentId') ? $a('cm-parentId').value.trim() : '';
  const data = { name };
  if (parentId) data.parentId = parentId;

  if (editingCategory) {
    const cats = await API.getCategories(true);
    if (wouldCreateCategoryLoop(cats, editingCategory, parentId)) {
      showAdminToast('لا يمكن جعل هذا التصنيف أباً لنفسه أو فرعاً من تصنيف فرعي تابع له', 'error');
      return;
    }
  }

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
  API.getCategories().then(cats => {
    const children = cats.filter(c => String(c.parentId) === String(catId));
    if (children.length > 0) {
      showConfirmModal('تأكيد الحذف',
        'هذا التصنيف يحتوي على تصنيفات فرعية. سيتم نقل التصنيفات الفرعية إلى المستوى الرئيسي قبل حذف التصنيف. هل تريد المتابعة؟',
        () => {
          withLock('delete-category-' + catId, () => {
            return API.deleteCategory(catId).then(res => {
              if (res && res.success === false) { showAdminToast(res.message || 'فشل الحذف', 'error'); return; }
              appState.categories = null;
              renderCategoriesPage();
              showAdminToast('تم حذف التصنيف');
            });
          });
        }
      );
    } else {
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

let currentOrderStatusFilter = 'all';

function setOrderFilter(filter) {
  currentOrderStatusFilter = filter;
  document.querySelectorAll('.order-filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.id === `order-filter-${filter}`);
  });
  renderOrdersTable();
}

function updateOrderFilterCounts(orders) {
  const counts = {
    all: orders.length,
    pending: orders.filter(o => o.status === 'pending').length,
    processing: orders.filter(o => o.status === 'processing').length,
    delivered: orders.filter(o => o.status === 'delivered').length,
  };
  Object.keys(counts).forEach(key => {
    const span = $a(`order-filter-count-${key}`);
    if (span) span.textContent = counts[key];
  });
}

function orderItemOptionsSummary(item) {
  if (!item.selectedOptions || !item.selectedOptions.length) return '';
  return item.selectedOptions.map(og =>
    og.selected.map(s => s.label).join(' + ')
  ).join(' | ');
}

const ORDER_TYPE_MAP = {
  delivery: { icon: '🚚', label: 'توصيل' },
  pickup: { icon: '🏃', label: 'استلام من الفرع' },
  dinein: { icon: '🍽️', label: 'داخل المطعم' }
};

function orderTypeIcon(type) {
  return (ORDER_TYPE_MAP[type] || ORDER_TYPE_MAP.delivery).icon;
}

function orderTypeLabel(type) {
  return (ORDER_TYPE_MAP[type] || ORDER_TYPE_MAP.delivery).label;
}

function orderTypeBadgeHtml(type) {
  const t = ORDER_TYPE_MAP[type] || ORDER_TYPE_MAP.delivery;
  return `<span style="font-size:0.78rem;color:var(--admin-text2)">${t.icon} ${t.label}</span>`;
}

function orderItemNotesHtml(item) {
  if (!item.notes) return '';
  return `<div style="font-size:0.78rem;color:var(--admin-danger, #dc3545);margin-top:1px">ملاحظة: ${item.notes}</div>`;
}

function renderOrdersTable() {
  Promise.all([API.getOrders(), API.getStoreSettings(), API.getUsers()]).then(([orders, store, users]) => {
    updateOrderFilterCounts(orders);
    if (currentOrderStatusFilter !== 'all') {
      orders = orders.filter(o => o.status === currentOrderStatusFilter);
    }
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
        <td><strong>${orderKey}</strong><br>${orderTypeBadgeHtml(o.orderType)}${assigneeText}</td>
        <td>
          <div style="font-weight:600">${o.customer}</div>
          <div style="font-size:0.78rem;color:var(--admin-text2)">${o.phone}</div>
        </td>
        <td>${o.items.map(i => `${i.emoji || ''} ${i.name}${i.selectedOptions ? ' (' + orderItemOptionsSummary(i) + ')' : ''}${orderItemNotesHtml(i)} ×${i.qty}`).join('<br>')}</td>
        <td><strong>${o.total.toLocaleString('ar-SA')} ${currency}</strong></td>
        <td>
          <span class="status-badge status-${o.status}">${statusText(o.status, o.orderType)}</span>
        </td>
        <td>
          <div style="font-size:0.82rem;color:var(--admin-text2);margin-bottom:6px">${new Date(o.date).toLocaleDateString('ar-SA')}</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button class="topbar-btn btn-outline btn-sm" onclick="openOrderDetails('${o.id}')"><i data-lucide="eye" style="width:14px;height:14px;vertical-align:middle;margin-left:2px"></i> التفاصيل</button>
            <div style="display:inline-flex;gap:6px;flex-wrap:wrap;align-items:center">
              <button class="topbar-btn btn-primary btn-sm" onclick="downloadOrderPdf(this,'${orderKey}','invoice')">فاتورة PDF</button>
              <button class="topbar-btn btn-outline btn-sm" onclick="printOrder('${orderKey}','invoice')">طباعة فاتورة</button>
              <button class="topbar-btn btn-outline btn-sm" onclick="printOrder('${orderKey}','label')">طباعة ليبل</button>
              <button class="topbar-btn btn-outline btn-sm" onclick="downloadOrderPdf(this,'${orderKey}','label')">تحميل PDF</button>
              <button class="topbar-btn btn-outline btn-sm" onclick="printOrder('${orderKey}','packing')">طباعة Packing</button>
              <button class="topbar-btn btn-outline btn-sm" onclick="printOrder('${orderKey}','kitchen')">🍳 طباعة تذكرة</button>
            </div>
            <button class="topbar-btn btn-danger btn-sm action-delete_orders" onclick="confirmDeleteOrder('${o.id}')"><i data-lucide="trash-2" style="width:14px;height:14px;vertical-align:middle;margin-left:2px"></i> حذف</button>
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

function printProductLabel(productId) {
  window.open(`/product-label?id=${productId}`, '_blank');
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

async function downloadProductLabelPdf(button, productId) {
  if (!productId) return;
  return withLock(`download-product-label-${productId}`, async () => {
    const originalHtml = button ? button.innerHTML : '';
    if (button) {
      button.disabled = true;
      button.classList.add('btn-loading');
      button.innerHTML = 'جارٍ التنزيل...';
    }
    try {
      const res = await API.downloadProductLabelPdf(productId);
      if (!res.success) {
        throw new Error(res.message || 'فشل تنزيل PDF');
      }
      const filename = `PRODUCT-LABEL-${productId}.pdf`;
      downloadBlobFile(res.blob, filename);
      showAdminToast('تم تنزيل الملف بنجاح');
    } catch (err) {
      console.error('[PRODUCT LABEL PDF DOWNLOAD]', err);
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
  const [orders, store, users, products] = await Promise.all([
    API.getOrders(),
    API.getStoreSettings(),
    API.getUsers(),
    API.getProducts()
  ]);
  const order = findOrderByIdentifier(orders, orderId);
  if (!order) return;
  currentViewOrder = order;

  const currency = store.currencySymbol || store.currency || 'USD';

  // 1. Populate Order Header Card
  const headerCardEl = $a('om-header-card');
  if (headerCardEl) {
    const statusLabels = {
      pending: 'قيد الانتظار',
      confirmed: 'تم التأكيد',
      processing: 'جاري التجهيز',
      shipped: 'تم الشحن',
      delivered: 'تم التوصيل',
      cancelled: 'ملغي'
    };
    
    const statusColors = {
      pending: '#f59e0b',    // Orange
      confirmed: '#3b82f6',  // Blue
      processing: '#8b5cf6', // Purple
      shipped: '#06b6d4',    // Cyan
      delivered: '#10b981',  // Green
      cancelled: '#ef4444'   // Red
    };
    
    const badgeColor = statusColors[order.status] || '#64748b';
    const badgeText = statusLabels[order.status] || order.status;
    const createdAt = order.date || '-';
    const lastUpdated = order.lastUpdated ? new Date(order.lastUpdated).toLocaleDateString('ar-SA') : '-';
    
    headerCardEl.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:4px;">
        <span style="font-size:0.8rem; color:var(--admin-text2)">رقم الطلب</span>
        <strong style="font-size:1.05rem; color:var(--admin-text)">${order.id}</strong>
      </div>
      <div style="display:flex; flex-direction:column; gap:4px;">
        <span style="font-size:0.8rem; color:var(--admin-text2)">الحالة الحالية</span>
        <div>
          <span style="background:${badgeColor}22; color:${badgeColor}; border: 1px solid ${badgeColor}44; padding: 3px 8px; border-radius: 4px; font-weight:700; font-size:0.85rem; display:inline-block;">
            ${badgeText}
          </span>
        </div>
      </div>
      <div style="display:flex; flex-direction:column; gap:4px;">
        <span style="font-size:0.8rem; color:var(--admin-text2)">تاريخ الإنشاء</span>
        <strong style="font-size:0.95rem; color:var(--admin-text)">${createdAt}</strong>
      </div>
      <div style="display:flex; flex-direction:column; gap:4px;">
        <span style="font-size:0.8rem; color:var(--admin-text2)">آخر تحديث</span>
        <strong style="font-size:0.95rem; color:var(--admin-text)">${lastUpdated}</strong>
      </div>
      <div style="display:flex; flex-direction:column; gap:4px;">
        <span style="font-size:0.8rem; color:var(--admin-text2)">نوع الطلب</span>
        <strong style="font-size:0.95rem; color:var(--admin-text)">${orderTypeBadgeHtml(order.orderType)}</strong>
      </div>
      <div style="display:flex; flex-direction:column; gap:4px;">
        <span style="font-size:0.8rem; color:var(--admin-text2)">إجمالي الطلب</span>
        <strong style="font-size:1.05rem; color:var(--admin-primary)">${order.total.toLocaleString('ar-SA')} ${currency}</strong>
      </div>
    `;
  }

  // 2. Populate Customer Card
  const custNameEl = $a('om-customer-name');
  if (custNameEl) custNameEl.textContent = order.customer;
  const custPhoneEl = $a('om-customer-phone');
  if (custPhoneEl) custPhoneEl.textContent = order.phone;
  const custAddressEl = $a('om-customer-address');
  if (custAddressEl) custAddressEl.textContent = order.address || 'لا يوجد عنوان تفصيلي';

  const customerActionsEl = $a('om-customer-actions');
  if (customerActionsEl) {
    const cleanPhone = order.phone.replace(/[^0-9]/g, '');
    customerActionsEl.innerHTML = `
      <a href="https://wa.me/${cleanPhone}" target="_blank" class="topbar-btn btn-outline btn-sm btn-active-scale" style="display: flex; align-items: center; gap: 4px; color: #25D366; border-color: #25D366; text-decoration: none; font-weight: 600;">
        <i data-lucide="message-square" style="width:14px; height:14px;"></i> واتساب
      </a>
      <a href="tel:${order.phone}" class="topbar-btn btn-outline btn-sm btn-active-scale" style="display: flex; align-items: center; gap: 4px; color: var(--admin-primary); border-color: var(--admin-primary); text-decoration: none; font-weight: 600;">
        <i data-lucide="phone" style="width:14px; height:14px;"></i> اتصال
      </a>
    `;
  }

  // 3. Populate Products Card
  const productsListEl = $a('om-products-list');
  if (productsListEl) {
    productsListEl.innerHTML = order.items.map(item => {
      const product = products.find(p => String(p.id) === String(item.productId) || p.name === item.name);
      const imageSrc = product ? (product.image || (product.images && product.images[0])) : null;
      const bg = product ? product.bg : 'var(--admin-bg)';
      const emoji = product ? product.emoji : '';
      
      const imgHtml = imageSrc 
        ? `<img src="${imageSrc}" style="width:100%;height:100%;object-fit:cover" />`
        : (emoji ? `<span style="font-size:1.3rem;">${emoji}</span>` : `<i data-lucide="package" style="width:20px;height:20px;opacity:0.5"></i>`);
        
      return `
        <div style="display: flex; gap: 12px; align-items: center; background: var(--admin-bg-alt); padding: 10px; border-radius: 8px; border: 1px solid var(--admin-border);">
          <div style="width: 50px; height: 50px; border-radius: 6px; background: ${bg}; display: flex; align-items: center; justify-content: center; overflow: hidden; flex-shrink: 0;">
            ${imgHtml}
          </div>
          <div style="flex: 1;">
            <div style="font-weight: 700; color: var(--admin-text); font-size: 0.95rem;">${item.name}</div>
            ${item.selectedOptions ? `<div style="font-size: 0.8rem; color: var(--admin-primary); margin-top: 2px;">${orderItemOptionsSummary(item)}</div>` : ''}
            ${item.notes ? `<div style="font-size: 0.8rem; color: var(--admin-danger, #dc3545); margin-top: 2px;">ملاحظة: ${item.notes}</div>` : ''}
            <div style="font-size: 0.85rem; color: var(--admin-text2); margin-top: 2px;">سعر الوحدة: ${item.price.toLocaleString('ar-SA')} ${currency}</div>
          </div>
          <div style="text-align: left;">
            <div style="font-weight: 700; color: var(--admin-text); font-size: 0.95rem;">${(item.price * item.qty).toLocaleString('ar-SA')} ${currency}</div>
            <div style="font-size: 0.85rem; color: var(--admin-text2); margin-top: 2px;">الكمية: ${item.qty}</div>
          </div>
        </div>
      `;
    }).join('');
  }
  
  const totalEl = $a('om-total');
  if (totalEl) totalEl.textContent = `Total: ${order.total.toLocaleString('ar-SA')} ${currency}`;

  // 4. Populate Assignee Dropdown
  const assignSelect = $a('om-assignee');
  if (assignSelect) {
    assignSelect.innerHTML = `<option value="">-- غير معين --</option>` + users.map(u => `<option value="${u.id}">${u.name} (${Auth.getRoleLabel(u.role)})</option>`).join('');
    assignSelect.value = order.assignedTo || '';
  }

  // 5. Populate Status Workflow UI
  renderOrderStatusWorkflow(order);

  // 6. Render Notes
  renderOrderNotes();

  // 7. Render Timeline
  renderOrderTimeline();

  $a('order-modal').classList.add('open');
  if (window.lucide) lucide.createIcons();
  enforceUI_RBAC(); // Hide assign/status updates if not manager
}

function renderOrderNotes() {
  const order = currentViewOrder;
  const list = $a('om-notes-list');
  if (!list) return;
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
  if (!input) return;
  const text = input.value.trim();
  if (!text || !currentViewOrder) return;
  
  const originalText = input.value;
  input.disabled = true;
  const res = await API.addOrderNote(currentViewOrder.id, text);
  input.disabled = false;
  
  if (res && res.success) {
    currentViewOrder = res.order || res.data?.order || res.data || res;
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
  if (!tl) return;
  let events = [];
  
  const statusLabels = {
    pending: 'تم إنشاء الطلب',
    confirmed: 'تم التأكيد',
    processing: 'جاري التجهيز',
    shipped: 'تم الشحن',
    delivered: 'تم التوصيل',
    cancelled: 'ملغي'
  };

  const statusColors = {
    pending: '#f59e0b',
    confirmed: '#3b82f6',
    processing: '#8b5cf6',
    shipped: '#06b6d4',
    delivered: '#10b981',
    cancelled: '#ef4444'
  };

  const statusIcons = {
    pending: 'shopping-cart',
    confirmed: 'check-circle',
    processing: 'package',
    shipped: 'truck',
    delivered: 'heart',
    cancelled: 'x-circle'
  };

  // Creation event
  events.push({
    status: 'تم الطلب بنجاح',
    date: order.date,
    time: '',
    by: 'العميل',
    icon: 'shopping-cart',
    color: '#3b82f6'
  });
  
  // Status history
  if (order.statusHistory && order.statusHistory.length > 0) {
    order.statusHistory.forEach(h => {
      const d = new Date(h.date);
      events.push({
        status: statusLabels[h.status] || h.status,
        date: d.toLocaleDateString('ar-SA'),
        time: d.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }),
        by: Auth.getRoleLabel(h.changedBy) || h.changedBy,
        icon: statusIcons[h.status] || 'refresh-cw',
        color: statusColors[h.status] || '#8b5cf6'
      });
    });
  }

  // Sort by date/time (most recent on top)
  events.reverse();

  tl.innerHTML = events.map(e => `
    <div style="position: relative; padding-bottom: 8px;">
      <div style="position: absolute; right: -21px; top: 4px; width: 10px; height: 10px; border-radius: 50%; background: ${e.color}; border: 2px solid var(--admin-surface); z-index: 1;"></div>
      <div style="font-weight: 700; color: var(--admin-text); font-size: 0.9rem; display: flex; align-items: center; gap: 6px;">
        <i data-lucide="${e.icon}" style="width:14px; height:14px; color:${e.color}"></i> ${e.status}
      </div>
      <div style="font-size: 0.8rem; color: var(--admin-text2); margin-top: 4px; padding-right: 20px;">
        <span>${e.date} ${e.time}</span> • <span style="font-weight: 600;">بواسطة ${e.by}</span>
      </div>
    </div>
  `).join('');
  if (window.lucide) lucide.createIcons();
}

function renderOrderStatusWorkflow(order) {
  const currentDisplay = $a('om-status-current-display');
  const actionsContainer = $a('om-status-workflow-actions');
  if (!currentDisplay || !actionsContainer) return;

  const currentStatus = order.status || 'pending';
  const isPickup = order.orderType && order.orderType !== 'delivery';
  const statusLabels = {
    pending: 'قيد الانتظار',
    confirmed: 'تم التأكيد',
    processing: 'جاري التجهيز',
    shipped: isPickup ? 'جاهز' : 'تم الشحن',
    delivered: isPickup ? 'تم' : 'تم التوصيل',
    cancelled: 'ملغي'
  };

  currentDisplay.textContent = `الحالة الحالية: ${statusLabels[currentStatus] || currentStatus}`;

  let html = '';
  if (currentStatus === 'pending') {
    html = `
      <button class="topbar-btn btn-primary btn-sm btn-active-scale" style="width: 100%; justify-content: center; padding: 10px;" onclick="handleWorkflowStatusTransition('confirmed')">تأكيد الطلب</button>
      <button class="topbar-btn btn-danger btn-sm btn-active-scale" style="width: 100%; justify-content: center; padding: 10px; margin-top: 4px;" onclick="handleWorkflowStatusTransition('cancelled')">إلغاء الطلب</button>
    `;
  } else if (currentStatus === 'confirmed') {
    html = `
      <button class="topbar-btn btn-primary btn-sm btn-active-scale" style="width: 100%; justify-content: center; padding: 10px;" onclick="handleWorkflowStatusTransition('processing')">بدء التجهيز</button>
      <button class="topbar-btn btn-danger btn-sm btn-active-scale" style="width: 100%; justify-content: center; padding: 10px; margin-top: 4px;" onclick="handleWorkflowStatusTransition('cancelled')">إلغاء وإرجاع المخزون</button>
    `;
  } else if (currentStatus === 'processing') {
    html = `
      <button class="topbar-btn btn-primary btn-sm btn-active-scale" style="width: 100%; justify-content: center; padding: 10px;" onclick="handleWorkflowStatusTransition('shipped')">${isPickup ? 'جاهز' : 'تم الشحن'}</button>
      <button class="topbar-btn btn-danger btn-sm btn-active-scale" style="width: 100%; justify-content: center; padding: 10px; margin-top: 4px;" onclick="handleWorkflowStatusTransition('cancelled')">إلغاء وإرجاع المخزون</button>
    `;
  } else if (currentStatus === 'shipped') {
    html = `
      <button class="topbar-btn btn-primary btn-sm btn-active-scale" style="width: 100%; justify-content: center; padding: 10px;" onclick="handleWorkflowStatusTransition('delivered')">${isPickup ? 'تم' : 'تم التوصيل'}</button>
      <button class="topbar-btn btn-danger btn-sm btn-active-scale" style="width: 100%; justify-content: center; padding: 10px; margin-top: 4px;" onclick="handleWorkflowStatusTransition('cancelled')">إلغاء وإرجاع المخزون</button>
    `;
  } else if (currentStatus === 'delivered') {
    html = `<div style="color:#22c55e; font-weight:700; font-size:0.95rem; padding: 10px; background: #22c55e11; border: 1px solid #22c55e33; border-radius: 6px; text-align: center;"><i data-lucide="check-circle" style="width:16px;height:16px;vertical-align:middle;margin-left:4px;color:#22c55e"></i> تم إغلاق الطلب بنجاح</div>`;
  } else if (currentStatus === 'cancelled') {
    html = `<div style="color:#ef4444; font-weight:700; font-size:0.95rem; padding: 10px; background: #ef444411; border: 1px solid #ef444433; border-radius: 6px; text-align: center;"><i data-lucide="x-circle" style="width:16px;height:16px;vertical-align:middle;margin-left:4px;color:#ef4444"></i> تم إلغاء الطلب</div>`;
  }

  actionsContainer.innerHTML = html;
  if (window.lucide) lucide.createIcons();
}

async function handleWorkflowStatusTransition(nextStatus) {
  if (!currentViewOrder) return;
  
  if (nextStatus === 'cancelled') {
    const reasonInput = $a('om-cancel-reason');
    if (reasonInput) reasonInput.value = '';
    const errorEl = $a('om-cancel-reason-error');
    if (errorEl) errorEl.style.display = 'none';
    $a('cancellation-confirm-modal').classList.add('open');
    if (window.lucide) lucide.createIcons();
    return;
  }

  const actionsContainer = $a('om-status-workflow-actions');
  const originalHtml = actionsContainer ? actionsContainer.innerHTML : '';
  if (actionsContainer) actionsContainer.innerHTML = '<span style="font-size: 0.9rem; color: var(--admin-text2);">جاري التحديث...</span>';
  
  const res = await API.updateOrderStatus(currentViewOrder.id, nextStatus);
  if (res && res.success) {
    let toastMsg = 'تم تحديث حالة الطلب بنجاح';
    
    if (nextStatus === 'confirmed') {
      toastMsg = 'تم تأكيد الطلب وخصم المخزون.';
    } else if (nextStatus === 'processing') {
      toastMsg = 'تم بدء تجهيز الطلب.';
    } else if (nextStatus === 'shipped') {
      toastMsg = currentViewOrder.orderType && currentViewOrder.orderType !== 'delivery' ? 'الطلب جاهز.' : 'تم شحن الطلب.';
    } else if (nextStatus === 'delivered') {
      toastMsg = currentViewOrder.orderType && currentViewOrder.orderType !== 'delivery' ? 'تم إنهاء الطلب.' : 'تم تسليم الطلب.';
    }
    
    showAdminToast(toastMsg);
    currentViewOrder = res.order || res.data?.order || res.data || res;
    
    // Refresh components
    const [freshOrders] = await Promise.all([API.getOrders(true)]);
    const updatedOrder = findOrderByIdentifier(freshOrders, currentViewOrder.id);
    if (updatedOrder) currentViewOrder = updatedOrder;

    openOrderDetails(currentViewOrder.id);
    renderOrdersTable();
    updatePendingBadge();
    if (currentAdminPage === 'dashboard') {
      if (isSimplifiedMode) renderMerchantDashboard(); else renderDashboard();
    }
  } else {
    showAdminToast(res?.message || 'لا يمكن الانتقال لهذه الحالة مباشرة.', 'error');
    if (actionsContainer) actionsContainer.innerHTML = originalHtml;
    if (window.lucide) lucide.createIcons();
  }
}

async function submitOrderCancellation() {
  if (!currentViewOrder) return;
  const reasonInput = $a('om-cancel-reason');
  const errorEl = $a('om-cancel-reason-error');
  if (!reasonInput) return;
  
  const reason = reasonInput.value.trim();
  if (!reason) {
    if (errorEl) errorEl.style.display = 'block';
    return;
  }
  if (errorEl) errorEl.style.display = 'none';
  
  closeModal('cancellation-confirm-modal');
  
  const actionsContainer = $a('om-status-workflow-actions');
  if (actionsContainer) actionsContainer.innerHTML = '<span style="font-size: 0.9rem; color: var(--admin-text2);">جاري إلغاء الطلب...</span>';
  
  // 1. Add Note for cancellation reason using existing API
  await API.addOrderNote(currentViewOrder.id, `سبب الإلغاء: ${reason}`);
  
  // 2. Call status update to cancelled
  const res = await API.updateOrderStatus(currentViewOrder.id, 'cancelled');
  if (res && res.success) {
    const freshOrders = await API.getOrders(true);
    const updatedOrder = findOrderByIdentifier(freshOrders, currentViewOrder.id);
    if (updatedOrder) currentViewOrder = updatedOrder;
    
    const toastMsg = currentViewOrder.stockDeducted ? 'تم إلغاء الطلب وإرجاع المخزون.' : 'تم إلغاء الطلب.';
    showAdminToast(toastMsg);
    
    openOrderDetails(currentViewOrder.id);
    renderOrdersTable();
    updatePendingBadge();
    if (currentAdminPage === 'dashboard') {
      if (isSimplifiedMode) renderMerchantDashboard(); else renderDashboard();
    }
  } else {
    showAdminToast(res?.message || 'فشل إلغاء الطلب.', 'error');
    openOrderDetails(currentViewOrder.id); // restore UI
  }
}

async function assignOrderToUser(userId) {
  if (!currentViewOrder) return;
  const res = await API.assignOrderToUser(currentViewOrder.id, userId);
  if (res && res.success) {
    currentViewOrder = res.order || res.data?.order || res.data || res;
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
      tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state" style="margin:20px"><div class="empty-icon"><i data-lucide="users"></i></div><h3>لا يوجد مستخدمين</h3><p>لم يقم أحد بالتسجيل بعد.</p></div></td></tr>`;
      if (window.lucide) lucide.createIcons();
      return;
    }
    const currentRole = Auth.getSession()?.role;
    const isSuper = currentRole === 'super_admin';
    const impTarget = Auth.isImpersonating() ? (Auth.getImpersonationInfo()?.targetUsername || '') : '';
    tbody.innerHTML = users.map(u => {
      const isSelfImpersonated = Auth.isImpersonating() && (u.username === impTarget || u.name === impTarget);
      const showImpersonate = isSuper && u.active !== false && u.role !== 'super_admin' && !Auth.isImpersonating();
      const showEndImpersonate = isSuper && isSelfImpersonated;
      return `
      <tr${isSelfImpersonated ? ' style="background:rgba(220,38,38,0.05);"' : ''}>
        <td><strong>${u.name}</strong>${isSelfImpersonated ? ' <span style="color:#dc2626;font-size:0.75rem;">(جارٍ المحاكاة)</span>' : ''}</td>
        <td>${u.username || ''}</td>
        <td>${u.email}</td>
        <td><span style="color:${Auth.getRoleColor(u.role)}">${Auth.getRoleLabel(u.role)}</span></td>
        <td>${u.createdAt}</td>
        <td><span class="status-badge ${u.active ? 'status-delivered' : 'status-cancelled'}">${u.active ? 'نشط' : 'موقوف'}</span></td>
        <td>
          <div style="display:flex;gap:6px;align-items:center;">
            ${showImpersonate ? `<button class="topbar-btn btn-outline" style="padding:3px 10px;font-size:0.8rem;border-color:#b91c1c;color:#b91c1c;" onclick="startImpersonation('${u.id}')" title="الدخول كـ هذا المستخدم"><i data-lucide="log-in" style="width:14px;height:14px;margin-left:4px;vertical-align:middle;"></i>الدخول كـ</button>` : ''}
            ${showEndImpersonate ? `<button class="topbar-btn btn-outline" style="padding:3px 10px;font-size:0.8rem;border-color:#b91c1c;color:#b91c1c;" onclick="stopImpersonation()" title="إنهاء المحاكاة"><i data-lucide="log-out" style="width:14px;height:14px;margin-left:4px;vertical-align:middle;"></i>إنهاء المحاكاة</button>` : ''}
          </div>
        </td>
      </tr>`;
    }).join('');
    if (window.lucide) lucide.createIcons();
  });
}

// ===== Modals =====
function openModal(id) { $a(id).classList.add('open'); }
function closeModal(id) { $a(id).classList.remove('open'); }

// ===================================================
// ===== SHIPPING ZONES =====
// ===================================================

let _shippingZones = [];
let _editingShippingZoneId = null;

function renderShippingZones() {
  const container = $a('shipping-zones-container');
  if (!container) return;
  if (!_shippingZones.length) {
    container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--admin-text2)">لا توجد مناطق توصيل. أضف منطقة جديدة.</div>';
    return;
  }
  const currSym = '₪';
  container.innerHTML = `
    <div class="admin-table-wrap" style="border:1px solid var(--admin-border);border-radius:12px;overflow:hidden">
      <table class="admin-table" style="width:100%;border-collapse:collapse">
        <thead>
          <tr>
            <th style="padding:12px 16px;text-align:right;background:var(--admin-bg-alt);font-size:0.82rem">اسم المنطقة</th>
            <th style="padding:12px 16px;text-align:right;background:var(--admin-bg-alt);font-size:0.82rem">تكلفة التوصيل</th>
            <th style="padding:12px 16px;text-align:center;background:var(--admin-bg-alt);font-size:0.82rem">الحالة</th>
            <th style="padding:12px 16px;text-align:center;background:var(--admin-bg-alt);font-size:0.82rem">إجراءات</th>
          </tr>
        </thead>
        <tbody>
          ${_shippingZones.map((z, i) => `
            <tr>
              <td style="padding:10px 16px;border-top:1px solid var(--admin-border);font-weight:600">${escapeHtml(z.name)}</td>
              <td style="padding:10px 16px;border-top:1px solid var(--admin-border)">${z.price} ${currSym}</td>
              <td style="padding:10px 16px;border-top:1px solid var(--admin-border);text-align:center">
                <label class="toggle-switch" style="transform:scale(0.8)">
                  <input type="checkbox" ${z.enabled ? 'checked' : ''} onchange="toggleShippingZone('${z.id}')">
                  <span class="slider"></span>
                </label>
              </td>
              <td style="padding:10px 16px;border-top:1px solid var(--admin-border);text-align:center">
                <button class="topbar-btn btn-outline btn-sm" onclick="editShippingZone('${z.id}')" style="padding:4px 8px;font-size:0.75rem"><i data-lucide="edit" style="width:12px;height:12px"></i></button>
                <button class="topbar-btn btn-danger btn-sm" onclick="deleteShippingZone('${z.id}')" style="padding:4px 8px;font-size:0.75rem"><i data-lucide="trash-2" style="width:12px;height:12px"></i></button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
  if (window.lucide) lucide.createIcons();
}

function addShippingZone() {
  _editingShippingZoneId = null;
  $a('shipping-zone-modal-title').textContent = 'إضافة منطقة توصيل';
  $a('sz-name').value = '';
  $a('sz-price').value = '';
  openModal('shipping-zone-modal');
}

function editShippingZone(id) {
  const zone = _shippingZones.find(z => z.id === id);
  if (!zone) return;
  _editingShippingZoneId = id;
  $a('shipping-zone-modal-title').textContent = 'تعديل منطقة توصيل';
  $a('sz-name').value = zone.name;
  $a('sz-price').value = zone.price;
  openModal('shipping-zone-modal');
}

function saveShippingZoneModal() {
  const name = ($a('sz-name')?.value || '').trim();
  const price = parseFloat($a('sz-price')?.value);
  if (!name) { showAdminToast('اسم المنطقة مطلوب', 'error'); return; }
  if (isNaN(price) || price < 0) { showAdminToast('تكلفة التوصيل يجب أن تكون رقماً غير سالب', 'error'); return; }
  const dup = _shippingZones.find(z => z.name === name && z.id !== _editingShippingZoneId);
  if (dup) { showAdminToast('يوجد منطقة بنفس الاسم بالفعل', 'error'); return; }
  if (_editingShippingZoneId) {
    const zone = _shippingZones.find(z => z.id === _editingShippingZoneId);
    if (zone) { zone.name = name; zone.price = price; }
  } else {
    _shippingZones.push({ id: 'zone_' + Date.now(), name, price, enabled: true, sortOrder: _shippingZones.length + 1 });
  }
  closeModal('shipping-zone-modal');
  renderShippingZones();
  showAdminToast('تم حفظ المنطقة');
}

function deleteShippingZone(id) {
  if (!confirm('هل أنت متأكد من حذف هذه المنطقة؟')) return;
  _shippingZones = _shippingZones.filter(z => z.id !== id);
  renderShippingZones();
  showAdminToast('تم حذف المنطقة');
}

function toggleShippingZone(id) {
  const zone = _shippingZones.find(z => z.id === id);
  if (zone) { zone.enabled = !zone.enabled; renderShippingZones(); }
}

// ===================================================
// ===== SETTINGS ENGINE =====
// ===================================================

let _settingsCurrentStoreId = STORE_ID;

async function initSettingsPage() {
  _settingsCurrentStoreId = STORE_ID;

  // Initialize safe tabs first (binds click listeners, shows first tab)
  initSettingsTabsSafe();

  // Dynamically hide settings tabs based on permissions
  const settingsTabsPermissions = {
    identity: 'edit_store_info',
    branding: 'edit_branding',
    regional: 'edit_shipping_settings',
    content: 'edit_legal_pages',
    contact: 'edit_store_info',
    media: 'edit_branding',
    payments: 'edit_payment_settings',
    shipping: 'edit_shipping_settings'
  };

  const tabs = Object.keys(settingsTabsPermissions);
  tabs.forEach(tab => {
    const btn = document.querySelector(`[data-settings-tab="${tab}"]`);
    if (btn) {
      const allowed = Auth.can(settingsTabsPermissions[tab]) || Auth.isSuperAdmin();
      btn.style.display = allowed ? '' : 'none';
    }
  });

  // Populate country selector
  await populateCountrySelector();

  // Load settings for the store
  await loadStoreSettings();
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

  // Shipping Zones
  _shippingZones = (s.shippingZones && s.shippingZones.length) ? JSON.parse(JSON.stringify(s.shippingZones)) : [
    { id: 'zone_westbank', name: 'الضفة الغربية', price: 15, enabled: true, sortOrder: 1 },
    { id: 'zone_jerusalem', name: 'القدس', price: 25, enabled: true, sortOrder: 2 },
    { id: 'zone_arab48', name: 'الداخل 48', price: 35, enabled: true, sortOrder: 3 }
  ];
  renderShippingZones();

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
      shippingZones:  _shippingZones,
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

// Settings Tabs Safe — standalone, no dependencies on async ops, old functions, or permissions
function initSettingsTabsSafe() {
  const buttons = document.querySelectorAll('[data-settings-tab]');
  const panels = document.querySelectorAll('.settings-panel');

  buttons.forEach(btn => {
    btn.addEventListener('click', function() {
      const tab = this.dataset.settingsTab;
      if (!tab) return;

      buttons.forEach(b => b.classList.remove('active'));
      panels.forEach(p => p.classList.remove('active'));

      this.classList.add('active');
      const panel = document.getElementById('settings-panel-' + tab);
      if (panel) {
        panel.classList.add('active');
      } else {
        console.warn('[settings] panel not found: settings-panel-' + tab);
      }
    });
  });

  // Activate first visible tab on init
  const firstVisible = Array.from(buttons).find(b => b.style.display !== 'none');
  if (firstVisible) firstVisible.click();
}

// Legacy — disabled, safe system handles all tab switching
function switchSettingsTab(tab) {}

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

  // Impersonation banner on load
  updateImpersonationBanner();

  // If impersonating, override user header with impersonated user
  if (Auth.isImpersonating()) {
    const impSession = Auth.getSession();
    if (impSession) {
      if (userNameEl) userNameEl.textContent = impSession.name;
      if (userRoleEl) userRoleEl.textContent = Auth.getRoleLabel(impSession.role);
    }
  }

  // Apply UX simplification (sidebar + dashboard toggle)
  applySimplifiedUI();

  // Show toggle button only for super_admin
  const toggleBtn = $a('toggle-simplified-btn');
  if (toggleBtn) toggleBtn.style.display = Auth.isSuperAdmin() ? '' : 'none';

  // Permission-based nav visibility — advanced nav
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

  // Permission-based nav visibility — simplified nav
  const sNavDashboard = $a('nav-s-dashboard');
  const sNavOrders = $a('nav-s-orders');
  const sNavProducts = $a('nav-s-products');
  const sNavDirectSale = $a('nav-s-direct-sale');
  const sNavInvoices = $a('nav-s-invoices');
  const sNavAccounting = $a('nav-s-accounting');
  const sNavSettings = $a('nav-s-settings');
  if (sNavDashboard) sNavDashboard.style.display = Auth.can('view_dashboard') ? '' : 'none';
  if (sNavOrders) sNavOrders.style.display = Auth.can('view_orders') ? '' : 'none';
  if (sNavProducts) sNavProducts.style.display = Auth.can('view_products') ? '' : 'none';
  if (sNavDirectSale) sNavDirectSale.style.display = Auth.can('update_orders') ? '' : 'none';
  if (sNavInvoices) sNavInvoices.style.display = Auth.can('view_orders') ? '' : 'none';
  if (sNavAccounting) sNavAccounting.style.display = '';
  if (sNavSettings) sNavSettings.style.display = Auth.can('view_settings') ? '' : 'none';

  // Set store link for both navs
  const navOpenStore = $a('nav-open-store');
  if (navOpenStore) navOpenStore.href = `index.html?store=${STORE_ID}`;
  const navSOpenStore = $a('nav-s-open-store');
  if (navSOpenStore) navSOpenStore.href = `index.html?store=${STORE_ID}`;

  // Fetch Store Plan & Apply visibility rules
  try {
    const plan = await fetchWithStability('/api/store-plan');
    if (plan) {
      window.storePlan = plan;
      applyStorePlanVisibility();
    }
  } catch (err) {
    console.error("Failed to load store plan on admin panel initialization:", err);
  }

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
  
  // Find first allowed page (simplified order for non-super-admin)
  const pagesOrder = isSimplifiedMode
    ? ['dashboard', 'orders', 'products', 'direct-sale', 'invoices', 'accounting', 'settings']
    : ['dashboard', 'products', 'categories', 'orders', 'users', 'coupons', 'settings'];
  const pagesPermissions = {
    dashboard: 'view_dashboard',
    products: 'view_products',
    categories: 'view_categories',
    orders: 'view_orders',
    'direct-sale': 'update_orders',
    invoices: 'view_orders',
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
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">جاري التحميل...</td></tr>';
  try {
    const users = await API.getUsers();
    if (!users || users.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--admin-text2);">لا يوجد مستخدمين.</td></tr>';
      return;
    }
    
    const currentRole = Auth.getSession()?.role;
    const isSuper = currentRole === 'super_admin';
    const impTarget = Auth.isImpersonating() ? (Auth.getImpersonationInfo()?.targetUsername || '') : '';

    tbody.innerHTML = users.map(u => {
      const roleBadge = Auth.getRoleLabel(u.role);
      const roleColor = Auth.getRoleColor(u.role);
      const isSelfImpersonated = Auth.isImpersonating() && (u.username === impTarget || u.name === impTarget);
      const showImpersonate = isSuper && u.active !== false && u.role !== 'super_admin' && !Auth.isImpersonating();
      const showEndImpersonate = isSuper && isSelfImpersonated;

      return `
        <tr${isSelfImpersonated ? ' style="background:rgba(220,38,38,0.05);"' : ''}>
          <td><div style="font-weight:700;">${u.name}</div>${isSelfImpersonated ? ' <span style="color:#dc2626;font-size:0.75rem;">(جارٍ المحاكاة)</span>' : ''}</td>
          <td><code>${u.username || '-'}</code></td>
          <td>${u.email}</td>
          <td><span class="status-chip" style="background-color:${roleColor}22;color:${roleColor};">${roleBadge}</span></td>
          <td>${u.createdAt || '-'}</td>
          <td>
            <div style="display:flex;gap:10px;align-items:center;">
              <span class="status-chip ${u.active ? 'delivered' : 'cancelled'}">${u.active ? 'نشط' : 'موقوف'}</span>
              <button class="icon-btn action-edit_users" onclick="openEditUser('${u.id}')" title="تعديل" style="color:var(--admin-primary)"><i data-lucide="edit-2" style="width:16px;height:16px"></i></button>
              <button class="icon-btn action-delete_users" onclick="deleteUser('${u.id}')" title="حذف" style="color:#ef4444"><i data-lucide="trash-2" style="width:16px;height:16px"></i></button>
              ${showImpersonate ? `<button class="topbar-btn btn-outline" style="padding:3px 10px;font-size:0.8rem;border-color:#b91c1c;color:#b91c1c;" onclick="startImpersonation('${u.id}')" title="الدخول كـ هذا المستخدم"><i data-lucide="log-in" style="width:14px;height:14px;margin-left:4px;vertical-align:middle;"></i>الدخول كـ</button>` : ''}
              ${showEndImpersonate ? `<button class="topbar-btn btn-outline" style="padding:3px 10px;font-size:0.8rem;border-color:#b91c1c;color:#b91c1c;" onclick="stopImpersonation()" title="إنهاء المحاكاة"><i data-lucide="log-out" style="width:14px;height:14px;margin-left:4px;vertical-align:middle;"></i>إنهاء المحاكاة</button>` : ''}
            </div>
          </td>
        </tr>
      `;
    }).join('');
    if (window.lucide) lucide.createIcons();
    enforceUI_RBAC();
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#ef4444;">حدث خطأ في التحميل.</td></tr>';
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

// ===== Impersonation =====
async function startImpersonation(userId) {
  if (Auth.isImpersonating()) {
    showAdminToast('أنت بالفعل في وضع المحاكاة. أنهِ المحاكاة أولاً.', 'error');
    return;
  }
  const users = await API.getUsers(true);
  const target = users.find(u => String(u.id) === String(userId));
  if (!target) { showAdminToast('المستخدم غير موجود', 'error'); return; }
  if (target.role === 'super_admin') { showAdminToast('لا يمكن محاكاة مستخدم Super Admin', 'error'); return; }

  if (!Auth.startImpersonation(target)) {
    showAdminToast('فشل بدء المحاكاة. يجب أن تكون Super Admin.', 'error');
    return;
  }

  updateImpersonationBanner();
  showAdminToast(`دخلت كمستخدم: ${target.name} (${Auth.getRoleLabel(target.role)})`);
  setTimeout(() => location.reload(), 600);
}

function stopImpersonation() {
  if (!Auth.isImpersonating()) return;
  const impInfo = Auth.getImpersonationInfo();
  Auth.stopImpersonation();
  updateImpersonationBanner();
  if (impInfo) {
    showAdminToast(`تم إنهاء محاكاة المستخدم ${impInfo.targetUsername}`);
  }
  setTimeout(() => location.reload(), 600);
}

function updateImpersonationBanner() {
  const banner = $a('impersonation-banner');
  if (!banner) return;
  if (Auth.isImpersonating()) {
    const imp = Auth.getImpersonationInfo();
    const session = Auth.getSession();
    if (imp && session) {
      $a('imp-banner-target').textContent = session.name || imp.targetUsername;
      $a('imp-banner-role').textContent = Auth.getRoleLabel(session.role);
    }
    banner.style.display = 'block';
  } else {
    banner.style.display = 'none';
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

/* ===== DIRECT SALE FUNCTIONS ===== */

async function initDirectSale() {
  try {
    const products = await API.getProducts();
    const select = $a('direct-sale-product');
    if (!select) return;

    select.innerHTML = '<option value="">-- اختر منتج --</option>';
    
    if (Array.isArray(products)) {
      products.filter(p => p.active !== false).forEach(product => {
        const option = document.createElement('option');
        option.value = product.id;
        option.textContent = `${product.name} (متاح: ${product.stock})`;
        option.dataset.stock = product.stock;
        select.appendChild(option);
      });
    }

    // Add change listener to show stock info
    select.onchange = () => {
      const selectedOption = select.options[select.selectedIndex];
      const stockInfo = $a('direct-sale-stock-info');
      const stockText = $a('direct-sale-stock-text');
      
      if (selectedOption.value) {
        const stock = selectedOption.dataset.stock || 0;
        stockInfo.style.display = 'block';
        stockText.textContent = `المتاح: ${stock} وحدة`;
      } else {
        stockInfo.style.display = 'none';
      }
    };

    await initDirectSaleCustomerSelector();
    await loadDirectSalesLog();
    renderDirectSaleLog();
    if (window.lucide) lucide.createIcons();
  } catch (error) {
    console.error('Error initializing direct sale:', error);
    showAdminToast('فشل تحميل المنتجات', 'error');
  }
}

async function initDirectSaleCustomerSelector() {
  const select = $a('direct-sale-customer');
  if (!select) return;
  const currentVal = select.value;
  select.innerHTML = '<option value="">-- بيع نقدي مباشر --</option>';
  try {
    const res = await fetchWithStability('/api/accounting/customer-summaries?includeNotes=true');
    if (res.success && Array.isArray(res.data)) {
      res.data.forEach(c => {
        if (!c.name) return;
        const key = getCustomerKeyStr(c.name, c.phone || '');
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = c.name + (c.phone ? ' (' + c.phone + ')' : '');
        select.appendChild(opt);
      });
    }
  } catch (err) {
    console.error('Error loading customer selector:', err);
  }
  if (currentVal) select.value = currentVal;
}

function openDsQuickCustomer() {
  $a('ds-qc-name').value = '';
  $a('ds-qc-phone').value = '';
  openModal('ds-quick-customer-modal');
  if (window.lucide) lucide.createIcons();
}

async function saveDsQuickCustomer(btn) {
  const name = $a('ds-qc-name').value.trim();
  const phone = $a('ds-qc-phone').value.trim();
  if (!name) { showAdminToast('الرجاء إدخال اسم العميل', 'error'); return; }
  const key = getCustomerKeyStr(name, phone);
  const originalHtml = btn.innerHTML;
  btn.classList.add('btn-loading');
  btn.innerHTML = 'جاري الحفظ...';
  try {
    const res = await fetchWithStability('/api/accounting/customer-notes', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key, name, phone,
        notes: [],
        tags: ['عميل مباشر'],
        lastContactAt: null,
        lastContactNote: null
      })
    });
    if (res.success) {
      closeModal('ds-quick-customer-modal');
      showAdminToast('تم إضافة العميل بنجاح', 'success');
      await initDirectSaleCustomerSelector();
      const select = $a('direct-sale-customer');
      if (select) select.value = key;
    } else {
      showAdminToast(res.message || 'فشل حفظ العميل', 'error');
    }
  } catch (err) {
    console.error('Error saving quick customer:', err);
    showAdminToast('فشل حفظ العميل', 'error');
  } finally {
    btn.innerHTML = originalHtml;
    btn.classList.remove('btn-loading');
  }
}

async function registerDirectSale() {
  withLock('direct-sale-register', async () => {
    try {
      const productId = $a('direct-sale-product').value;
      const quantity = parseInt($a('direct-sale-quantity').value, 10);
      const salePrice = Number($a('direct-sale-price').value);
      const note = ($a('direct-sale-note').value || '').trim();
      const customerSelector = $a('direct-sale-customer');
      let customerName = '', customerPhone = '', customerAddress = '';
      if (customerSelector && customerSelector.value) {
        const parts = customerSelector.value.split('|');
        customerName = parts[0] || '';
        customerPhone = parts[1] || '';
      }

      if (!productId || !quantity || quantity <= 0 || !salePrice || salePrice <= 0) {
        showAdminToast('يرجى ملء جميع الحقول المطلوبة بشكل صحيح', 'error');
        return;
      }

      const response = await fetchWithStability('/api/direct-sale', {
        method: 'POST',
        body: JSON.stringify({
          productId: parseInt(productId, 10),
          quantity,
          salePrice,
          note,
          customerName,
          customerPhone,
          customerAddress
        }),
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.success) {
        showAdminToast(`✓ تم تسجيل البيع: ${response.productName} - ${response.soldQuantity} وحدة`);

        // Reset form and refresh
        $a('direct-sale-product').value = '';
        $a('direct-sale-quantity').value = '';
        $a('direct-sale-price').value = '';
        $a('direct-sale-note').value = '';
        $a('direct-sale-customer').value = '';
        $a('direct-sale-stock-info').style.display = 'none';

        directSaleLog.unshift({
          id: response.saleRecord?.id || null,
          productId: response.saleRecord?.productId || parseInt(productId, 10),
          productName: response.productName,
          quantity: response.soldQuantity,
          listedPrice: response.saleRecord?.listedPrice || response.listedPrice || 0,
          salePrice: response.saleRecord?.salePrice || salePrice,
          total: response.saleRecord?.total || (response.soldQuantity * salePrice),
          customerName: response.saleRecord?.customerName || customerName,
          customerPhone: response.saleRecord?.customerPhone || customerPhone,
          customerAddress: response.saleRecord?.customerAddress || customerAddress,
          note: response.saleRecord?.note || note,
          saleStatus: response.saleRecord?.saleStatus || 'completed',
          newStock: response.newStock,
          timestamp: new Date().toLocaleTimeString('ar-SA'),
          date: new Date().toLocaleDateString('ar-SA')
        });

        // Keep only last 50 entries
        if (directSaleLog.length > 50) directSaleLog.pop();

        // Re-initialize dropdown with updated stocks
        await initDirectSale();
        
        // Refresh products in page
        if (window.appState) appState.products = null;
      } else {
        showAdminToast(response.message || 'فشل تسجيل البيع', 'error');
      }
    } catch (error) {
      console.error('Error registering direct sale:', error);
      showAdminToast('حدث خطأ أثناء تسجيل البيع', 'error');
    }
  });
}

function renderDirectSaleLog() {
  const logContainer = $a('direct-sale-log');
  if (!logContainer) return;

  if (directSaleLog.length === 0) {
    logContainer.innerHTML = `
      <tr>
        <td colspan="8" style="padding:24px;text-align:center;color:var(--admin-text2);font-size:13px;">
          لا توجد عمليات بيع بعد
        </td>
      </tr>
    `;
    return;
  }

  logContainer.innerHTML = directSaleLog.map((sale) => {
    const isCancelled = sale.saleStatus === 'cancelled';
    const statusText = isCancelled ? 'ملغي' : 'مكتمل';
    const statusStyle = isCancelled 
      ? 'background:rgba(239, 68, 68, 0.1);color:var(--admin-danger);padding:4px 8px;border-radius:12px;font-size:12px;font-weight:600;display:inline-block;' 
      : 'background:rgba(16, 185, 129, 0.1);color:#10b981;padding:4px 8px;border-radius:12px;font-size:12px;font-weight:600;display:inline-block;';

    const customerDisplay = sale.customerName 
      ? `${escapeHtml(sale.customerName)} ${sale.customerPhone ? `(${escapeHtml(sale.customerPhone)})` : ''}`
      : '<span style="color:var(--admin-text2);font-style:italic;">زبون معرض</span>';

    const editBtn = isCancelled 
      ? '' 
      : `<button class="topbar-btn btn-outline" style="padding:4px 8px;font-size:12px;display:inline-flex;align-items:center;gap:4px;" onclick="openEditDirectSaleCustomer(${sale.id})"><i data-lucide="user-cog" style="width:12px;height:12px;"></i> تعديل</button>`;

    const cancelBtn = isCancelled 
      ? '' 
      : `<button class="topbar-btn btn-danger" style="padding:4px 8px;font-size:12px;display:inline-flex;align-items:center;gap:4px;" onclick="openCancelDirectSale(${sale.id})"><i data-lucide="x-circle" style="width:12px;height:12px;"></i> إلغاء</button>`;

    return `
      <tr style="${isCancelled ? 'opacity:0.7;background:rgba(239, 68, 68, 0.02);' : ''}">
        <td style="font-weight:600;">#${sale.id}</td>
        <td style="font-size:12px;color:var(--admin-text2);">${sale.date} ${sale.timestamp}</td>
        <td style="font-weight:600;color:var(--admin-text);">${escapeHtml(sale.productName)}</td>
        <td>${sale.quantity} وحدة</td>
        <td style="font-weight:600;">${Number(sale.total).toLocaleString('ar-SA')} ₪</td>
        <td style="font-size:12px;">${customerDisplay}</td>
        <td>
          <span style="${statusStyle}">${statusText}</span>
        </td>
        <td>
          <div style="display:flex;gap:6px;align-items:center;">
            <button class="topbar-btn btn-primary" style="padding:4px 8px;font-size:12px;display:inline-flex;align-items:center;gap:4px;" onclick="openDirectSaleDetails(${sale.id})"><i data-lucide="eye" style="width:12px;height:12px;"></i> تفاصيل</button>
            ${editBtn}
            ${cancelBtn}
          </div>
        </td>
      </tr>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons();
}

function openDirectSaleDetails(saleId) {
  const sale = directSaleLog.find(s => s.id === saleId);
  if (!sale) return;

  const grid = $a('ds-details-grid');
  if (!grid) return;

  const isCancelled = sale.saleStatus === 'cancelled';

  grid.innerHTML = `
    <div>
      <span style="font-size:12px;color:var(--admin-text2);">رقم العملية</span>
      <div style="font-weight:600;font-size:1.1rem;margin-top:2px;">#${sale.id}</div>
    </div>
    <div>
      <span style="font-size:12px;color:var(--admin-text2);">تاريخ العملية</span>
      <div style="font-weight:600;margin-top:2px;">${sale.date} ${sale.timestamp}</div>
    </div>
    <div>
      <span style="font-size:12px;color:var(--admin-text2);">اسم المنتج</span>
      <div style="font-weight:600;margin-top:2px;color:var(--admin-primary);">${escapeHtml(sale.productName)}</div>
    </div>
    <div>
      <span style="font-size:12px;color:var(--admin-text2);">الكمية المباعة</span>
      <div style="font-weight:600;margin-top:2px;">${sale.quantity} وحدة</div>
    </div>
    <div>
      <span style="font-size:12px;color:var(--admin-text2);">السعر الفعلي للوحدة</span>
      <div style="font-weight:600;margin-top:2px;">${Number(sale.salePrice).toLocaleString('ar-SA')} ₪</div>
    </div>
    <div>
      <span style="font-size:12px;color:var(--admin-text2);">المبلغ الإجمالي</span>
      <div style="font-weight:600;margin-top:2px;color:var(--admin-text);">${Number(sale.total).toLocaleString('ar-SA')} ₪</div>
    </div>
    <div>
      <span style="font-size:12px;color:var(--admin-text2);">اسم الزبون</span>
      <div style="font-weight:600;margin-top:2px;">${escapeHtml(sale.customerName) || '-'}</div>
    </div>
    <div>
      <span style="font-size:12px;color:var(--admin-text2);">رقم الهاتف</span>
      <div style="font-weight:600;margin-top:2px;">${escapeHtml(sale.customerPhone) || '-'}</div>
    </div>
    <div style="grid-column: span 2;">
      <span style="font-size:12px;color:var(--admin-text2);">العنوان</span>
      <div style="font-weight:600;margin-top:2px;">${escapeHtml(sale.customerAddress) || '-'}</div>
    </div>
    <div>
      <span style="font-size:12px;color:var(--admin-text2);">حالة العملية</span>
      <div style="margin-top:2px;">
        <span style="${isCancelled 
          ? 'background:rgba(239, 68, 68, 0.1);color:var(--admin-danger);padding:4px 8px;border-radius:12px;font-size:12px;font-weight:600;' 
          : 'background:rgba(16, 185, 129, 0.1);color:#10b981;padding:4px 8px;border-radius:12px;font-size:12px;font-weight:600;'}">
          ${isCancelled ? 'ملغية' : 'مكتملة'}
        </span>
      </div>
    </div>
  `;

  const noteElement = $a('ds-details-note');
  if (noteElement) {
    noteElement.textContent = sale.note || 'لا توجد ملاحظات';
  }

  const cancellationSection = $a('ds-details-cancellation-section');
  if (cancellationSection) {
    if (isCancelled) {
      cancellationSection.style.display = 'block';
      $a('ds-details-cancelled-by').textContent = sale.cancelledBy || '-';
      $a('ds-details-cancelled-at').textContent = sale.cancelledAt ? new Date(sale.cancelledAt).toLocaleString('ar-SA') : '-';
      $a('ds-details-cancelled-reason').textContent = sale.cancelReason || '-';
    } else {
      cancellationSection.style.display = 'none';
    }
  }

  $a('direct-sale-details-modal').classList.add('open');
  if (window.lucide) lucide.createIcons();
}

function openEditDirectSaleCustomer(saleId) {
  const sale = directSaleLog.find(s => s.id === saleId);
  if (!sale) return;

  $a('ds-edit-id').value = sale.id;
  $a('ds-edit-name').value = sale.customerName || '';
  $a('ds-edit-phone').value = sale.customerPhone || '';
  $a('ds-edit-address').value = sale.customerAddress || '';
  $a('ds-edit-note').value = sale.note || '';

  $a('direct-sale-edit-modal').classList.add('open');
  if (window.lucide) lucide.createIcons();
}

async function submitDirectSaleEdit() {
  const saleId = $a('ds-edit-id').value;
  const customerName = $a('ds-edit-name').value.trim();
  const customerPhone = $a('ds-edit-phone').value.trim();
  const customerAddress = $a('ds-edit-address').value.trim();
  const note = $a('ds-edit-note').value.trim();

  if (!saleId) return;

  try {
    const response = await fetchWithStability(`/api/direct-sales/${saleId}`, {
      method: 'PUT',
      body: JSON.stringify({
        customerName,
        customerPhone,
        customerAddress,
        note
      }),
      headers: { 'Content-Type': 'application/json' }
    });

    if (response.success) {
      showAdminToast('✓ تم تحديث بيانات الزبون بنجاح');
      closeModal('direct-sale-edit-modal');
      
      const idx = directSaleLog.findIndex(s => String(s.id) === String(saleId));
      if (idx !== -1 && response.saleRecord) {
        directSaleLog[idx].customerName = response.saleRecord.customerName;
        directSaleLog[idx].customerPhone = response.saleRecord.customerPhone;
        directSaleLog[idx].customerAddress = response.saleRecord.customerAddress;
        directSaleLog[idx].note = response.saleRecord.note;
      }

      renderDirectSaleLog();
    } else {
      showAdminToast(response.message || 'فشل تحديث بيانات الزبون', 'error');
    }
  } catch (error) {
    console.error('Error updating direct sale customer info:', error);
    showAdminToast('حدث خطأ أثناء التحديث', 'error');
  }
}

function openCancelDirectSale(saleId) {
  const sale = directSaleLog.find(s => s.id === saleId);
  if (!sale) return;

  $a('ds-cancel-id').value = sale.id;
  $a('ds-cancel-reason').value = '';
  $a('ds-cancel-reason-error').style.display = 'none';

  $a('direct-sale-cancel-modal').classList.add('open');
  if (window.lucide) lucide.createIcons();
}

async function submitDirectSaleCancellation() {
  const saleId = $a('ds-cancel-id').value;
  const cancelReason = $a('ds-cancel-reason').value.trim();

  if (!cancelReason) {
    $a('ds-cancel-reason-error').style.display = 'block';
    return;
  } else {
    $a('ds-cancel-reason-error').style.display = 'none';
  }

  try {
    const response = await fetchWithStability(`/api/direct-sales/${saleId}/cancel`, {
      method: 'PUT',
      body: JSON.stringify({ cancelReason }),
      headers: { 'Content-Type': 'application/json' }
    });

    if (response.success) {
      showAdminToast('✓ تم إلغاء عملية البيع بنجاح وإعادة المخزون');
      closeModal('direct-sale-cancel-modal');
      
      const idx = directSaleLog.findIndex(s => String(s.id) === String(saleId));
      if (idx !== -1 && response.saleRecord) {
        directSaleLog[idx].saleStatus = response.saleRecord.saleStatus;
        directSaleLog[idx].cancelReason = response.saleRecord.cancelReason;
        directSaleLog[idx].cancelledAt = response.saleRecord.cancelledAt;
        directSaleLog[idx].cancelledBy = response.saleRecord.cancelledBy;
      }

      await initDirectSale();
      if (window.appState) appState.products = null;
    } else {
      showAdminToast(response.message || 'فشل إلغاء عملية البيع', 'error');
    }
  } catch (error) {
    console.error('Error cancelling direct sale:', error);
    showAdminToast('حدث خطأ أثناء إلغاء عملية البيع', 'error');
  }
}

// ===== Stock Receiving (Phase 27) =====
async function initStockReceiving() {
  try {
    const products = await API.getProducts();
    const select = $a('sr-product-select');
    if (!select) return;

    select.innerHTML = '<option value="">-- اختر منتج --</option>';
    
    if (Array.isArray(products)) {
      products.filter(p => p.active !== false).forEach(product => {
        const option = document.createElement('option');
        option.value = product.id;
        option.textContent = `${product.name} (المتاح: ${product.stock})`;
        option.dataset.stock = product.stock;
        option.dataset.costPrice = product.costPrice || 0;
        select.appendChild(option);
      });
    }

    await loadStockReceipts();
    renderStockReceiptsLog();
    if (window.lucide) lucide.createIcons();
  } catch (error) {
    console.error('Error initializing stock receiving:', error);
    showAdminToast('فشل تحميل المنتجات', 'error');
  }
}

async function openAddStockReceipt() {
  const modal = $a('stock-receipt-modal');
  const select = $a('sr-product-select');
  
  // Reset form
  $a('sr-quantity').value = '';
  $a('sr-unitCost').value = '';
  $a('sr-supplier').value = '';
  $a('sr-note').value = '';
  
  if (modal) modal.classList.add('open');
  if (window.lucide) lucide.createIcons();
}

async function saveStockReceipt(btn) {
  withLock('stock-receipt-save', async () => {
    try {
      const productId = parseInt($a('sr-product-select').value, 10);
      const quantity = parseInt($a('sr-quantity').value, 10);
      const unitCost = Number($a('sr-unitCost').value);
      const supplier = ($a('sr-supplier').value || '').trim();
      const note = ($a('sr-note').value || '').trim();

      if (!productId || !quantity || quantity <= 0 || unitCost < 0) {
        showAdminToast('يرجى ملء الحقول المطلوبة بشكل صحيح', 'error');
        return;
      }

      const originalText = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<i data-lucide="loader-2" style="width:14px;height:14px;vertical-align:middle;margin-left:4px;animation:spin 1s linear infinite"></i> جاري الحفظ...';

      const response = await fetchWithStability('/api/stock-receipts', {
        method: 'POST',
        body: JSON.stringify({
          productId,
          quantity,
          unitCost,
          supplier,
          note
        }),
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.success) {
        showAdminToast(`✓ تم تسجيل التوريد: ${response.productName} - ${response.receipt.quantity} وحدة`);

        // Close modal and reset form
        closeModal('stock-receipt-modal');
        $a('sr-product-select').value = '';
        $a('sr-quantity').value = '';
        $a('sr-unitCost').value = '';
        $a('sr-supplier').value = '';
        $a('sr-note').value = '';

        // Add to log
        stockReceiptsLog.unshift({
          id: response.receipt.id,
          productName: response.productName,
          quantity: response.receipt.quantity,
          unitCost: response.receipt.unitCost,
          supplier: response.receipt.supplier,
          note: response.receipt.note,
          newStock: response.newStock,
          newCostPrice: response.newCostPrice,
          timestamp: new Date().toLocaleTimeString('ar-SA'),
          date: new Date().toLocaleDateString('ar-SA')
        });

        // Keep only last 20 entries
        if (stockReceiptsLog.length > 20) stockReceiptsLog.pop();

        renderStockReceiptsLog();
      } else {
        showAdminToast(response.message || 'فشل تسجيل التوريد', 'error');
      }
    } catch (error) {
      console.error('Error saving stock receipt:', error);
      showAdminToast('حدث خطأ أثناء حفظ التوريد', 'error');
    } finally {
      btn.innerHTML = originalText;
      btn.disabled = false;
      if (window.lucide) lucide.createIcons();
    }
  });
}

async function loadStockReceipts() {
  try {
    const response = await fetchWithStability('/api/stock-receipts');
    if (Array.isArray(response)) {
      stockReceiptsLog = response.map(receipt => ({
        ...receipt,
        timestamp: receipt.createdAt ? new Date(receipt.createdAt).toLocaleTimeString('ar-SA') : '',
        date: receipt.createdAt ? new Date(receipt.createdAt).toLocaleDateString('ar-SA') : ''
      }));
    }
  } catch (error) {
    console.error('Error loading stock receipts:', error);
    stockReceiptsLog = [];
  }
}

function renderStockReceiptsLog() {
  const logContainer = $a('stock-receipts-log');
  const sym = '₪'; // Shekels
  
  if (!logContainer) return;

  if (!stockReceiptsLog || stockReceiptsLog.length === 0) {
    logContainer.innerHTML = `
      <div style="padding:24px;text-align:center;color:var(--admin-text2);font-size:13px;">
        لا توجد توريدات بعد
      </div>
    `;
    return;
  }

  logContainer.innerHTML = stockReceiptsLog.map((receipt, idx) => `
    <div style="padding:12px 16px;border-bottom:1px solid var(--admin-border);display:flex;flex-direction:column;gap:8px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;">
        <div>
          <div style="font-weight:600;color:var(--admin-text);">${escapeHtml(receipt.productName)}</div>
          <div style="font-size:12px;color:var(--admin-text2);">${receipt.date} - ${receipt.timestamp}</div>
          ${receipt.supplier ? `<div style="font-size:12px;color:var(--admin-text2);">المورد: ${escapeHtml(receipt.supplier)}</div>` : ''}
        </div>
        <div style="text-align:right;min-width:120px;">
          <div style="font-size:12px;color:var(--admin-text2);">تكلفة الوحدة</div>
          <div style="font-weight:600;color:var(--admin-text);">${Number(receipt.unitCost).toLocaleString('ar-SA')} ${sym}</div>
        </div>
      </div>
      <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:12px;">
        <div style="min-width:110px;">
          <div style="font-size:12px;color:var(--admin-text2);">الكمية الواردة</div>
          <div style="font-weight:600;color:var(--admin-text);">${receipt.quantity} وحدة</div>
        </div>
        <div style="min-width:110px;">
          <div style="font-size:12px;color:var(--admin-text2);">المتاح بعده</div>
          <div style="font-weight:600;color:var(--admin-text);">${receipt.newStock != null ? `${receipt.newStock} وحدة` : '-'}</div>
        </div>
        <div style="min-width:110px;">
          <div style="font-size:12px;color:var(--admin-text2);">التكلفة الجديدة</div>
          <div style="font-weight:600;color:var(--admin-text);">${Number(receipt.newCostPrice).toLocaleString('ar-SA')} ${sym}</div>
        </div>
      </div>
      ${receipt.note ? `<div style="font-size:12px;color:var(--admin-text2);">ملاحظة: ${escapeHtml(receipt.note)}</div>` : ''}
    </div>
  `).join('');
}

// ===== Store Plan Management & Visibility (Phase 32B) =====
async function initStorePlanPage() {
  try {
    const plan = await fetchWithStability('/api/store-plan');
    if (plan && plan.modules) {
      window.storePlan = plan;
      $a('plan-mod-storefront').checked = !!plan.modules.storefront;
      $a('plan-mod-orders').checked = !!plan.modules.orders;
      $a('plan-mod-products').checked = !!plan.modules.products;
      $a('plan-mod-categories').checked = !!plan.modules.categories;
      $a('plan-mod-directSales').checked = !!plan.modules.directSales;
      $a('plan-mod-inventory').checked = !!plan.modules.inventory;
      $a('plan-mod-stockReceiving').checked = !!plan.modules.stockReceiving;
      $a('plan-mod-accounting').checked = !!plan.modules.accounting;
      $a('plan-mod-coupons').checked = !!plan.modules.coupons;
      $a('plan-mod-users').checked = !!plan.modules.users;
      $a('plan-mod-settings').checked = !!plan.modules.settings;
      $a('plan-mod-paymentSettings').checked = !!plan.modules.paymentSettings;
      $a('plan-mod-pricing').checked = !!plan.modules.pricing;
      $a('plan-mod-checkout-enabled').checked = !!(plan.checkout && plan.checkout.enabled);
    }
  } catch (err) {
    console.error('Error loading store plan page settings:', err);
    showAdminToast('فشل تحميل إعدادات خطة المتجر', 'error');
  }
}

async function saveStorePlan(btn) {
  const originalText = btn.innerHTML;
  btn.innerHTML = '<i data-lucide="loader" style="width:14px;height:14px;vertical-align:middle;margin-left:4px;animation:spin 1s linear infinite"></i> جاري الحفظ...';
  btn.disabled = true;

  const payload = {
    planName: 'custom_plan',
    modules: {
      storefront: $a('plan-mod-storefront').checked,
      orders: $a('plan-mod-orders').checked,
      products: $a('plan-mod-products').checked,
      categories: $a('plan-mod-categories').checked,
      directSales: $a('plan-mod-directSales').checked,
      inventory: $a('plan-mod-inventory').checked,
      stockReceiving: $a('plan-mod-stockReceiving').checked,
      accounting: $a('plan-mod-accounting').checked,
      coupons: $a('plan-mod-coupons').checked,
      users: $a('plan-mod-users').checked,
      settings: $a('plan-mod-settings').checked,
      paymentSettings: $a('plan-mod-paymentSettings').checked,
      pricing: $a('plan-mod-pricing').checked
    },
    checkout: {
      enabled: $a('plan-mod-checkout-enabled').checked,
      mode: 'cod_only'
    }
  };

  try {
    const res = await fetchWithStability('/api/store-plan', {
      method: 'PUT',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' }
    });

    if (res && res.success) {
      showAdminToast('✓ تم حفظ خطة المتجر بنجاح');
      window.storePlan = res.plan;
      applyStorePlanVisibility();
      navigateTo('dashboard');
    } else {
      showAdminToast(res?.message || 'فشل حفظ خطة المتجر', 'error');
    }
  } catch (err) {
    console.error('Error saving store plan:', err);
    showAdminToast('حدث خطأ أثناء حفظ الخطة', 'error');
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
    if (window.lucide) lucide.createIcons();
  }
}

function applyStorePlanVisibility() {
  const session = Auth.getSession();
  if (!session) return;

  const isSuperAdmin = Auth.isSuperAdmin();
  const plan = window.storePlan;

  const navStorePlan = $a('nav-store-plan');
  if (navStorePlan) {
    navStorePlan.style.display = isSuperAdmin ? '' : 'none';
  }

  if (!plan || !plan.modules) return;

  const modulePageMap = {
    'products': 'products',
    'categories': 'categories',
    'orders': 'orders',
    'direct-sale': 'directSales',
    'stock-receiving': 'stockReceiving',
    'users': 'users',
    'accounting': 'accounting',
    'coupons': 'coupons',
    'settings': 'settings',
    'open-store': 'storefront'
  };

  Object.keys(modulePageMap).forEach(pageKey => {
    const moduleName = modulePageMap[pageKey];
    const isEnabled = plan.modules[moduleName] !== false;
    const navId = 'nav-' + pageKey;
    const navEl = $a(navId);

    if (navEl) {
      if (isEnabled) {
        const pagesPermissions = {
          'products': 'view_products',
          'categories': 'view_categories',
          'orders': 'view_orders',
          'direct-sale': 'update_orders',
          'users': 'view_users',
          'coupons': 'view_coupons',
          'settings': 'view_settings'
        };
        const requiredPerm = pagesPermissions[pageKey];
        if (!requiredPerm || Auth.can(requiredPerm)) {
          navEl.style.display = '';
        } else {
          navEl.style.display = 'none';
        }
      } else {
        navEl.style.display = isSuperAdmin ? '' : 'none';
      }
    }
  });

  const statOrdersEl = $a('stat-orders');
  if (statOrdersEl) {
    const card = statOrdersEl.closest('.stat-card');
    if (card) {
      const isEnabled = plan.modules.orders !== false;
      card.style.display = (isEnabled || isSuperAdmin) ? '' : 'none';
    }
  }

  const statRevenueEl = $a('stat-revenue');
  if (statRevenueEl) {
    const card = statRevenueEl.closest('.stat-card');
    if (card) {
      const isEnabled = plan.modules.accounting !== false;
      card.style.display = (isEnabled || isSuperAdmin) ? '' : 'none';
    }
  }

  const statProductsEl = $a('stat-products');
  if (statProductsEl) {
    const card = statProductsEl.closest('.stat-card');
    if (card) {
      const isEnabled = plan.modules.products !== false;
      card.style.display = (isEnabled || isSuperAdmin) ? '' : 'none';
    }
  }

  const qaAddProduct = document.querySelector('.qa-btn.action-add_products');
  if (qaAddProduct) {
    const isEnabled = plan.modules.products !== false;
    qaAddProduct.style.display = (isEnabled || isSuperAdmin) ? '' : 'none';
  }
  const qaCoupon = document.querySelector('.qa-btn.action-manage_coupons');
  if (qaCoupon) {
    const isEnabled = plan.modules.coupons !== false;
    qaCoupon.style.display = (isEnabled || isSuperAdmin) ? '' : 'none';
  }
  const qaUser = document.querySelector('.qa-btn.action-add_users');
  if (qaUser) {
    const isEnabled = plan.modules.users !== false;
    qaUser.style.display = (isEnabled || isSuperAdmin) ? '' : 'none';
  }

  const paymentsTabBtn = document.querySelector('#settings-tabs button[data-tab="payments"]');
  if (paymentsTabBtn) {
    const isEnabled = plan.modules.paymentSettings !== false;
    paymentsTabBtn.style.display = (isEnabled || isSuperAdmin) ? '' : 'none';
  }

  const paymentsDisabledWarning = $a('payments-disabled-warning');
  if (paymentsDisabledWarning) {
    const isEnabled = plan.modules.paymentSettings !== false;
    paymentsDisabledWarning.style.display = isEnabled ? 'none' : 'block';
  }

  const isPaymentSettingsEnabled = plan.modules.paymentSettings !== false;
  document.querySelectorAll('#settings-panel-payments input, #settings-panel-payments select').forEach(input => {
    input.disabled = !isPaymentSettingsEnabled;
  });

  // Apply module visibility to simplified nav: storefront
  const nsOpenStore = $a('nav-s-open-store');
  if (nsOpenStore) {
    const sfEnabled = plan.modules.storefront !== false;
    nsOpenStore.style.display = (sfEnabled || isSuperAdmin) ? '' : 'none';
  }

  // Apply module visibility to simplified nav items
  const sModuleNavMap = {
    'products': 'nav-s-products',
    'orders': 'nav-s-orders',
    'direct-sale': 'nav-s-direct-sale',
    'invoices': 'nav-s-invoices',
    'accounting': 'nav-s-accounting',
    'settings': 'nav-s-settings'
  };
  Object.keys(sModuleNavMap).forEach(pageKey => {
    const moduleName = modulePageMap[pageKey];
    if (!moduleName) return;
    const isEnabled = plan.modules[moduleName] !== false;
    const navEl = $a(sModuleNavMap[pageKey]);
    if (navEl) {
      if (isEnabled) {
        const sPerms = { 'products':'view_products','orders':'view_orders','direct-sale':'update_orders','invoices':'view_orders','settings':'view_settings' };
        const requiredPerm = sPerms[pageKey];
        navEl.style.display = (!requiredPerm || Auth.can(requiredPerm)) ? '' : 'none';
      } else {
        navEl.style.display = isSuperAdmin ? '' : 'none';
      }
    }
  });
}

// ===== Invoicing System Integration =====
async function loadInvoices() {
  try {
    const tbody = $a('invoices-table-body');
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:20px;">جاري تحميل الفواتير...</td></tr>`;

    const invResponse = await fetchWithStability('/api/invoices');
    const invoices = (invResponse && invResponse.success && Array.isArray(invResponse.invoices))
      ? invResponse.invoices
      : (Array.isArray(invResponse) ? invResponse : []);
    if (!Array.isArray(invoices)) {
      throw new Error('بيانات الفواتير غير صالحة');
    }

    // Sort by createdAt descending
    invoices.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    renderInvoicesTable(invoices);
  } catch (err) {
    console.error('Error loading invoices:', err);
    showAdminToast(err.message || 'فشل تحميل قائمة الفواتير', 'error');
    const tbody = $a('invoices-table-body');
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--admin-danger);">فشل تحميل الفواتير</td></tr>`;
  }
}

function renderInvoicesTable(invoices) {
  const tbody = $a('invoices-table-body');
  const emptyState = $a('invoices-empty-state');
  if (!tbody) return;

  if (invoices.length === 0) {
    tbody.innerHTML = '';
    if (emptyState) emptyState.style.display = 'block';
    return;
  }

  if (emptyState) emptyState.style.display = 'none';
  tbody.innerHTML = invoices.map(inv => {
    const dateStr = inv.createdAt ? new Date(inv.createdAt).toLocaleDateString('ar-EG') : '—';
    const sourceText = inv.sourceType === 'order' ? 'طلب إلكتروني' : 'بيع مباشر';
    const customerName = inv.customer?.name || 'عميل غير معروف';
    const totalStr = `${Number(inv.total).toFixed(2)} ${inv.snapshot?.currency || ''}`;
    
    const ps = computeInvoicePaymentStatus(inv, _receiptsCache);
    let badgeClass = ps.badgeClass;
    let badgeText = ps.badgeText;

    return `
      <tr>
        <td><strong>${inv.id}</strong></td>
        <td>${dateStr}</td>
        <td><span class="invoice-source-pill ${inv.sourceType}">${sourceText}</span></td>
        <td>${customerName}</td>
        <td><strong>${totalStr}</strong></td>
        <td><span class="status-badge ${badgeClass}">${badgeText}</span></td>
        <td>
          <button class="topbar-btn btn-outline" style="padding: 4px 8px; font-size: 0.85rem;" onclick="viewInvoice('${inv.id}')">
            <i data-lucide="eye" style="width:14px;height:14px;margin-left:4px;vertical-align:middle;"></i>عرض التفاصيل
          </button>
        </td>
      </tr>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons();
}

let _currentPrintInvoice = null;

async function viewInvoice(id) {
  try {
    const response = await fetchWithStability(`/api/invoices/${id}`);
    const inv = (response && response.success && response.data) ? response.data : response;
    if (!inv || !inv.id) {
      throw new Error('الفاتورة غير موجودة');
    }

    _currentPrintInvoice = inv;

    const { snapshot, customer, items, total, status, createdAt, sourceType, sourceId, cancelledAt, cancelReason } = inv;
    const currency = snapshot?.currency || '';
    const subtotal = inv.subtotal ?? (items || []).reduce((sum, item) => sum + Number(item.total || (item.price * item.qty)), 0);
    const shipping = inv.shipping ?? 0;
    const discount = inv.discount ?? 0;

    const contentEl = $a('invoice-view-content');
    if (!contentEl) return;

    contentEl.innerHTML = `
      <div class="invoice-container-premium" style="direction: rtl; font-family: inherit;">
        <div class="invoice-header-premium" style="display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; margin-bottom: 24px;">
          <div class="invoice-store-info">
            ${snapshot?.logo ? `<img src="${snapshot.logo}" alt="Logo" class="invoice-logo" style="max-height:60px;margin-bottom:12px;display:block;" />` : ''}
            <h2 class="invoice-store-name" style="margin:0;font-size:1.4rem;color:var(--admin-text);">${snapshot?.storeName || 'مفروشات EVA'}</h2>
            <p class="invoice-store-meta" style="margin:4px 0 0;font-size:0.85rem;color:var(--admin-subtext);"><i data-lucide="phone" style="width:12px;height:12px;vertical-align:middle;margin-left:4px"></i>${snapshot?.phone || ''}</p>
            <p class="invoice-store-meta" style="margin:4px 0 0;font-size:0.85rem;color:var(--admin-subtext);"><i data-lucide="mail" style="width:12px;height:12px;vertical-align:middle;margin-left:4px"></i>${snapshot?.email || ''}</p>
            <p class="invoice-store-meta" style="margin:4px 0 0;font-size:0.85rem;color:var(--admin-subtext);"><i data-lucide="map-pin" style="width:12px;height:12px;vertical-align:middle;margin-left:4px"></i>${snapshot?.address || ''}</p>
          </div>
          <div class="invoice-meta-info" style="text-align:left;">
            <div class="invoice-badge-status ${status}" style="display:inline-block;padding:4px 10px;border-radius:20px;font-size:0.8rem;font-weight:600;margin-bottom:8px;background:${status === 'cancelled' ? 'rgba(239,68,68,0.15)' : 'rgba(16,185,129,0.15)'};color:${status === 'cancelled' ? 'var(--admin-danger)' : 'var(--admin-success)'};">${status === 'cancelled' ? 'ملغاة' : 'نشطة'}</div>
            <h1 class="invoice-id-title" style="margin:0;font-size:1.6rem;color:var(--admin-text);">${inv.id}</h1>
            <p class="invoice-meta-date" style="margin:8px 0 0;font-size:0.85rem;color:var(--admin-subtext);"><strong>تاريخ الفاتورة:</strong> ${new Date(createdAt).toLocaleString('ar-EG')}</p>
            <p class="invoice-meta-source" style="margin:4px 0 0;font-size:0.85rem;color:var(--admin-subtext);"><strong>المصدر:</strong> ${sourceType === 'order' ? 'طلب إلكتروني' : 'بيع مباشر'} (#${sourceId})</p>
          </div>
        </div>

        <div class="invoice-divider" style="height:1px;background:var(--admin-border);margin:20px 0;"></div>

        <div class="invoice-client-section" style="margin-bottom:20px;">
          <h3 class="invoice-section-title" style="margin:0 0 10px 0;font-size:1.05rem;color:var(--admin-text);font-weight:600;">بيانات العميل</h3>
          <div class="invoice-client-card" style="padding:15px;background:var(--admin-bg);border:1px solid var(--admin-border);border-radius:8px;">
            <p style="margin:0;font-size:0.9rem;color:var(--admin-text);"><strong>الاسم:</strong> ${customer?.name || 'عميل غير معروف'}</p>
            <p style="margin:6px 0 0;font-size:0.9rem;color:var(--admin-text);"><strong>الهاتف:</strong> ${customer?.phone || '—'}</p>
            <p style="margin:6px 0 0;font-size:0.9rem;color:var(--admin-text);"><strong>العنوان:</strong> ${customer?.address || '—'}</p>
          </div>
        </div>

        <div class="invoice-items-section" style="margin-bottom:20px;">
          <h3 class="invoice-section-title" style="margin:0 0 10px 0;font-size:1.05rem;color:var(--admin-text);font-weight:600;">تفاصيل المنتجات</h3>
          <table class="invoice-table-premium" style="width:100%;border-collapse:collapse;text-align:right;">
            <thead>
              <tr style="border-bottom:2px solid var(--admin-border);color:var(--admin-subtext);font-size:0.85rem;">
                <th style="padding:10px 8px;">المنتج</th>
                <th style="padding:10px 8px;text-align:center;">السعر</th>
                <th style="padding:10px 8px;text-align:center;">الكمية</th>
                <th style="padding:10px 8px;text-align:left;">المجموع</th>
              </tr>
            </thead>
            <tbody>
              ${(items || []).map(item => `
                <tr style="border-bottom:1px solid var(--admin-border);font-size:0.9rem;color:var(--admin-text);">
                  <td style="padding:12px 8px;"><strong>${item.name}</strong></td>
                  <td style="padding:12px 8px;text-align:center;">${Number(item.price).toFixed(2)} ${currency}</td>
                  <td style="padding:12px 8px;text-align:center;">${item.qty}</td>
                  <td style="padding:12px 8px;text-align:left;font-weight:600;">${Number(item.total || (item.price * item.qty)).toFixed(2)} ${currency}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        <div class="invoice-totals-section" style="display:flex;justify-content:flex-end;margin-bottom:20px;padding:15px;background:var(--admin-bg);border:1px solid var(--admin-border);border-radius:8px;">
          <div style="text-align:left;min-width:200px;">
            <div style="display:flex;justify-content:space-between;padding:4px 0;font-size:0.9rem;color:var(--admin-subtext);"><span>المجموع الفرعي</span><span>${Number(subtotal).toFixed(2)} ${currency}</span></div>
            ${discount > 0 ? `<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:0.9rem;color:var(--admin-subtext);"><span>الخصم</span><span style="color:var(--admin-success)">-${Number(discount).toFixed(2)} ${currency}</span></div>` : ''}
            <div style="display:flex;justify-content:space-between;padding:4px 0;font-size:0.9rem;color:var(--admin-subtext);"><span>الشحن</span><span>${Number(shipping).toFixed(2)} ${currency}</span></div>
            <div style="display:flex;justify-content:space-between;padding:8px 0 4px;border-top:2px solid var(--admin-border);margin-top:4px;font-size:1.1rem;color:var(--admin-text);font-weight:700;"><span>الإجمالي</span><span style="color:var(--admin-primary);font-size:1.3rem;">${Number(total).toFixed(2)} ${currency}</span></div>
          </div>
        </div>

        ${status !== 'cancelled' ? `
        <div class="invoice-payment-section" style="margin-bottom:20px;padding:15px;background:var(--admin-bg);border:1px solid var(--admin-border);border-radius:8px;">
          <h3 class="invoice-section-title" style="margin:0 0 10px 0;font-size:1.05rem;color:var(--admin-text);font-weight:600;">المدفوعات</h3>
          ${(() => {
            const ps = computeInvoicePaymentStatus(inv, _receiptsCache);
            const linkedReceipts = (_receiptsCache || []).filter(r => r.linkedTo === 'invoice' && String(r.linkedId) === String(inv.id) && r.status !== 'cancelled');
            var h = '';
            h += '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px;">';
            h += '<div style="flex:1;min-width:120px;padding:10px;background:var(--admin-bg-alt);border-radius:8px;text-align:center;"><span style="display:block;font-size:0.8rem;color:var(--admin-text2);">المبلغ الإجمالي</span><strong style="font-size:1.1rem;color:var(--admin-text);">' + Number(inv.total).toFixed(2) + ' ' + (inv.snapshot?.currency || '') + '</strong></div>';
            h += '<div style="flex:1;min-width:120px;padding:10px;background:var(--admin-bg-alt);border-radius:8px;text-align:center;"><span style="display:block;font-size:0.8rem;color:var(--admin-text2);">المدفوع</span><strong style="font-size:1.1rem;color:var(--admin-success);">' + ps.totalPaid.toFixed(2) + ' ' + (inv.snapshot?.currency || '') + '</strong></div>';
            h += '<div style="flex:1;min-width:120px;padding:10px;background:var(--admin-bg-alt);border-radius:8px;text-align:center;"><span style="display:block;font-size:0.8rem;color:var(--admin-text2);">المتبقي</span><strong style="font-size:1.1rem;color:' + (ps.remaining > 0 ? 'var(--admin-danger)' : 'var(--admin-success)') + ';">' + ps.remaining.toFixed(2) + ' ' + (inv.snapshot?.currency || '') + '</strong></div>';
            h += '</div>';
            if (linkedReceipts.length > 0) {
              h += '<table class="admin-table" style="width:100%;border-collapse:collapse;font-size:0.85rem;margin-bottom:12px;"><thead><tr style="border-bottom:1px solid var(--admin-border);color:var(--admin-text2);"><th style="padding:6px 8px;text-align:right;">التاريخ</th><th style="padding:6px 8px;text-align:right;">المبلغ</th><th style="padding:6px 8px;text-align:right;">طريقة الدفع</th><th style="padding:6px 8px;text-align:right;">المرجع</th></tr></thead><tbody>';
              linkedReceipts.forEach(r => {
                h += '<tr style="border-bottom:1px solid var(--admin-border-light);"><td style="padding:6px 8px;">' + (r.date ? new Date(r.date).toLocaleDateString('ar-EG') : '—') + '</td><td style="padding:6px 8px;font-weight:600;">' + Number(r.amount).toFixed(2) + ' ' + (inv.snapshot?.currency || '') + '</td><td style="padding:6px 8px;">' + getPaymentMethodText(r.paymentMethod) + '</td><td style="padding:6px 8px;">' + (r.referenceNumber || '—') + '</td></tr>';
              });
              h += '</tbody></table>';
            }
            if (ps.remaining > 0) {
              h += '<button class="topbar-btn btn-primary" onclick="recordInvoicePayment(\'' + inv.id + '\')" style="font-size:0.85rem"><i data-lucide="arrow-down-circle" style="width:14px;height:14px;vertical-align:middle;margin-left:4px"></i>تسديد دفعة</button>';
            }
            return h;
          })()}
        </div>
        ` : ''}

        ${status === 'cancelled' ? `
          <div class="invoice-cancellation-card" style="padding:15px;background:rgba(239,68,68,0.08);border:1px solid var(--admin-danger);border-radius:8px;margin-top:15px;color:var(--admin-danger);">
            <div class="cancellation-header" style="display:flex;align-items:center;gap:8px;font-weight:600;margin-bottom:8px;">
              <i data-lucide="alert-triangle" style="width:18px;height:18px;"></i>
              <span>تم إلغاء هذه الفاتورة تلقائياً</span>
            </div>
            <p style="margin:0;font-size:0.85rem;color:var(--admin-text);"><strong>تاريخ الإلغاء:</strong> ${cancelledAt ? new Date(cancelledAt).toLocaleString('ar-EG') : '—'}</p>
            <p style="margin:4px 0 0;font-size:0.85rem;color:var(--admin-text);"><strong>السبب:</strong> ${cancelReason || 'إلغاء الطلب/البيع المرتبط'}</p>
          </div>
        ` : ''}
      </div>
    `;

    $a('invoice-view-modal').classList.add('open');
    if (window.lucide) lucide.createIcons();
  } catch (err) {
    console.error('Error fetching invoice details:', err);
    showAdminToast(err.message || 'فشل تحميل تفاصيل الفاتورة', 'error');
  }
}

function printInvoice() {
  const inv = _currentPrintInvoice;
  if (!inv || !inv.id) {
    showAdminToast('الرجاء فتح الفاتورة أولاً', 'error');
    return;
  }

  const { snapshot, customer, items, total, status, createdAt, sourceType, sourceId, cancelledAt, cancelReason } = inv;
  const currency = snapshot?.currency || '';
  const sourceLabel = sourceType === 'order' ? 'طلب إلكتروني' : 'بيع مباشر';
  const statusLabel = status === 'cancelled' ? 'ملغاة' : 'نشطة';
  const subtotal = inv.subtotal ?? (items || []).reduce((sum, item) => sum + Number(item.total || (item.price * item.qty)), 0);
  const shipping = inv.shipping ?? 0;
  const discount = inv.discount ?? 0;

  const printEl = $a('invoice-print-container');
  if (!printEl) return;

  printEl.innerHTML = `
    <div class="invoice-print-a4">
      <div class="invoice-print-watermark ${status}">${status === 'cancelled' ? 'فاتورة ملغاة' : ''}</div>
      <div class="invoice-print-header">
        <div class="invoice-print-store">
          ${snapshot?.logo ? `<img src="${snapshot.logo}" alt="Logo" class="invoice-print-logo" />` : ''}
          <div class="invoice-print-store-name">${snapshot?.storeName || ''}</div>
          <div class="invoice-print-store-info">${snapshot?.phone || ''}</div>
          <div class="invoice-print-store-info">${snapshot?.email || ''}</div>
          <div class="invoice-print-store-info">${snapshot?.address || ''}</div>
        </div>
        <div class="invoice-print-meta">
          <div class="invoice-print-id">${inv.id}</div>
          <div class="invoice-print-date">${new Date(createdAt).toLocaleString('ar-EG')}</div>
          <div class="invoice-print-type">${sourceLabel}</div>
          <div class="invoice-print-status ${status}">${statusLabel}</div>
        </div>
      </div>

      <div class="invoice-print-divider"></div>

      <div class="invoice-print-customer">
        <div class="invoice-print-section-title">بيانات العميل</div>
        <table class="invoice-print-customer-table">
          <tr><td class="label">الاسم</td><td>${customer?.name || '—'}</td></tr>
          <tr><td class="label">الهاتف</td><td>${customer?.phone || '—'}</td></tr>
          <tr><td class="label">العنوان</td><td>${customer?.address || '—'}</td></tr>
        </table>
      </div>

      <div class="invoice-print-divider"></div>

      <div class="invoice-print-items">
        <div class="invoice-print-section-title">التفاصيل</div>
        <table class="invoice-print-items-table">
          <thead>
            <tr>
              <th class="col-product">المنتج</th>
              <th class="col-price">سعر الوحدة</th>
              <th class="col-qty">الكمية</th>
              <th class="col-total">المجموع</th>
            </tr>
          </thead>
          <tbody>
            ${(items || []).map(item => `
              <tr>
                <td class="col-product">${item.name}</td>
                <td class="col-price">${Number(item.price).toFixed(2)} ${currency}</td>
                <td class="col-qty">${item.qty}</td>
                <td class="col-total">${Number(item.total || (item.price * item.qty)).toFixed(2)} ${currency}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <div class="invoice-print-totals">
        <table class="invoice-print-totals-table">
          <tr><td class="label">المجموع الفرعي</td><td class="value">${Number(subtotal).toFixed(2)} ${currency}</td></tr>
          <tr><td class="label">الخصم</td><td class="value">${Number(discount).toFixed(2)} ${currency}</td></tr>
          <tr><td class="label">الشحن</td><td class="value">${Number(shipping).toFixed(2)} ${currency}</td></tr>
          <tr class="grand-total"><td class="label">الإجمالي</td><td class="value">${Number(total).toFixed(2)} ${currency}</td></tr>
        </table>
      </div>

      ${status === 'cancelled' ? `
        <div class="invoice-print-cancel-info">
          <div class="invoice-print-section-title">معلومات الإلغاء</div>
          <table class="invoice-print-customer-table">
            <tr><td class="label">تاريخ الإلغاء</td><td>${cancelledAt ? new Date(cancelledAt).toLocaleString('ar-EG') : '—'}</td></tr>
            <tr><td class="label">السبب</td><td>${cancelReason || '—'}</td></tr>
          </table>
        </div>
      ` : ''}

      <div class="invoice-print-footer">
        <div class="invoice-print-footer-text">شكراً لتعاملكم معنا</div>
        <div class="invoice-print-footer-sub">Generated by EVA System</div>
      </div>
    </div>
  `;

  printEl.style.display = 'block';
  setTimeout(() => {
    window.print();
    printEl.style.display = 'none';
  }, 100);
}

function downloadInvoicePdf(btn) {
  const inv = _currentPrintInvoice;
  if (!inv || !inv.id) {
    showAdminToast('الرجاء فتح الفاتورة أولاً', 'error');
    return;
  }
  const originalHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.classList.add('btn-loading');
    btn.innerHTML = 'جارٍ التنزيل...';
  }
  API.downloadInvoicePdf(inv.id).then(res => {
    if (!res.success) {
      throw new Error(res.message || 'فشل تنزيل PDF');
    }
    const filename = `${inv.id}.pdf`;
    downloadBlobFile(res.blob, filename);
    showAdminToast('تم تنزيل PDF بنجاح');
  }).catch(err => {
    console.error('[PDF DOWNLOAD]', err);
    showAdminToast(err.message || 'فشل تنزيل PDF', 'error');
  }).finally(() => {
    if (btn) {
      btn.disabled = false;
      btn.classList.remove('btn-loading');
      btn.innerHTML = originalHtml;
    }
  });
}
