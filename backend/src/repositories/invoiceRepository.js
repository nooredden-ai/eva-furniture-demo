const BaseRepository = require('./baseRepository');
const fs = require('fs');
const path = require('path');

class InvoiceRepository extends BaseRepository {
  constructor() {
    super('invoices.json');
  }

  // Find invoice by ID
  findById(id) {
    return this.findAll().find(inv => String(inv.id) === String(id));
  }

  // Find invoice by source (order or direct sale)
  findBySource(sourceType, sourceId) {
    const invoices = this.findAll();
    return invoices.find(inv => inv.sourceType === sourceType && String(inv.sourceId) === String(sourceId));
  }

  // Create invoice, prevent duplicates
  create(invoice) {
    const invoices = this.findAll();
    if (this.findBySource(invoice.sourceType, invoice.sourceId)) {
      return null; // duplicate
    }
    invoices.push(invoice);
    this.saveAll(invoices);
    return invoice;
  }

  // Update invoice (e.g., cancellation)
  update(id, data) {
    const invoices = this.findAll();
    const idx = invoices.findIndex(inv => String(inv.id) === String(id));
    if (idx === -1) return null;
    invoices[idx] = { ...invoices[idx], ...data, lastUpdated: new Date().toISOString() };
    this.saveAll(invoices);
    return invoices[idx];
  }
}

module.exports = new InvoiceRepository();
