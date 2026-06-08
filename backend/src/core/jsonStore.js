const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', '..', 'data');

function getDataPath(fileName) {
  const safeFileName = String(fileName || '').trim();
  if (!safeFileName) {
    throw new Error('jsonStore: fileName is required');
  }
  return path.join(DATA_DIR, safeFileName);
}

function readJsonFile(fileName) {
  const filePath = getDataPath(fileName);
  try {
    if (!fs.existsSync(filePath)) {
      return [];
    }
    const content = fs.readFileSync(filePath, 'utf8');
    return content.trim() ? JSON.parse(content) : [];
  } catch (err) {
    console.error(`[jsonStore] Failed to read ${fileName}:`, err.message || err);
    return [];
  }
}

function writeJsonFile(fileName, data) {
  const filePath = getDataPath(fileName);
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error(`[jsonStore] Failed to write ${fileName}:`, err.message || err);
    throw err;
  }
}

module.exports = {
  getDataPath,
  readJsonFile,
  writeJsonFile
};
