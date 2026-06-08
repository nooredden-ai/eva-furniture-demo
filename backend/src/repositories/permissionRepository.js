const BaseRepository = require('./baseRepository');

class PermissionRepository extends BaseRepository {
  constructor() {
    super('permissions.json');
  }
}

module.exports = new PermissionRepository();
