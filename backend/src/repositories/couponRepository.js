const BaseRepository = require('./baseRepository');

class CouponRepository extends BaseRepository {
  constructor() {
    super('coupons.json');
  }

  findByCode(code) {
    if (!code) return null;
    const normalized = String(code).trim().toUpperCase();
    return this.findAll().find(coupon => String(coupon.code || '').toUpperCase() === normalized);
  }

  create(data) {
    const coupons = this.findAll();
    const newCoupon = {
      code: String(data.code || '').trim().toUpperCase(),
      discountPercent: data.discountPercent,
      maxUses: typeof data.maxUses === 'number' ? data.maxUses : -1,
      usedCount: 0,
      active: data.active !== false,
      expiryDate: data.expiryDate || '2099-12-31'
    };
    coupons.push(newCoupon);
    this.saveAll(coupons);
    return newCoupon;
  }

  update(code, data) {
    const coupons = this.findAll();
    const idx = coupons.findIndex(c => String(c.code || '').toUpperCase() === String(code || '').trim().toUpperCase());
    if (idx === -1) return null;
    coupons[idx] = { ...coupons[idx], ...data };
    this.saveAll(coupons);
    return coupons[idx];
  }

  delete(code) {
    const coupons = this.findAll();
    const filtered = coupons.filter(c => String(c.code || '').toUpperCase() !== String(code || '').trim().toUpperCase());
    this.saveAll(filtered);
    return filtered.length !== coupons.length;
  }
}

module.exports = new CouponRepository();
