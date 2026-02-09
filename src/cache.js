const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, '../data/match_cache.json');

class Cache {
  constructor() {
    this.data = {};
    this.loaded = false;
  }

  load() {
    if (this.loaded) return;
    if (fs.existsSync(CACHE_FILE)) {
      try {
        this.data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
      } catch (e) {
        console.error('Failed to load cache:', e);
        this.data = {};
      }
    }
    this.loaded = true;
  }

  get(key) {
    this.load();
    return this.data[key];
  }

  set(key, value) {
    this.load();
    this.data[key] = value;
  }

  save() {
    if (!this.loaded) return;
    try {
      fs.writeFileSync(CACHE_FILE, JSON.stringify(this.data, null, 2));
      console.log(`✅ Cache saved to ${CACHE_FILE}`);
    } catch (e) {
      console.error('Failed to save cache:', e);
    }
  }
}

module.exports = new Cache();
