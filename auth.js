/**
 * Auth Layer — Session Management & RBAC Enforcement
 * Session stored in sessionStorage (cleared on tab close)
 */

const SESSION_KEY = 'louloSession';

let ROLES = {
  super_admin:   { label: 'مدير عام المنصة', emoji: '👑', color: '#6C3CE1' },
  store_owner:   { label: 'مالك متجر', emoji: '💼', color: '#0284c7' },
  store_manager: { label: 'مالك متجر', emoji: '💼', color: '#0284c7' }, // fallback
  manager:       { label: 'مدير متجر', emoji: '🧑‍💼', color: '#059669' },
  employee:      { label: 'موظف', emoji: '🧑‍💻', color: '#6366f1' },
  support_agent: { label: 'دعم فني', emoji: '🎧', color: '#eab308' },
};

let PERMISSIONS = {
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

const IMPERSONATION_KEY = 'louloImpersonation';
const ORIGINAL_SESSION_KEY = 'louloOriginalSession';

const Auth = {

  // ===== Login =====
  async login(username, password) {
    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      
      if (!response.ok) {
        try {
          const errorData = await response.json();
          return { ok: false, error: errorData.message || `خطأ من الخادم: ${response.status}` };
        } catch {
          return { ok: false, error: `خطأ الخادم: ${response.status} ${response.statusText}` };
        }
      }
      
      const result = await response.json();
      
      if (!result.success) {
        return { ok: false, error: result.message || 'فشل تسجيل الدخول' };
      }
      
      const user = result.data;
      
      const session = { id: user.id, username: user.username || '', name: user.name, email: user.email, role: user.role, storeId: user.storeId };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
      if (result && result.token) {
        sessionStorage.setItem('louloToken', result.token);
      }
      return { ok: true, user: session };
    } catch (err) {
      console.error('[AUTH ERROR]', err);
      return { ok: false, error: 'فشل الاتصال بالخادم. تأكد من أن الخادم قيد التشغيل على http://localhost:3000' };
    }
  },

  // ===== Logout =====
  logout() {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(ORIGINAL_SESSION_KEY);
    sessionStorage.removeItem(IMPERSONATION_KEY);
    window.location.href = 'login.html';
  },

  // ===== Get Current Session =====
  getSession() {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  },

  // ===== Require Auth (redirect if not logged in) =====
  requireAuth(allowedRoles) {
    let session = this.getSession();
    if (!session) {
      window.location.href = 'login.html';
      return null;
    }
    if (allowedRoles && !allowedRoles.includes(session.role)) {
      window.location.href = 'login.html';
      return null;
    }
    return session;
  },

  // ===== Permission Check =====
  can(permission) {
    const session = this.getSession();
    if (!session) return false;
    return (PERMISSIONS[session.role] || []).includes(permission);
  },

  canRole(role, permission) {
    return (PERMISSIONS[role] || []).includes(permission);
  },

  isSuperAdmin() { return this.getSession()?.role === 'super_admin'; },
  isStoreManager()  { return this.getSession()?.role === 'store_manager'; },
  isStaff()       { return ['employee','support_agent'].includes(this.getSession()?.role); },

  // ===== Impersonation =====
  startImpersonation(targetUser) {
    const currentSession = this.getSession();
    if (!currentSession || currentSession.role !== 'super_admin') return false;

    sessionStorage.setItem(ORIGINAL_SESSION_KEY, JSON.stringify(currentSession));
    sessionStorage.setItem(IMPERSONATION_KEY, JSON.stringify({
      originalUsername: currentSession.username || currentSession.name,
      targetUsername: targetUser.username || targetUser.name,
      targetRole: targetUser.role,
      active: true
    }));

    const impersonatedSession = {
      id: targetUser.id,
      username: targetUser.username || '',
      name: targetUser.name,
      email: targetUser.email || '',
      role: targetUser.role,
      storeId: targetUser.storeId || currentSession.storeId
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(impersonatedSession));
    return true;
  },

  stopImpersonation() {
    const original = sessionStorage.getItem(ORIGINAL_SESSION_KEY);
    if (!original) return false;

    sessionStorage.setItem(SESSION_KEY, original);
    sessionStorage.removeItem(ORIGINAL_SESSION_KEY);
    sessionStorage.removeItem(IMPERSONATION_KEY);
    return true;
  },

  isImpersonating() {
    const data = sessionStorage.getItem(IMPERSONATION_KEY);
    if (!data) return false;
    try {
      const imp = JSON.parse(data);
      return imp.active === true;
    } catch { return false; }
  },

  getImpersonationInfo() {
    const data = sessionStorage.getItem(IMPERSONATION_KEY);
    if (!data) return null;
    try { return JSON.parse(data); } catch { return null; }
  },

  getOriginalAdmin() {
    const data = sessionStorage.getItem(ORIGINAL_SESSION_KEY);
    if (!data) return null;
    try { return JSON.parse(data); } catch { return null; }
  },

  getEffectiveChangedBy() {
    if (this.isImpersonating()) {
      const imp = this.getImpersonationInfo();
      if (imp) return `${imp.originalUsername} impersonating ${imp.targetUsername}`;
    }
    const s = this.getSession();
    return s ? (s.username || s.name || s.role) : 'system';
  },

  // ===== Store Isolation =====
  getAllowedStoreId() {
    const s = this.getSession();
    if (!s) return null;
    if (s.role === 'super_admin') return null;
    return s.storeId;
  },

  canAccessStore(storeId) {
    const s = this.getSession();
    if (!s) return false;
    if (s.role === 'super_admin') return true;
    return s.storeId === storeId;
  },

  // ===== UI helpers =====
  getRoleLabel(role) { return ROLES[role]?.label || role; },
  getRoleEmoji(role) { return ROLES[role]?.emoji || ''; },
  getRoleColor(role) { return ROLES[role]?.color || '#888'; },

  setDynamicPermissions(newPerms) {
    if (newPerms) {
      Object.assign(PERMISSIONS, newPerms);
    }
  },
};
