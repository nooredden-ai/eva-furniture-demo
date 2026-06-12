// api.js - Frontend API wrapper with Production Stability Layer

window.appState = {
  products: null,
  categories: null,
  settings: null,
  orders: null,
  users: null,
  countries: null
};

// Logging System
const Logger = {
  log: (action, data) => console.log(`[STORE LOG] ${action}`, data || ''),
  error: (action, err) => console.error(`[STORE ERROR] ${action}`, err),
};

// API Wrapper with Timeout & Retry
function getAuthHeaders() {
  const headers = {};
  const token = sessionStorage.getItem('louloToken');
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  // TODO: remove legacy x-user-role/x-user-id after full JWT migration
  const sessionStr = sessionStorage.getItem('louloSession');
  if (sessionStr) {
    try {
      const session = JSON.parse(sessionStr);
      headers['x-user-role'] = session.role;
      headers['x-user-id'] = session.id;
    } catch (e) {}
  }
  // Impersonation: notify backend of real operator
  if (typeof Auth !== 'undefined' && Auth.isImpersonating()) {
    const impInfo = Auth.getImpersonationInfo();
    if (impInfo) {
      headers['x-impersonated-by'] = `${impInfo.originalUsername} impersonating ${impInfo.targetUsername}`;
    }
  }
  return headers;
}

// API Wrapper with Timeout & Retry
async function fetchWithStability(url, options = {}, retries = 2, timeoutMs = 8000) {
  for (let i = 0; i <= retries; i++) {
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeoutMs);
      
      const finalHeaders = { ...(options.headers || {}), ...getAuthHeaders() };
      
      const response = await fetch(url, { ...options, headers: finalHeaders, signal: controller.signal });
      clearTimeout(id);
      const text = await response.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch (parseErr) {
        // ignore invalid JSON
      }
      if (response.ok) {
        if (json && typeof json === 'object' && 'success' in json) {
          return json;
        }
        return { success: true, data: json };
      }
      if (json && typeof json === 'object' && json.message) {
        return { success: false, message: json.message, data: json };
      }
      throw new Error(`HTTP ${response.status}`);
    } catch (err) {
      Logger.error(`API Failed: ${url} (Attempt ${i + 1})`, err.message);
      if (i === retries) {
        return { success: false, message: 'فشل الاتصال بالخادم، يرجى المحاولة لاحقاً.' };
      }
      await new Promise(res => setTimeout(res, 1000 * (i + 1))); // backoff
    }
  }
}

// Data Validation Layer
const Validator = {
  product: (data) => {
    if (!data.name || data.name.trim() === '') return 'اسم المنتج مطلوب';
    if (isNaN(parseFloat(data.price)) || parseFloat(data.price) < 0) return 'السعر غير صالح';
    return null;
  },
  category: (data) => {
    if (!data.name || data.name.trim() === '') return 'اسم التصنيف مطلوب';
    return null;
  }
};

const API = {
  // ---------- Products ----------
  getProducts: async (force = false) => {
    if (!force && appState.products) return appState.products;
    const res = await fetchWithStability('/api/products');
    if (res.success) {
      appState.products = res.data;
      Logger.log('Fetched Products');
      return res.data;
    }
    return appState.products || []; // Graceful fallback
  },
  getProduct: async (id) => {
    const products = await API.getProducts();
    return products.find(p => String(p.id) === String(id));
  },
  addProduct: async (data) => {
    const err = Validator.product(data);
    if (err) return { success: false, message: err };
    
    const res = await fetchWithStability('/api/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (res.success) {
      if (appState.products) appState.products.push(res.data);
      Logger.log('Added Product', res.data.id);
    }
    return res;
  },
  updateProduct: async (id, data) => {
    const err = Validator.product(data);
    if (err) return { success: false, message: err };

    const res = await fetchWithStability(`/api/products/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (res.success && appState.products) {
      const idx = appState.products.findIndex(p => String(p.id) === String(id));
      if (idx !== -1) appState.products[idx] = res.data;
      Logger.log('Updated Product', id);
    }
    return res;
  },
  deleteProduct: async (id) => {
    const res = await fetchWithStability(`/api/products/${id}`, { method: 'DELETE' });
    if (res.success && appState.products) {
      appState.products = appState.products.filter(p => String(p.id) !== String(id));
      Logger.log('Deleted Product', id);
    }
    return res;
  },

  // ---------- Categories ----------
  getCategories: async (force = false) => {
    if (!force && appState.categories) return appState.categories;
    const res = await fetchWithStability('/api/categories');
    if (res.success) {
      appState.categories = res.data;
      Logger.log('Fetched Categories');
      return res.data;
    }
    return appState.categories || [];
  },
  addCategory: async (data) => {
    const err = Validator.category(data);
    if (err) return { success: false, message: err };

    const res = await fetchWithStability('/api/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (res.success && appState.categories) {
      appState.categories.push(res.data);
      Logger.log('Added Category', res.data.id);
    }
    return res;
  },
  updateCategory: async (id, data) => {
    const err = Validator.category(data);
    if (err) return { success: false, message: err };

    const res = await fetchWithStability(`/api/categories/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (res.success && appState.categories) {
      const idx = appState.categories.findIndex(c => String(c.id) === String(id));
      if (idx !== -1) appState.categories[idx] = res.data;
      Logger.log('Updated Category', id);
    }
    return res;
  },
  deleteCategory: async (id) => {
    const res = await fetchWithStability(`/api/categories/${id}`, { method: 'DELETE' });
    if (res.success && appState.categories) {
      appState.categories = appState.categories.filter(c => String(c.id) !== String(id));
      Logger.log('Deleted Category', id);
    }
    return res;
  },

  // ---------- Orders ----------
  getOrders: async (force = false) => {
    if (!force && appState.orders) return appState.orders;
    const res = await fetchWithStability('/api/orders');
    if (res.success) {
      appState.orders = res.data;
      return res.data;
    }
    return appState.orders || [];
  },
  downloadOrderPdf: async (id, type = 'invoice') => {
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(id)}/pdf?type=${encodeURIComponent(type)}`);
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        return { success: false, message: payload?.message || `فشل تحميل ${type} للطلب ${id}` };
      }
      const blob = await response.blob();
      return { success: true, blob };
    } catch (err) {
      return { success: false, message: 'فشل الاتصال بالخادم لتنزيل PDF.' };
    }
  },
  bulkDownloadOrdersPdf: async (ids, type = 'invoice') => {
    try {
      const response = await fetch('/api/orders/bulk-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, type }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        return { success: false, message: payload?.message || 'فشل تحميل PDF الجماعي' };
      }
      const blob = await response.blob();
      return { success: true, blob };
    } catch (err) {
      return { success: false, message: 'فشل الاتصال بالخادم لتنزيل PDF الجماعي.' };
    }
  },
  updateOrderStatus: async (id, status) => {
    const res = await fetchWithStability(`/api/orders/${id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (res.success && appState.orders) {
      const idx = appState.orders.findIndex(o => String(o.id) === String(id));
      if (idx !== -1) appState.orders[idx] = res.order || res.data?.order || res.data || res;
    }
    return res;
  },
  assignOrderToUser: async (id, userId) => {
    const res = await fetchWithStability(`/api/orders/${id}/assign`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    if (res.success && appState.orders) {
      const idx = appState.orders.findIndex(o => String(o.id) === String(id));
      if (idx !== -1) appState.orders[idx] = res.order || res.data?.order || res.data || res;
    }
    return res;
  },
  addOrderNote: async (id, note) => {
    const res = await fetchWithStability(`/api/orders/${id}/note`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note }),
    });
    if (res.success && appState.orders) {
      const idx = appState.orders.findIndex(o => String(o.id) === String(id));
      if (idx !== -1) appState.orders[idx] = res.order || res.data?.order || res.data || res;
    }
    return res;
  },
  deleteOrder: async (id) => {
    const res = await fetchWithStability(`/api/orders/${id}`, { method: 'DELETE' });
    if (res.success && appState.orders) {
      appState.orders = appState.orders.filter(o => String(o.id) !== String(id));
    }
    return res;
  },
  createOrder: async (orderData) => {
    const res = await fetchWithStability('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(orderData),
    });
    if (res.success && res.data) {
      if (appState.orders) appState.orders.push(res.data);
      Logger.log('Created Order', res.data.id);
    }
    return res;
  },

  // ---------- Users ----------
  getUsers: async (force = false) => {
    if (!force && appState.users) return appState.users;
    const res = await fetchWithStability('/api/users');
    if (res.success) {
      appState.users = res.data;
      return res.data;
    }
    return appState.users || [];
  },
  createUser: async (data) => {
    const res = await fetchWithStability('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (res.success && appState.users) appState.users.push(res.data);
    return res;
  },
  updateUser: async (id, data) => {
    const res = await fetchWithStability(`/api/users/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (res.success && appState.users) {
      const idx = appState.users.findIndex(u => String(u.id) === String(id));
      if (idx !== -1) appState.users[idx] = res.data;
    }
    return res;
  },
  deleteUser: async (id) => {
    const res = await fetchWithStability(`/api/users/${id}`, { method: 'DELETE' });
    if (res.success && appState.users) {
      appState.users = appState.users.filter(u => String(u.id) !== String(id));
    }
    return res;
  },

  // ---------- Store Settings ----------
  getStoreSettings: async (force = false) => {
    if (!force && appState.settings) return appState.settings;
    const res = await fetchWithStability('/api/settings');
    if (res.success) {
      appState.settings = res.data;
      return res.data;
    }
    return appState.settings || {};
  },
  updateStoreSettings: async (data) => {
    const res = await fetchWithStability('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (res.success) {
      appState.settings = res.data;
    }
    return res;
  },

  // ---------- Roles & Permissions ----------
  getPermissions: async () => {
    const res = await fetchWithStability('/api/permissions');
    if (res.success) {
      return res.data;
    }
    return null;
  },
  updatePermissions: async (data) => {
    const res = await fetchWithStability('/api/permissions', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res;
  },

  // ---------- Image Upload ----------
  uploadImage: async (file, type = 'product') => {
    try {
      const form = new FormData();
      form.append('image', file);
      form.append('type', type);
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: form
      });
      if (!res.ok) throw new Error('Upload Failed');
      const data = await res.json();
      return data;
    } catch(err) {
      console.error('Upload Failed:', err);
      return {
        success: false,
        data: null,
        message: "Upload failed"
      };
    }
  },

  // ---------- Countries ----------
  getCountries: async (force = false) => {
    if (!force && appState.countries) return appState.countries;
    const res = await fetchWithStability('/api/countries');
    if (res.success) {
      appState.countries = res.data;
      return res.data;
    }
    return appState.countries || [];
  },
  getCountry: async (code) => {
    const countries = await API.getCountries();
    return countries.find(c => String(c.code) === String(code));
  },

  // ---------- Coupons ----------
  getCoupons: async (force = false) => {
    const res = await fetchWithStability('/api/coupons');
    if (res.success) return res.data;
    return [];
  },
  validateCoupon: async (code) => {
    if (!code || code.trim() === '') {
      return { success: false, message: 'رمز الخصم مطلوب' };
    }
    const res = await fetchWithStability('/api/coupons/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code.trim() }),
    });
    return res;
  },
  createCoupon: async (data) => {
    const res = await fetchWithStability('/api/coupons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res;
  },
  updateCoupon: async (code, data) => {
    const res = await fetchWithStability(`/api/coupons/${code}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res;
  },
  deleteCoupon: async (code) => {
    const res = await fetchWithStability(`/api/coupons/${code}`, { method: 'DELETE' });
    return res;
  },
};

window.API = API;
