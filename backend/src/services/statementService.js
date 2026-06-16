function chequeNoteLabel(chequeStatus) {
  const labels = { collected: 'شيك تم تحصيله', pending: 'شيك قيد التحصيل', returned: 'شيك مرتجع', cancelled: 'شيك ملغي' };
  return labels[chequeStatus] || 'شيك قيد التحصيل';
}

function getCustomerKey(name, phone) {
  const n = (name || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const p = (phone || '').trim().replace(/[^0-9]/g, '');
  return p ? `${n}|${p}` : n;
}

function getCustomerStatus(c) {
  if (!c || (!c.totalPurchases && !c.invoiceCount)) return 'جديد';
  const now = new Date();
  const lastInvoice = c.lastInvoice ? new Date(c.lastInvoice) : null;
  const lastReceipt = c.lastReceipt ? new Date(c.lastReceipt) : null;
  const mostRecent = lastInvoice && lastReceipt ? (lastInvoice > lastReceipt ? lastInvoice : lastReceipt) : (lastInvoice || lastReceipt);

  if (c.totalPurchases > 10000) return 'VIP';
  if (c.balance && c.balance > 0) return 'مدين';
  if (mostRecent) {
    const daysSince = Math.floor((now - mostRecent) / (1000 * 60 * 60 * 24));
    if (daysSince > 90) return 'خامل';
    if (daysSince < 30 && c.invoiceCount > 0) return 'جديد';
  }
  return 'عادي';
}

function isReceiptCreditable(r) {
  if (r.status === 'cancelled') return false;
  if (r.paymentMethod === 'cheque') {
    if (!r.chequeStatus) return true;
    if (r.chequeStatus !== 'collected') return false;
  }
  return true;
}

function getCustomerSummaries(invoices, receipts) {
  const customers = {};

  (invoices || []).forEach(inv => {
    if (inv.status === 'cancelled') return;
    const c = inv.customer || {};
    const name = c.name || '';
    const phone = c.phone || '';
    if (!name) return;
    const key = getCustomerKey(name, phone);
    if (!customers[key]) {
      customers[key] = { name, phone, totalPurchases: 0, totalPaid: 0, invoiceCount: 0, receiptCount: 0, firstInvoice: null, lastInvoice: null, lastReceipt: null };
    }
    customers[key].totalPurchases += Number(inv.total) || 0;
    customers[key].invoiceCount++;
    const d = inv.createdAt || inv.date;
    if (d) {
      if (!customers[key].firstInvoice || d < customers[key].firstInvoice) customers[key].firstInvoice = d;
      if (!customers[key].lastInvoice || d > customers[key].lastInvoice) customers[key].lastInvoice = d;
    }
  });

  (receipts || []).forEach(r => {
    if (r.status === 'cancelled') return;
    const name = r.customerName || '';
    const phone = r.customerPhone || '';
    if (!name) return;
    const key = getCustomerKey(name, phone);
    if (!customers[key]) {
      customers[key] = { name, phone, totalPurchases: 0, totalPaid: 0, invoiceCount: 0, receiptCount: 0, firstInvoice: null, lastInvoice: null, lastReceipt: null };
    }
    customers[key].receiptCount++;
    if (isReceiptCreditable(r)) {
      customers[key].totalPaid += Number(r.amount) || 0;
    }
    const d = r.date || r.createdAt;
    if (d) {
      if (!customers[key].lastReceipt || d > customers[key].lastReceipt) customers[key].lastReceipt = d;
    }
  });

  return Object.values(customers).map(c => ({
    ...c,
    balance: Math.max(0, c.totalPurchases - c.totalPaid),
    status: getCustomerStatus(c)
  })).sort((a, b) => b.totalPurchases - a.totalPurchases);
}

function getCustomerStatement(name, phone, invoices, receipts) {
  const key = getCustomerKey(name, phone);
  const entries = [];

  (invoices || []).forEach(inv => {
    if (inv.status === 'cancelled') return;
    const c = inv.customer || {};
    if (getCustomerKey(c.name, c.phone) !== key) return;
    entries.push({
      date: inv.createdAt || inv.date || '',
      type: 'فاتورة',
      reference: inv.id,
      debit: Number(inv.total) || 0,
      credit: 0,
      status: inv.status,
      isInvoice: true
    });
  });

  (receipts || []).forEach(r => {
    if (r.status === 'cancelled') return;
    if (getCustomerKey(r.customerName, r.customerPhone) !== key) return;
    const creditable = isReceiptCreditable(r);
    entries.push({
      date: r.date || r.createdAt || '',
      type: 'سند قبض',
      reference: r.voucherNumber || r.id,
      debit: 0,
      credit: creditable ? (Number(r.amount) || 0) : 0,
      paymentMethod: r.paymentMethod,
      chequeStatus: r.chequeStatus,
      status: r.status,
      isInvoice: false,
      note: !creditable && r.paymentMethod === 'cheque' ? chequeNoteLabel(r.chequeStatus) : ''
    });
  });

  entries.sort((a, b) => {
    const da = a.date || '';
    const db = b.date || '';
    if (da < db) return -1;
    if (da > db) return 1;
    return 0;
  });

  let balance = 0;
  entries.forEach(e => {
    balance += e.debit - e.credit;
    e.balance = balance;
  });

  return entries;
}

function getCustomerSummary(name, phone, invoices, receipts) {
  const summaries = getCustomerSummaries(
    (invoices || []).filter(inv => {
      if (inv.status === 'cancelled') return false;
      const c = inv.customer || {};
      return getCustomerKey(c.name, c.phone) === getCustomerKey(name, phone);
    }),
    (receipts || []).filter(r => {
      if (r.status === 'cancelled') return false;
      return getCustomerKey(r.customerName, r.customerPhone) === getCustomerKey(name, phone);
    })
  );
  return summaries[0] || { name, phone, totalPurchases: 0, totalPaid: 0, balance: 0, invoiceCount: 0, receiptCount: 0, status: 'جديد' };
}

function getAgingReport(invoices, receipts) {
  const now = new Date();
  const customers = {};

  (invoices || []).forEach(inv => {
    if (inv.status === 'cancelled') return;
    const c = inv.customer || {};
    const name = c.name || '';
    const phone = c.phone || '';
    if (!name) return;
    const key = getCustomerKey(name, phone);

    const linkedReceipts = (receipts || []).filter(r =>
      r.status !== 'cancelled' &&
      r.linkedTo === 'invoice' &&
      String(r.linkedId) === String(inv.id)
    );

    const totalPaid = linkedReceipts.reduce((s, r) => {
      if (!isReceiptCreditable(r)) return s;
      return s + (Number(r.amount) || 0);
    }, 0);

    const remaining = Math.max(0, (Number(inv.total) || 0) - totalPaid);
    if (remaining <= 0) return;

    if (!customers[key]) {
      customers[key] = { name, phone, '0to30': 0, '31to60': 0, '61to90': 0, '90plus': 0, total: 0 };
    }

    const invDate = new Date(inv.createdAt || inv.date);
    const ageDays = Math.floor((now - invDate) / (1000 * 60 * 60 * 24));

    customers[key].total += remaining;
    if (ageDays <= 30) customers[key]['0to30'] += remaining;
    else if (ageDays <= 60) customers[key]['31to60'] += remaining;
    else if (ageDays <= 90) customers[key]['61to90'] += remaining;
    else customers[key]['90plus'] += remaining;
  });

  return Object.values(customers).sort((a, b) => b.total - a.total);
}

module.exports = {
  getCustomerKey,
  getCustomerStatus,
  getCustomerSummaries,
  getCustomerStatement,
  getCustomerSummary,
  getAgingReport,
  isReceiptCreditable,
  chequeNoteLabel
};
