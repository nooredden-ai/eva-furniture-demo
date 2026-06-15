// ==========================================
// STOREFRONT LOGIC (Production-Ready)
// ==========================================

let allProducts = [];
let allCategories = [];
let cart = [];
let currentCategory = 'all';
let storeSettings = null;
let _storeLock = false; // prevent double actions
let appliedCoupon = null; // track applied coupon
let discountAmount = 0; // track discount amount

const ZONES = [
  { id: '', name: 'اختر المنطقة...', fee: 0 },
  { id: 'westbank', name: 'الضفة العربية (Westbank)', fee: 25 },
  { id: 'jerusalem', name: 'القدس (Jerusalem)', fee: 35 },
  { id: 'arab48', name: 'الداخل arab 48', fee: 80 },
];

// DOM Elements
const $ = id => document.getElementById(id);
const AVAILABLE_THEMES = ['calm', 'modern', 'luxury', 'minimal', 'signature', 'noorlabs-signature', 'eva-flow', 'eva-express', 'eva-mega'];

function normalizeThemeName(theme) {
  if (!theme || typeof theme !== 'string') return 'noorlabs-signature';
  const normalized = theme.trim().toLowerCase();
  return AVAILABLE_THEMES.includes(normalized) ? normalized : 'noorlabs-signature';
}

function setThemeStylesheet(theme) {
  const currentTheme = normalizeThemeName(theme);
  const link = document.getElementById('theme-stylesheet');
  if (!link) return;
  link.href = `/themes/${currentTheme}.css`;
  document.documentElement.dataset.theme = currentTheme;
}

const CATEGORY_STORAGE_KEY = 'loulo_categories_v2';

function saveCategoriesToStorage(categories) {
  try {
    localStorage.setItem(CATEGORY_STORAGE_KEY, JSON.stringify(categories));
  } catch (e) {
    console.warn('Unable to cache categories locally', e);
  }
}

function loadCategoriesFromStorage() {
  try {
    const cached = localStorage.getItem(CATEGORY_STORAGE_KEY);
    return cached ? JSON.parse(cached) : [];
  } catch (e) {
    return [];
  }
}

function normalizeCategoryForStore(category) {
  return {
    id: category.id,
    name: category.name || 'غير مصنف',
    image: category.image || '',
    emoji: category.emoji || '',
    parentId: category.parentId && String(category.parentId).trim() ? String(category.parentId).trim() : null,
  };
}

function isRootCategory(category) {
  return !normalizeCategoryForStore(category).parentId;
}

function isAllCategory(category) {
  const id = String(category.id || '').trim().toLowerCase();
  const name = String(category.name || '').trim().toLowerCase();
  return id === 'all' || name === 'الكل' || name === 'all products' || name === 'all';
}

function getCategoryById(id) {
  return allCategories.find(c => c.id === id);
}

function getChildCategories(parentId) {
  return allCategories.filter(c => c.parentId === String(parentId));
}

function getDescendantCategoryIds(parentId) {
  const ids = [];
  const stack = [String(parentId)];
  const visited = new Set();
  while (stack.length) {
    const current = stack.pop();
    if (visited.has(current)) continue;
    visited.add(current);
    if (current !== String(parentId)) ids.push(current);
    const children = getChildCategories(current);
    children.forEach(child => {
      if (!visited.has(child.id)) stack.push(child.id);
    });
  }
  return ids;
}

let currentSubCategory = null;

function selectSubCategory(subCatId) {
  currentSubCategory = subCatId;
  renderSubCategories();
  renderProducts();
  renderBreadcrumb();
}

// ===== Filter State =====
let filterPriceMin = '';
let filterPriceMax = '';
let filterBrand = '';
let filterSize = '';
let filterColor = '';

function getAvailableBrands() {
  const brands = new Set();
  allProducts.forEach(p => { if (p.brand) brands.add(p.brand); });
  return [...brands].sort();
}

function getAvailableSizes() {
  const sizes = new Set();
  allProducts.forEach(p => {
    if (p.size) sizes.add(p.size);
    if (Array.isArray(p.sizes)) p.sizes.forEach(s => sizes.add(s));
  });
  return [...sizes].sort();
}

function getAvailableColors() {
  const colors = new Set();
  allProducts.forEach(p => {
    if (p.color) colors.add(p.color);
    if (Array.isArray(p.colors)) p.colors.forEach(c => colors.add(c));
  });
  return [...colors].sort();
}

function onFilterChange() {
  filterPriceMin = ($('filter-price-min') || {}).value || '';
  filterPriceMax = ($('filter-price-max') || {}).value || '';
  filterBrand = ($('filter-brand') || {}).value || '';
  filterSize = ($('filter-size') || {}).value || '';
  filterColor = ($('filter-color') || {}).value || '';
  renderProducts();
  renderFilters();
}

function resetFilters() {
  filterPriceMin = '';
  filterPriceMax = '';
  filterBrand = '';
  filterSize = '';
  filterColor = '';
  const ids = ['filter-price-min','filter-price-max','filter-brand','filter-size','filter-color'];
  ids.forEach(id => { const el = $(id); if (el) el.value = ''; });
  renderProducts();
  renderFilters();
  closeMobileFilters();
}

function renderFilters() {
  const row = $('filters-row');
  if (!row) return;
  const brands = getAvailableBrands();
  const sizes = getAvailableSizes();
  const colors = getAvailableColors();
  const brandGroup = $('filter-brand-group');
  const sizeGroup = $('filter-size-group');
  const colorGroup = $('filter-color-group');
  const brandSelect = $('filter-brand');
  const sizeSelect = $('filter-size');
  const colorSelect = $('filter-color');
  const resetBtn = $('filter-reset-btn');
  if (brandGroup && brandSelect) {
    if (brands.length) {
      brandGroup.style.display = '';
      brandSelect.innerHTML = '<option value="">الماركة</option>' + brands.map(b => `<option value="${b}" ${filterBrand === b ? 'selected' : ''}>${b}</option>`).join('');
    } else { brandGroup.style.display = 'none'; }
  }
  if (sizeGroup && sizeSelect) {
    if (sizes.length) {
      sizeGroup.style.display = '';
      sizeSelect.innerHTML = '<option value="">المقاس</option>' + sizes.map(s => `<option value="${s}" ${filterSize === s ? 'selected' : ''}>${s}</option>`).join('');
    } else { sizeGroup.style.display = 'none'; }
  }
  if (colorGroup && colorSelect) {
    if (colors.length) {
      colorGroup.style.display = '';
      colorSelect.innerHTML = '<option value="">اللون</option>' + colors.map(c => `<option value="${c}" ${filterColor === c ? 'selected' : ''}>${c}</option>`).join('');
    } else { colorGroup.style.display = 'none'; }
  }
  const hasFilters = filterPriceMin || filterPriceMax || filterBrand || filterSize || filterColor;
  if (resetBtn) resetBtn.style.display = hasFilters ? '' : 'none';
  // Mobile drawer body
  const drawerBody = $('filter-drawer-body');
  if (drawerBody) {
    let html = '';
    html += `<div class="filter-group"><div class="filter-group-title">السعر</div><div class="filter-group filter-group-price">`;
    html += `<input type="number" class="filter-input" id="mob-filter-price-min" placeholder="من" min="0" value="${filterPriceMin}" />`;
    html += `<span class="filter-sep">–</span>`;
    html += `<input type="number" class="filter-input" id="mob-filter-price-max" placeholder="إلى" min="0" value="${filterPriceMax}" />`;
    html += `</div></div>`;
    if (brands.length) {
      html += `<div class="filter-group"><div class="filter-group-title">الماركة</div><select class="filter-select" id="mob-filter-brand"><option value="">الكل</option>`;
      brands.forEach(b => { html += `<option value="${b}" ${filterBrand === b ? 'selected' : ''}>${b}</option>`; });
      html += `</select></div>`;
    }
    if (sizes.length) {
      html += `<div class="filter-group"><div class="filter-group-title">المقاس</div><select class="filter-select" id="mob-filter-size"><option value="">الكل</option>`;
      sizes.forEach(s => { html += `<option value="${s}" ${filterSize === s ? 'selected' : ''}>${s}</option>`; });
      html += `</select></div>`;
    }
    if (colors.length) {
      html += `<div class="filter-group"><div class="filter-group-title">اللون</div><select class="filter-select" id="mob-filter-color"><option value="">الكل</option>`;
      colors.forEach(c => { html += `<option value="${c}" ${filterColor === c ? 'selected' : ''}>${c}</option>`; });
      html += `</select></div>`;
    }
    drawerBody.innerHTML = html;
  }
}

function toggleMobileFilters() {
  const overlay = $('filter-drawer-overlay');
  const drawer = $('filter-drawer');
  if (!overlay || !drawer) return;
  const isOpen = drawer.classList.contains('open');
  if (isOpen) { closeMobileFilters(); } else { openMobileFilters(); }
}

function openMobileFilters() {
  const overlay = $('filter-drawer-overlay');
  const drawer = $('filter-drawer');
  if (overlay) overlay.classList.add('open');
  if (drawer) drawer.classList.add('open');
  renderFilters();
}

function closeMobileFilters() {
  const overlay = $('filter-drawer-overlay');
  const drawer = $('filter-drawer');
  if (overlay) overlay.classList.remove('open');
  if (drawer) drawer.classList.remove('open');
}

function applyMobileFilters() {
  const mMin = $('mob-filter-price-min');
  const mMax = $('mob-filter-price-max');
  const mBrand = $('mob-filter-brand');
  const mSize = $('mob-filter-size');
  const mColor = $('mob-filter-color');
  if (mMin) { filterPriceMin = mMin.value; if ($('filter-price-min')) $('filter-price-min').value = filterPriceMin; }
  if (mMax) { filterPriceMax = mMax.value; if ($('filter-price-max')) $('filter-price-max').value = filterPriceMax; }
  if (mBrand) { filterBrand = mBrand.value; if ($('filter-brand')) $('filter-brand').value = filterBrand; }
  if (mSize) { filterSize = mSize.value; if ($('filter-size')) $('filter-size').value = filterSize; }
  if (mColor) { filterColor = mColor.value; if ($('filter-color')) $('filter-color').value = filterColor; }
  closeMobileFilters();
  renderProducts();
  renderFilters();
}

async function initStore() {
  window.checkoutEnabled = true;
  const overlay = document.getElementById('storefront-disabled-overlay');
  try {
    const planResponse = await fetch('/api/store-plan');
    if (!planResponse.ok) {
      throw new Error(`HTTP error! status: ${planResponse.status}`);
    }
    const plan = await planResponse.json();
    window.storePlan = plan || {};
    if (plan && plan.storefront === false) {
      if (overlay) {
        overlay.style.display = 'flex';
        if (window.lucide) lucide.createIcons();
      }
      return;
    } else {
      if (overlay) {
        overlay.style.display = 'none';
      }
    }
    if (plan && plan.checkoutEnabled === false) {
      window.checkoutEnabled = false;
    }
  } catch (err) {
    console.error('Error fetching store plan:', err);
    if (overlay) {
      overlay.style.display = 'none';
    }
  }

  const container = $('products-container');
  if (container) {
    container.innerHTML = Array(4).fill(0).map(() => `
      <div class="skeleton-card"><div class="skeleton-img skeleton"></div><div class="skeleton-body"><div class="skeleton-title skeleton"></div><div class="skeleton-text skeleton"></div><div class="skeleton-btn skeleton"></div></div></div>
    `).join('');
  }
  try {
    // Graceful Sequential Loading
    const settings = await API.getStoreSettings();
    if (settings) {
      storeSettings = settings;
      window.storeSettings = settings;
      applyStoreSettings(settings);
    }

    const cachedCategories = loadCategoriesFromStorage();
    if (cachedCategories && cachedCategories.length) {
      allCategories = cachedCategories.map(normalizeCategoryForStore);
      renderCategories();
    }

    const categories = await API.getCategories();
    allCategories = (categories || []).map(normalizeCategoryForStore);
    saveCategoriesToStorage(allCategories);

    const products = await API.getProducts();
    allProducts = (products || []).filter(p => p.active !== false);

    renderCategories();
    renderProducts();
    renderFilters();
    loadCartFromStorage();
    populateZones();
    if (window.lucide) lucide.createIcons();

    // Initialize search and promo UI
    setupStoreSearch();
    applyPromoFromSettings(settings || {});
  } catch (error) {
    console.error("Failed to load store data:", error);
    const container = $('products-container');
    if (container) {
      container.innerHTML = `
        <div class="empty-state" style="grid-column: 1/-1">
          <div class="empty-icon"><i data-lucide="wifi-off" style="width:64px;height:64px;opacity:0.4"></i></div>
          <h3>خطأ في التحميل</h3>
          <p>حدث خطأ أثناء تحميل المنتجات. <a href="#" onclick="location.reload()" style="color:var(--primary);text-decoration:underline">إعادة المحاولة</a></p>
        </div>
      `;
      if (window.lucide) lucide.createIcons();
    }
  }
}

// ===== Search =====
let _searchTimer = null;
function setupStoreSearch() {
  const input = document.getElementById('top-search-input');
  const clearBtn = document.getElementById('top-search-clear');
  if (!input) return;
  input.addEventListener('input', (e) => {
    const q = String(e.target.value || '').trim();
    if (clearBtn) clearBtn.style.display = q.length ? 'inline-block' : 'none';
    if (_searchTimer) clearTimeout(_searchTimer);
    _searchTimer = setTimeout(() => searchProducts(q), 300);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      searchProducts(String(input.value || '').trim());
    }
  });
  const searchBtn = document.getElementById('top-search-button');
  if (searchBtn) {
    searchBtn.addEventListener('click', (e) => {
      e.preventDefault();
      searchProducts(String(input.value || '').trim());
    });
  }
  if (clearBtn) clearBtn.addEventListener('click', (e) => {
    e.preventDefault();
    input.value = '';
    clearBtn.style.display = 'none';
    searchProducts('');
  });
}

function searchProducts(q) {
  q = (q || '').toLowerCase();
  showPage('home');
  resetFilters();
  if (!q) { renderProducts(); renderFilters(); return; }
  const container = $('products-container');
  if (!container) return;
  const results = allProducts.filter(p => {
    const categoryName = getCategoryName(p.category).toLowerCase();
    const tags = Array.isArray(p.tags) ? p.tags.join(' ') : String(p.tags || '');
    return String(p.id || '').toLowerCase().includes(q)
      || String(p.name || '').toLowerCase().includes(q)
      || String(p.description || '').toLowerCase().includes(q)
      || tags.toLowerCase().includes(q)
      || categoryName.includes(q)
      || String(p.category || '').toLowerCase().includes(q);
  });
  if (results.length === 0) {
    container.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon"><i data-lucide="search" style="width:64px;height:64px;opacity:0.35"></i></div><h3>لم يتم العثور على نتائج</h3><p>حاول كلمات بحث أُخرى أو تصفح الفئات.</p></div>`;
    if (window.lucide) lucide.createIcons();
    return;
  }
  container.innerHTML = results.map(p => {
    const badgeType = String(p.badge || '').trim().toLowerCase();
    const badgeClass = badgeType === 'تخفيض' ? 'badge-sale' : (badgeType === 'حصري' ? 'badge-exclusive' : 'badge-new');
    const badgeText = badgeType ? p.badge : '';
    return `
      <div class="product-card">
        ${badgeText ? `<div class="product-badge ${badgeClass}">${badgeText}</div>` : ''}
        <div class="product-art">
          <div class="product-img" style="background: ${p.bg || 'var(--bg)'};display:flex;align-items:center;justify-content:center">
            ${p.image || (p.images && p.images[0]) ? `<img src="${p.image || p.images[0]}" alt="${p.name}" />` : (p.emoji && p.emoji.length <= 4 ? `<span class="product-emoji">${p.emoji}</span>` : `<i data-lucide="package" class="product-fallback-icon"></i>`) }
            <div class="product-name-overlay">${p.name}</div>
          </div>
        </div>
        <div class="product-info">
          <div class="product-name">${p.name}</div>
          <div class="product-cat">${getCategoryName(p.category)}</div>
          <div class="product-price">${p.price} <span class="currency">${getCurrency()}</span></div>
          <button class="add-to-cart-btn btn-active-scale" onclick="addToCart(${p.id}, this)">أضف للسلة</button>
        </div>
      </div>
    `;
  }).join('');
  if (window.lucide) lucide.createIcons();
}

// ===== Promo display =====
function applyPromoFromSettings(s) {
  const promo = s?.promoOffer || (s?.promoText ? { active: true, message: s.promoText, title: '' } : null);
  const bannerEl = document.getElementById('site-promo');
  const bannerTxt = document.getElementById('site-promo-text');
  const modalOverlay = document.getElementById('promo-modal-overlay');
  const modalTitle = document.getElementById('promo-modal-title');
  const modalMsg = document.getElementById('promo-modal-message');
  const modalVal = document.getElementById('promo-modal-value');
  const modalClose = document.getElementById('promo-modal-close');
  const modalCta = document.getElementById('promo-modal-cta');
  if (!bannerEl || !bannerTxt || !modalOverlay) return;
  if (!promo || !promo.active) {
    bannerEl.classList.remove('show');
    bannerEl.classList.add('dismissed');
    bannerEl.style.display = 'none';
    modalOverlay.style.display = 'none';
    return;
  }
  const key = promo.id || (promo.title || promo.message || 'promo').slice(0,20);
  const dismissed = localStorage.getItem('dismissed_promo_' + key);
  if (dismissed) {
    bannerEl.classList.remove('show');
    bannerEl.classList.add('dismissed');
    bannerEl.style.display = 'none';
    modalOverlay.style.display = 'none';
    return;
  }

  // Banner type
  if (!promo.type || promo.type === 'banner' || promo.type === 'badge') {
    bannerTxt.textContent = promo.title ? `${promo.title} — ${promo.message || ''}` : (promo.message || 'عرض خاص');
    bannerEl.classList.remove('dismissed');
    bannerEl.style.display = 'flex';
    bannerEl.classList.add('show');
    if (document.getElementById('site-promo-close')) document.getElementById('site-promo-close').onclick = () => { bannerEl.style.display='none'; localStorage.setItem('dismissed_promo_' + key, '1'); };
    modalOverlay.style.display = 'none';
  }

  // Modal / fullscreen type
  if (promo.type === 'modal' || promo.type === 'popup') {
    // Populate modal
    modalTitle.textContent = promo.title || '';
    modalMsg.textContent = promo.message || '';
    modalVal.textContent = promo.value || '';
    modalOverlay.style.display = 'flex';
    bannerEl.style.display = 'none';
    // Close handlers
    if (modalClose) modalClose.onclick = () => { modalOverlay.style.display='none'; localStorage.setItem('dismissed_promo_' + key, '1'); };
    if (modalCta) modalCta.onclick = () => { modalOverlay.style.display='none'; localStorage.setItem('dismissed_promo_' + key, '1'); /* navigate to products */ showPage('home'); document.getElementById('products')?.scrollIntoView({behavior:'smooth'}); };
  }
}

function renderFeatureHighlights(highlights) {
  const container = document.getElementById('feature-highlights');
  if (!container) return;
  const defaults = [
    { icon: 'truck', title: 'توصيل سريع', text: 'خلال 24-48 ساعة لجميع مناطق المملكة' },
    { icon: 'shield-check', title: 'دفع آمن', text: 'جميع وسائل الدفع الإلكتروني مقبولة' },
    { icon: 'refresh-cw', title: 'إرجاع مجاني', text: 'سياسة إرجاع مرنة خلال 14 يوم' },
    { icon: 'gem', title: 'منتجات أصلية', text: '100% منتجات أصلية مع ضمان الجودة' }
  ];
  const cards = Array.isArray(highlights) && highlights.length ? highlights.filter(item => item && (item.title || item.text)) : [];
  const items = cards.length ? cards : defaults;
  container.innerHTML = items.map(item => `
    <div style="padding:24px;display:flex;flex-direction:column;align-items:center">
      <div style="margin-bottom:12px;color:var(--accent)"><i data-lucide="${item.icon || 'sparkles'}" style="width:40px;height:40px"></i></div>
      <h3 style="font-weight:700;margin-bottom:6px">${item.title || ''}</h3>
      <p style="opacity:0.75;font-size:0.9rem">${item.text || ''}</p>
    </div>
  `).join('');
  if (window.lucide) lucide.createIcons();
}

function populateZones() {
  const select = $('zone-select');
  const select2 = $('order-zone-select');
  const html = ZONES.map(z => `<option value="${z.id}" data-fee="${z.fee || 0}">${z.name}</option>`).join('');
  if (select) select.innerHTML = html;
  if (select2) select2.innerHTML = html;
}

function applyStoreSettings(s) {
  if (s.name) document.title = s.name;

  const faviconEl = document.getElementById('store-favicon');
  const faviconUrl = s.branding?.favicon || s.favicon || '';
  if (faviconEl) {
    faviconEl.href = faviconUrl || '/favicon.png';
  }

  const logo = document.querySelector('.logo');
  if (logo) {
    const currentName = document.getElementById('store-name');
    const storeName = s.name || currentName?.textContent || '';
    const subtitleText = s.subtitle || '';
    const logoImagePath = s.branding?.logo || s.logoImage || '';
    const logoEmoji = (!logoImagePath && s.logo && s.logo.length <= 4) ? s.logo : '';
    const hasLogoImage = logoImagePath && (logoImagePath.startsWith('/') || logoImagePath.startsWith('http') || logoImagePath.includes('.'));

    logo.innerHTML = `${hasLogoImage ? `<img src="${logoImagePath}" alt="${storeName}" class="store-logo-img" />` : logoEmoji ? `<span class="store-logo-emoji">${logoEmoji}</span>` : '<i data-lucide="gem" style="width:24px;height:24px;color:var(--primary)"></i>'}` +
      `<div><span id="store-name">${storeName}</span><span>${subtitleText}</span></div>`;
    if (window.lucide) lucide.createIcons();
  }

  // Apply theme file first, then brand colors if needed
  const urlParams = new URLSearchParams(window.location.search);
  const previewTheme = urlParams.get('theme');
  setThemeStylesheet(previewTheme || s.theme || 'noorlabs-signature');
  document.documentElement.style.setProperty('--primary', s.primaryColor || '#6C3CE1');
  document.documentElement.style.setProperty('--secondary', s.secondaryColor || '#E84393');
  document.documentElement.style.setProperty('--text', s.textColor || '#0F172A');
  document.documentElement.style.setProperty('--text-light', s.subTextColor || '#475569');
  
  const heroTitle = document.querySelector('.hero h1');
  const heroText = document.querySelector('.hero p');
  const heroBadge = document.querySelector('.hero .hero-badge');
  if (heroTitle && s.heroTitle) heroTitle.innerHTML = `${s.heroTitle}<br/><em>${s.heroHighlight || ''}</em>`;
  if (heroText && s.heroText) heroText.textContent = s.heroText;
  if (heroBadge && s.promoText) heroBadge.innerHTML = s.promoText;
  renderFeatureHighlights(s.featureHighlights);

  const heroBanner = document.getElementById('hero-banner');
  const heroImage = s.branding?.heroBanners?.[0] || s.bannerImage || '';
  if (heroBanner) {
    if (heroImage) {
      heroBanner.style.backgroundImage = `url('${heroImage}')`;
      heroBanner.classList.add('visible');
    } else {
      heroBanner.style.backgroundImage = '';
      heroBanner.classList.remove('visible');
    }
  }

  const promoBanner = s.branding?.promoBanners?.[0] || '';
  const bannerEl = document.getElementById('site-promo');
  if (bannerEl) {
    if (promoBanner) {
      bannerEl.style.backgroundImage = `linear-gradient(135deg, rgba(197,9,108,0.92), rgba(255,138,128,0.82)), url('${promoBanner}')`;
      bannerEl.style.backgroundSize = 'cover';
      bannerEl.style.backgroundPosition = 'center';
      bannerEl.style.color = '#fff';
    } else {
      bannerEl.style.backgroundImage = '';
    }
  }

  const promoModal = document.querySelector('.promo-modal');
  if (promoModal) {
    if (promoBanner) {
      promoModal.style.backgroundImage = `linear-gradient(180deg, rgba(255,255,255,0.94), rgba(248,248,250,0.94)), url('${promoBanner}')`;
      promoModal.style.backgroundSize = 'cover';
      promoModal.style.backgroundPosition = 'center';
    } else {
      promoModal.style.backgroundImage = '';
    }
  }

  const setText = (selector, value, fallback) => {
    const el = document.querySelector(selector);
    if (!el) return;
    el.textContent = value || fallback || el.textContent;
  };

  setText('[data-footer-name]', s.name, 'متجرك الفاخر');
  setText('[data-footer-desc]', s.description, 'أفضل منتجات فاخرة للجمال والعناية');
  setText('[data-footer-phone]', s.phone, '000-000-0000');
  setText('[data-footer-email]', s.email, 'hello@store.com');
  setText('[data-footer-address]', s.address, 'المدينة، الدولة');

  const footerCopy = document.querySelector('[data-footer-copy]');
  if (footerCopy) {
    footerCopy.innerHTML = `© ${new Date().getFullYear()} ${s.name || 'متجرك'} · جميع الحقوق محفوظة <i data-lucide="heart" style="width:14px;height:14px;display:inline-block;vertical-align:middle;color:var(--secondary);fill:var(--secondary)"></i>`;
  }

  syncPaymentMethodVisibility();
}

function syncPaymentMethodVisibility() {
  const settings = window.storeSettings || storeSettings || {};
  const visaEnabled = settings?.paymentGateways?.visa === true;

  // Visa label container
  const visaLabel = document.getElementById('payment-label-visa');
  const visaRadio = document.querySelector('input[name="payment"][value="visa"]');
  const codRadio = document.querySelector('input[name="payment"][value="cod"]');
  const codLabel = document.getElementById('payment-label-cod');
  const visaForm = document.getElementById('visa-form');

  if (visaLabel) {
    visaLabel.style.display = visaEnabled ? 'flex' : 'none';
    visaLabel.style.visibility = visaEnabled ? 'visible' : 'hidden';
  }
  if (visaRadio) {
    visaRadio.disabled = !visaEnabled;
  }

  // If visa is disabled but checked, fallback to cod
  if (!visaEnabled && visaRadio?.checked) {
    if (codRadio) codRadio.checked = true;
    if (visaForm) visaForm.style.display = 'none';
    if (codLabel) {
      codLabel.classList.add('active');
    }
    if (visaLabel) {
      visaLabel.classList.remove('active');
    }
  }

  // If visa is disabled, ensure visa form is hidden
  if (!visaEnabled && visaForm) {
    visaForm.style.display = 'none';
  }

  togglePaymentForm();
}

function renderCategories() {
  const container = $('categories-container');
  if (!container) return;

  const categoriesToRender = allCategories
    .filter(c => !isAllCategory(c))
    .filter(c => isRootCategory(c))
    .filter((c, idx, arr) => {
      const normalizedId = String(c.id || '').trim();
      return normalizedId && arr.findIndex(item => String(item.id || '').trim() === normalizedId) === idx;
    });

  const allCard = `
    <div class="cat-card ${currentCategory === 'all' ? 'active' : ''}" onclick="selectCategory('all')">
      <div class="cat-icon cat-icon-all">
        <div class="cat-icon-placeholder">
          <i data-lucide="shopping-bag" style="width:24px;height:24px"></i>
        </div>
      </div>
      <div class="cat-name">الكل</div>
    </div>`;

  const categoryCards = categoriesToRender.map(c => {
    const imageContent = c.image
      ? `<img src="${c.image}" alt="${c.name}" loading="lazy" />`
      : `<div class="cat-icon-placeholder"><i data-lucide="image" style="width:24px;height:24px"></i></div>`;

    return `
      <div class="cat-card ${currentCategory === String(c.id) ? 'active' : ''}" onclick="selectCategory('${c.id}')">
        <div class="cat-icon">${imageContent}</div>
        <div class="cat-name">${c.name}</div>
      </div>`;
  }).join('');

  container.innerHTML = allCard + categoryCards;
  if (window.lucide) lucide.createIcons();
}

function renderSubCategories() {
  const container = $('subcategories-container');
  if (!container) return;
  if (currentCategory === 'all') {
    container.innerHTML = '';
    container.style.display = 'none';
    return;
  }
  const children = getChildCategories(currentCategory);
  if (children.length === 0) {
    container.innerHTML = '';
    container.style.display = 'none';
    return;
  }
  container.style.display = 'flex';
  const parentName = getCategoryName(currentCategory);
  const allChildLabel = `الكل داخل ${parentName}`;
  const cards = children.map(c => `
    <div class="sub-cat-card ${currentSubCategory === String(c.id) ? 'active' : ''}" onclick="selectSubCategory('${c.id}')">
      <span class="sub-cat-name">${c.name}</span>
    </div>
  `).join('');
  container.innerHTML = `
    <div class="sub-cat-card ${currentSubCategory === null ? 'active' : ''}" onclick="selectSubCategory(null)">
      <span class="sub-cat-name">${allChildLabel}</span>
    </div>
    ${cards}
  `;
}

function renderBreadcrumb() {
  const container = $('category-breadcrumb');
  if (!container) return;
  if (currentCategory === 'all') {
    container.innerHTML = '';
    container.style.display = 'none';
    return;
  }
  container.style.display = 'block';
  const catName = getCategoryName(currentCategory);
  let html = `<span class="breadcrumb-label">أنت تتصفح: </span><span class="breadcrumb-cat">${catName}</span>`;
  if (currentSubCategory) {
    html += ` <span class="breadcrumb-sep">/</span> <span class="breadcrumb-cat breadcrumb-cat-active">${getCategoryName(currentSubCategory)}</span>`;
  }
  container.innerHTML = html;
}

function selectCategory(catId) {
  currentCategory = catId;
  currentSubCategory = null;
  renderCategories();
  renderSubCategories();
  renderProducts();
  renderBreadcrumb();
  renderFilters();
}

function getCurrency() {
  return storeSettings?.currencySymbol || '₪';
}

function applyProductFilters(products) {
  let filtered = products;
  if (filterPriceMin || filterPriceMax) {
    const min = parseFloat(filterPriceMin) || 0;
    const max = parseFloat(filterPriceMax) || Infinity;
    filtered = filtered.filter(p => p.price >= min && p.price <= max);
  }
  if (filterBrand) filtered = filtered.filter(p => p.brand === filterBrand);
  if (filterSize) filtered = filtered.filter(p => p.size === filterSize || (Array.isArray(p.sizes) && p.sizes.includes(filterSize)));
  if (filterColor) filtered = filtered.filter(p => p.color === filterColor || (Array.isArray(p.colors) && p.colors.includes(filterColor)));
  return filtered;
}

function renderProducts() {
  const container = $('products-container');
  if (!container) return;
  
  let filtered;
  if (currentCategory === 'all') {
    filtered = allProducts;
  } else if (currentSubCategory) {
    filtered = allProducts.filter(p => p.category === currentSubCategory);
  } else {
    const descendantIds = [currentCategory, ...getDescendantCategoryIds(currentCategory)];
    filtered = allProducts.filter(p => descendantIds.includes(p.category));
  }
  filtered = applyProductFilters(filtered);
  const sortedProducts = filtered.slice().sort((a, b) => {
    const score = item => item.badge ? (item.badge === 'تخفيض' ? 2 : 1) : 0;
    return score(b) - score(a);
  });

  const countEl = $('filter-count');
  if (countEl) countEl.textContent = `تم العثور على ${sortedProducts.length} منتج`;
    
  if (sortedProducts.length === 0) {
    const hasFilters = filterPriceMin || filterPriceMax || filterBrand || filterSize || filterColor;
    container.innerHTML = `
      <div class="empty-state" style="grid-column: 1/-1">
        <div class="empty-icon"><i data-lucide="search-x" style="width:64px;height:64px;opacity:0.4"></i></div>
        <h3>${hasFilters ? 'لا توجد منتجات مطابقة للفلاتر المحددة' : 'لا توجد منتجات'}</h3>
        <p>${hasFilters ? 'حاول تعديل الفلاتر أو إزالتها لعرض المزيد من المنتجات.' : 'لا توجد منتجات متاحة في هذا القسم حالياً.'}</p>
        ${hasFilters ? '<button class="filter-reset-btn" onclick="resetFilters()" style="margin-top:12px">إزالة الفلاتر</button>' : ''}
      </div>
    `;
    if (window.lucide) lucide.createIcons();
    return;
  }
  
  container.innerHTML = sortedProducts.map(p => `
    <div class="product-card">
      <div class="product-art">
        <div class="product-img" style="background: ${p.bg || 'var(--bg)'};display:flex;align-items:center;justify-content:center">
          ${p.image || (p.images && p.images[0]) 
            ? `<img src="${p.image || p.images[0]}" alt="${p.name}" />` 
            : (p.emoji && p.emoji.length <= 4 ? `<span class="product-emoji">${p.emoji}</span>` : `<i data-lucide="package" class="product-fallback-icon"></i>`) }
          <div class="product-name-overlay">${p.name}</div>
        </div>
        ${p.badge ? (() => {
          const badgeType = String(p.badge || '').trim().toLowerCase();
          const badgeClass = badgeType === 'تخفيض' ? 'badge-sale' : (badgeType === 'حصري' ? 'badge-exclusive' : 'badge-new');
          return `<div class="product-badge ${badgeClass}">${p.badge}</div>`;
        })() : ''}
      </div>
      <div class="product-info">
        <div class="product-name">${p.name}</div>
        <div class="product-cat">${getCategoryName(p.category)}</div>
        <div class="product-price">${p.price} <span class="currency">${getCurrency()}</span></div>
        <button class="add-to-cart-btn btn-active-scale" onclick="addToCart(${p.id}, this)">أضف للسلة</button>
      </div>
    </div>
  `).join('');
  if (window.lucide) lucide.createIcons();
}

function getCategoryName(id) {
  const c = allCategories.find(c => c.id === id);
  return c ? c.name : id;
}

// ==========================================
// CART LOGIC
// ==========================================

function openCart() {
  $('cart-overlay').classList.add('open');
  $('cart-sidebar').classList.add('open');
}

function closeCart() {
  $('cart-overlay').classList.remove('open');
  $('cart-sidebar').classList.remove('open');
}

function addToCart(productId, btnElement) {
  if (btnElement) {
    const originalHtml = btnElement.innerHTML;
    btnElement.classList.add('btn-loading');
    btnElement.innerHTML = 'جاري الإضافة...';
    setTimeout(() => {
      processAddToCart(productId);
      btnElement.classList.remove('btn-loading');
      btnElement.innerHTML = originalHtml;
      if (window.lucide) lucide.createIcons();
    }, 300);
  } else {
    processAddToCart(productId);
  }
}

function processAddToCart(productId) {
  const product = allProducts.find(p => p.id === productId);
  if (!product) return;
  
  const existing = cart.find(i => i.id === productId);
  if (existing) {
    existing.qty += 1;
  } else {
    cart.push({ ...product, qty: 1 });
  }
  
  saveCart();
  renderCart();
  openCart();
}

function updateQty(productId, change, btn) {
  const item = cart.find(i => i.id === productId);
  if (item) {
    item.qty += change;
    if (item.qty <= 0) {
      removeFromCart(productId, btn);
      return;
    }
    saveCart();
    renderCart();
  }
}

function removeFromCart(productId, btn) {
  if (btn) {
    const itemEl = btn.closest('.cart-item');
    if (itemEl) {
      itemEl.classList.add('removing');
      setTimeout(() => {
        cart = cart.filter(i => i.id !== productId);
        saveCart();
        renderCart();
      }, 300);
      return;
    }
  }
  cart = cart.filter(i => i.id !== productId);
  saveCart();
  renderCart();
}

function renderCart() {
  const container = $('cart-items-container');
  const countBadge = $('cart-count');
  const totalEl = $('cart-total-price');
  const checkoutBtn = $('checkout-btn');
  
  const totalQty = cart.reduce((sum, item) => sum + item.qty, 0);
  const totalPrice = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
  
  if (countBadge) {
    countBadge.textContent = totalQty;
    countBadge.style.display = totalQty > 0 ? 'flex' : 'none';
  }
  
  if (totalEl) totalEl.textContent = `${totalPrice} ${getCurrency()}`;
  if (checkoutBtn) checkoutBtn.disabled = cart.length === 0;
  
  if (cart.length === 0) {
    container.innerHTML = `
      <div class="cart-empty">
        <i data-lucide="shopping-bag" class="cart-empty-icon"></i>
        <h3>سلتك فارغة</h3>
        <p>اكتشفي تشكيلتنا الفاخرة وابدئي التسوق</p>
        <button class="cart-empty-cta" onclick="closeCart()">تسوقي الآن</button>
      </div>
    `;
    if (window.lucide) lucide.createIcons();
    return;
  }
  
  container.innerHTML = cart.map(item => `
    <div class="cart-item">
      <div class="cart-item-img" style="background: ${item.bg || 'var(--bg)'};display:flex;align-items:center;justify-content:center">
        ${item.image || (item.images && item.images[0]) 
          ? `<img src="${item.image || item.images[0]}" alt="${item.name}" style="width:100%;height:100%;object-fit:cover;" />` 
          : (item.emoji && item.emoji.length <= 4 ? item.emoji : `<i data-lucide="package" style="width:24px;height:24px;opacity:0.6"></i>`)}
      </div>
      <div class="cart-item-info">
        <div class="cart-item-name">${item.name}</div>
        <div class="cart-item-price">${item.price} ${getCurrency()}</div>
        <div class="cart-item-controls">
          <div class="qty-controls">
            <button class="qty-btn" onclick="updateQty(${item.id}, 1, this)">+</button>
            <span class="qty-value">${item.qty}</span>
            <button class="qty-btn" onclick="updateQty(${item.id}, -1, this)">-</button>
          </div>
          <button class="remove-item" onclick="removeFromCart(${item.id}, this)">حذف</button>
        </div>
      </div>
    </div>
  `).join('');
  if (window.lucide) lucide.createIcons();
}

function saveCart() {
  localStorage.setItem('louloCart', JSON.stringify(cart));
}

function loadCartFromStorage() {
  try {
    const saved = localStorage.getItem('louloCart');
    if (saved) {
      cart = JSON.parse(saved);
      renderCart();
    }
  } catch (e) {
    console.error(e);
  }
}

// ==========================================
// NAVIGATION LOGIC
// ==========================================

function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const page = $(`page-${pageId}`);
  if (page) {
    page.classList.add('active');
    window.scrollTo(0, 0);
  }
}

function goToCheckout() {
  if (window.checkoutEnabled === false) {
    showToast('إتمام الشراء معطل حالياً في هذا المتجر', 'error');
    return;
  }
  closeCart();
  renderCheckoutSummary();
  syncPaymentMethodVisibility();
  showPage('checkout');
}

function renderCheckoutSummary() {
  const container = $('order-summary-items');
  const subtotalEl = $('summary-subtotal');
  
  if (!container || !subtotalEl) return;
  
  const totalPrice = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
  
  container.innerHTML = cart.map(item => `
    <div class="summary-item">
      <div class="item-name">
        <span class="item-qty">${item.qty}</span>
        <span>${item.name}</span>
      </div>
      <div>${item.price * item.qty} ${getCurrency()}</div>
    </div>
  `).join('');
  
  subtotalEl.textContent = `${totalPrice} ${getCurrency()}`;
  const countEl = $('summary-count');
  if (countEl) countEl.textContent = `${cart.length} منتج`;
  // Show/hide discount row
  const discountRow = $('discount-row');
  const discountEl = $('summary-discount');
  if (discountRow && discountEl) {
    if (discountAmount > 0) {
      discountRow.style.display = 'flex';
      discountEl.textContent = `-${discountAmount} ${getCurrency()}`;
    } else {
      discountRow.style.display = 'none';
    }
  }
  updateCheckoutTotal();
  // Update mobile sticky footer
  const mobileTotal = $('mobile-summary-total');
  if (mobileTotal) mobileTotal.textContent = `${totalPrice} ${getCurrency()}`;
}

function openOrderModal() {}
function closeOrderModal() {}

function openQuickLinkModal(key) {
  const modal = $('quick-link-modal-overlay');
  const title = $('quick-link-modal-title');
  const body = $('quick-link-modal-body');
  if (!modal || !title || !body) return;

  const currentStore = window.storeSettings || storeSettings || {};
  const storeName = currentStore.name || 'متجرك';
  const storePhone = currentStore.phone || '920-000-0000';
  const storeEmail = currentStore.email || 'hello@store.com';
  const storeAddress = currentStore.address || 'المدينة، الدولة';

  const links = {
    about: {
      title: 'من نحن',
      body: currentStore.aboutText ? `<div>${currentStore.aboutText}</div>` : `<p>${storeName} هو متجر إلكتروني متخصص في الأثاث والمفروشات المنزلية. نقدم قطعاً أنيقة وعالية الجودة لتجديد منزلك وتجعل كل غرفة مكاناً مريحاً وفاخراً.</p><p>اختر من تشكيلاتنا المختارة لتجربة تسوق سلسة مع خدمة عملاء احترافية وتوصيل آمن.</p>`
    },
    contact: {
      title: 'تواصل معنا',
      body: `<p>إذا كان لديك أي استفسار أو طلب خاص، نحن هنا للمساعدة.</p><ul style="list-style:none;padding:0;margin:0;line-height:2;"><li><strong>الهاتف:</strong> ${storePhone}</li><li><strong>البريد الإلكتروني:</strong> ${storeEmail}</li><li><strong>الموقع:</strong> ${storeAddress}</li></ul>`
    },
    privacy: {
      title: 'سياسة الخصوصية',
      body: currentStore.privacyText ? `<div>${currentStore.privacyText}</div>` : `<p>نحترم خصوصيتك ونلتزم بحماية بياناتك الشخصية. نجمع المعلومات الضرورية فقط لمعالجة الطلبات وتحسين تجربتك، ولا نشاركها مع أي جهة خارجية بدون إذنك.</p>`
    },
    terms: {
      title: 'الشروط والأحكام',
      body: currentStore.termsText ? `<div>${currentStore.termsText}</div>` : `<p>باستخدام هذا الموقع، فإنك توافق على الشروط والأحكام المتعلقة بالشحن، الاستبدال، الإلغاء، وسياسة الدفع.</p><p>نوصيك بقراءة هذه الشروط بعناية قبل إتمام أي عملية شراء لضمان تجربة تسوق آمنة ومرضية.</p>`
    }
  };

  const selected = links[key] || links.about;
  title.textContent = selected.title;
  body.innerHTML = selected.body;
  modal.classList.add('open');
  document.body.classList.add('no-scroll');
}

function closeQuickLinkModal() {
  const modal = $('quick-link-modal-overlay');
  if (!modal) return;
  modal.classList.remove('open');
  document.body.classList.remove('no-scroll');
}

function onZoneChange() {
  updateCheckoutTotal();
}

function updateCheckoutTotal() {
  const zoneSelect = $('order-zone-select') || $('zone-select');
  const shippingEl = $('summary-shipping');
  const totalEl = $('summary-total');
  const discountEl = $('summary-discount');
  const mobileTotal = $('mobile-summary-total');
  
  const subtotal = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
  
  if (!zoneSelect || zoneSelect.value === "") {
    if (shippingEl) shippingEl.textContent = 'حدد المنطقة';
    const finalTotal = subtotal - discountAmount;
    if (totalEl) totalEl.textContent = `${finalTotal} ${getCurrency()}`;
    if (mobileTotal) mobileTotal.textContent = `${finalTotal} ${getCurrency()}`;
    if (discountEl && discountAmount > 0) discountEl.textContent = `-${discountAmount} ${getCurrency()}`;
    return;
  }
  
  const shipping = parseInt(zoneSelect.options[zoneSelect.selectedIndex].dataset.fee || 15);
  const finalTotal = subtotal + shipping - discountAmount;
  
  if (shippingEl) shippingEl.textContent = `${shipping} ${getCurrency()}`;
  if (totalEl) totalEl.textContent = `${finalTotal} ${getCurrency()}`;
  if (mobileTotal) mobileTotal.textContent = `${finalTotal} ${getCurrency()}`;
  if (discountEl && discountAmount > 0) discountEl.textContent = `-${discountAmount} ${getCurrency()}`;
}

function toggleCouponField() {
  const wrapper = $('coupon-area-wrapper');
  const icon = $('coupon-chevron');
  if (!wrapper) return;
  if (wrapper.style.display === 'none') {
    wrapper.style.display = 'block';
    if (icon) icon.style.transform = 'rotate(180deg)';
  } else {
    wrapper.style.display = 'none';
    if (icon) icon.style.transform = 'rotate(0deg)';
  }
}

async function applyCoupon() {
  const couponInput = $('coupon-input');
  const messageEl = $('coupon-message');
  if (!couponInput || !messageEl) return;
  
  const code = couponInput.value.trim();
  if (!code) {
    messageEl.textContent = 'يرجى إدخال رمز الخصم';
    messageEl.style.color = '#ef4444'; // Error color
    messageEl.style.display = 'block';
    return;
  }
  
  try {
    const res = await API.validateCoupon(code);
    if (res.success && res.data) {
      appliedCoupon = res.data;
      const subtotal = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
      discountAmount = Math.floor(subtotal * (res.data.discountPercent / 100));
      
      messageEl.textContent = `✓ تم تطبيق الخصم: ${res.data.discountPercent}% (${discountAmount} ${getCurrency()})`;
      messageEl.style.color = '#10b981'; // Success color
      messageEl.style.display = 'block';
      
      couponInput.disabled = true;
      couponInput.style.opacity = '0.6';
      updateCheckoutTotal();
    } else {
      appliedCoupon = null;
      discountAmount = 0;
      messageEl.textContent = res.message || 'رمز الخصم غير صحيح';
      messageEl.style.color = '#ef4444'; // Error color
      messageEl.style.display = 'block';
      updateCheckoutTotal();
    }
  } catch (err) {
    console.error('Coupon error:', err);
    messageEl.textContent = 'خطأ في التحقق من الخصم';
    messageEl.style.color = '#ef4444';
    messageEl.style.display = 'block';
  }
}

function clearCheckoutErrors() {
  document.querySelectorAll('.form-group.has-error').forEach(group => {
    group.classList.remove('has-error');
    const err = group.querySelector('.error-msg');
    if (err) err.textContent = '';
  });
}

function setFieldError(field, message) {
  if (!field) return;
  const group = field.closest('.form-group');
  if (!group) return;
  group.classList.add('has-error');
  const err = group.querySelector('.error-msg');
  if (err) err.textContent = message;
}

function placeOrder() {
  if (_storeLock) return;
  const nameEl = $('field-name');
  const cityEl = $('field-city');
  const phoneEl = $('field-phone');
  const zoneEl = $('zone-select');
  const addressEl = $('field-address');
  const orderNotesEl = $('order-notes') || $('field-notes');
  const privacyCheckbox = $('privacy-accept');
  const paymentEls = document.querySelectorAll('input[name="payment"]');
  
  let paymentMethod = 'cod';
  paymentEls.forEach(r => { if (r.checked) paymentMethod = r.value; });

  clearCheckoutErrors();

  let valid = true;
  if (nameEl && !nameEl.value.trim()) { setFieldError(nameEl, 'الرجاء إدخال الاسم الكامل'); valid = false; }
  if (cityEl && !cityEl.value.trim()) { setFieldError(cityEl, 'الرجاء إدخال المدينة'); valid = false; }
  if (phoneEl && !phoneEl.value.trim()) { setFieldError(phoneEl, 'الرجاء إدخال رقم الجوال'); valid = false; }
  if (zoneEl && !zoneEl.value) { setFieldError(zoneEl, 'الرجاء اختيار منطقة التوصيل'); valid = false; }
  if (addressEl && !addressEl.value.trim()) { setFieldError(addressEl, 'الرجاء إدخال العنوان (الشارع والبناية)'); valid = false; }
  if (privacyCheckbox && !privacyCheckbox.checked) { showToast('يجب الموافقة على سياسة الخصوصية والشروط والأحكام'); valid = false; }
  if (cart.length === 0) { showToast('السلة فارغة'); valid = false; }
  if (paymentMethod === 'visa') {
    const vName = $('visa-name');
    const vCard = $('visa-card');
    const vExp = $('visa-expiry');
    const vCvv = $('visa-cvv');
    if (vName && !vName.value.trim()) { setFieldError(vName, 'الرجاء إدخال اسم صاحب البطاقة'); valid = false; }
    if (vCard && vCard.value.replace(/\s/g, '').length < 16) { setFieldError(vCard, 'الرجاء إدخال رقم بطاقة صحيح'); valid = false; }
    if (vExp && vExp.value.length < 5) { setFieldError(vExp, 'تاريخ الانتهاء غير صحيح'); valid = false; }
    if (vCvv && vCvv.value.length < 3) { setFieldError(vCvv, 'رمز الأمان غير صحيح'); valid = false; }
  }

  if (!valid) {
    showToast('يرجى مراجعة الحقول والموافقات المطلوبة');
    return;
  }

  const subtotal = cart.reduce((sum, i) => sum + (i.price * i.qty), 0);
  const shipping = zoneEl && zoneEl.value ? parseInt(zoneEl.options[zoneEl.selectedIndex].dataset.fee || 0) : 0;
  const total = subtotal + shipping - discountAmount;
  
  const orderPayload = {
    customer: nameEl.value.trim(),
    city: cityEl ? cityEl.value.trim() : '',
    phone: phoneEl.value.trim(),
    address: addressEl ? addressEl.value.trim() : '',
    zone: zoneEl.value,
    zoneName: zoneEl.options[zoneEl.selectedIndex]?.textContent || '',
    items: cart.map(i => ({ productId: i.id, name: i.name, emoji: i.emoji || '', qty: i.qty, price: i.price })),
    subtotal,
    shipping,
    discount: discountAmount,
    couponCode: appliedCoupon ? appliedCoupon.code : '',
    total,
    notes: orderNotesEl ? orderNotesEl.value.trim() : '',
    paymentMethod
  };

  _storeLock = true;
  showToast('جاري تأكيد الطلب...');

  API.createOrder(orderPayload).then(res => {
    if (res && res.success) {
      cart = [];
      appliedCoupon = null;
      discountAmount = 0;
      saveCart();
      renderCart();
      const orderNumEl = $('order-number-display');
      if (orderNumEl && res.data && res.data.id) orderNumEl.textContent = res.data.id;
      if (res.data) {
        const confirmSubtotal = $('order-confirm-subtotal');
        const confirmShipping = $('order-confirm-shipping');
        const confirmDiscount = $('order-confirm-discount');
        const confirmDiscountRow = $('confirm-discount-row');
        const confirmTotal = $('order-confirm-total');
        const confirmZone = $('order-confirm-zone');
        const confirmAddress = $('order-confirm-address');
        if (confirmSubtotal) confirmSubtotal.textContent = `${res.data.subtotal || 0} ${getCurrency()}`;
        if (confirmShipping) confirmShipping.textContent = `${res.data.shipping || 0} ${getCurrency()}`;
        if (confirmDiscount && confirmDiscountRow) {
          if (res.data.discount && res.data.discount > 0) {
            confirmDiscountRow.style.display = 'flex';
            confirmDiscount.textContent = `-${res.data.discount} ${getCurrency()}`;
          } else {
            confirmDiscountRow.style.display = 'none';
          }
        }
        if (confirmTotal) confirmTotal.textContent = `${res.data.total || 0} ${getCurrency()}`;
        if (confirmZone) confirmZone.textContent = res.data.zoneName || '';
        if (confirmAddress) confirmAddress.textContent = res.data.address || '';
      }
      showPage('confirmation');
    } else {
      const msg = (res && res.message) ? res.message : 'فشل إنشاء الطلب';
      showToast(msg, 'error');
    }
    _storeLock = false;
  }).catch(err => {
    console.error('Order error:', err);
    showToast('خطأ غير متوقع عند إنشاء الطلب', 'error');
    _storeLock = false;
  });
}

function showToast(msg) {
  const t = $('toast');
  if (t) {
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3000);
  }
}

// Global error handler
window.addEventListener('unhandledrejection', e => {
  console.error('[STORE UNHANDLED]', e.reason);
  e.preventDefault();
});

// Visa Handlers
function togglePaymentForm() {
  const isVisa = document.querySelector('input[name="payment"]:checked')?.value === 'visa';
  const visaForm = $('visa-form');
  if (visaForm) visaForm.style.display = isVisa ? 'block' : 'none';
  
  const allLabels = document.querySelectorAll('.payment-option');
  allLabels.forEach(label => label.classList.remove('active'));
  const activeLabel = document.querySelector(`input[name="payment"]:checked`)?.closest('.payment-option');
  if (activeLabel) activeLabel.classList.add('active');
}

function formatCardNumber(input) {
  let val = input.value.replace(/\D/g, '');
  let formatted = '';
  for (let i = 0; i < val.length; i++) {
    if (i > 0 && i % 4 === 0) formatted += ' ';
    formatted += val[i];
  }
  input.value = formatted;
}

function formatExpiry(input) {
  let val = input.value.replace(/\D/g, '');
  if (val.length >= 2) {
    val = val.substring(0, 2) + '/' + val.substring(2, 4);
  }
  input.value = val;
}

// Initialize on load
document.addEventListener('DOMContentLoaded', initStore);