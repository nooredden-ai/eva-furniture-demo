const jsonStore = require('../core/jsonStore');

class BaseRepository {
  constructor(fileName) {
    this.fileName = fileName;
  }

  findAll() {
    return jsonStore.readJsonFile(this.fileName);
  }

  saveAll(items) {
    return jsonStore.writeJsonFile(this.fileName, items);
  }
}

module.exports = BaseRepository;
