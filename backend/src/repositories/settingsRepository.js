const BaseRepository = require('./baseRepository');

class SettingsRepository extends BaseRepository {
  constructor() {
    super('settings.json');
  }

  findFirst() {
    const settings = this.findAll();
    return settings[0] || {};
  }

  update(data) {
    const settings = this.findAll();
    if (settings.length > 0) {
      settings[0] = { ...settings[0], ...data };
    } else {
      settings.push({ id: 'store-settings', ...data });
    }
    this.saveAll(settings);
    return settings[0];
  }
}

module.exports = new SettingsRepository();
