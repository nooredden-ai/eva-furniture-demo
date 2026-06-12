const invoiceRepository = require('../repositories/invoiceRepository');
const settingsRepository = require('../repositories/settingsRepository');

function generateInvoiceId() {
  const invoices = invoiceRepository.findAll();
  const year = new Date().getFullYear();
  const nextSeq = invoices.filter(inv => String(inv.id).startsWith(`INV-${year}-`)).length + 1;
  return `INV-${year}-${String(nextSeq).padStart(6, '0')}`;
}

function createSnapshot() {
  const settings = settingsRepository.findFirst() || {};
  return {
    storeName: settings.name || '',
    logo: settings.logoImage || (settings.branding && settings.branding.logo) || settings.logo || '',
    phone: settings.phone || '',
    email: settings.email || '',
    address: settings.address || '',
    currency: settings.currency || ''
  };
}

function createInvoice({ sourceType, sourceId, total, items, customer, subtotal, shipping, discount }) {
  // Prevent duplicate
  if (invoiceRepository.findBySource(sourceType, sourceId)) {
    return null; // duplicate prevented
  }
  const invoice = {
    id: generateInvoiceId(),
    sourceType,
    sourceId,
    total,
    items,
    customer,
    subtotal: subtotal ?? 0,
    shipping: shipping ?? 0,
    discount: discount ?? 0,
    snapshot: createSnapshot(),
    status: 'active',
    createdAt: new Date().toISOString()
  };
  return invoiceRepository.create(invoice);
}

function cancelInvoice(invoiceId, reason) {
  const invoice = invoiceRepository.findById(invoiceId);
  if (!invoice) return null;
  return invoiceRepository.update(invoiceId, {
    status: 'cancelled',
    cancelledAt: new Date().toISOString(),
    cancelReason: reason || ''
  });
}

module.exports = { createInvoice, cancelInvoice };
