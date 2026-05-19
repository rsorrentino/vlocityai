const fs = require('fs-extra');
const path = require('path');

class PropertiesReader {
  constructor(filePath) {
    this.filePath = filePath;
    this.properties = {};
    this.loadProperties();
  }

  loadProperties() {
    try {
      if (fs.existsSync(this.filePath)) {
        const content = fs.readFileSync(this.filePath, 'utf8');
        this.parseProperties(content);
      }
    } catch (error) {
      console.warn(`Warning: Could not load properties from ${this.filePath}:`, error.message);
    }
  }

  parseProperties(content) {
    const lines = content.split('\n');
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      
      // Skip empty lines and comments
      if (!trimmedLine || trimmedLine.startsWith('#')) {
        continue;
      }
      
      // Parse key=value pairs
      const equalIndex = trimmedLine.indexOf('=');
      if (equalIndex > 0) {
        const key = trimmedLine.substring(0, equalIndex).trim();
        const value = trimmedLine.substring(equalIndex + 1).trim();
        this.properties[key] = value;
      }
    }
  }

  get(key, defaultValue = null) {
    return this.properties[key] || defaultValue;
  }

  getWithEnv(key, env = null, defaultValue = null) {
    // Try environment-specific key first (e.g., SFDX_USERNAME.dev)
    if (env) {
      const envKey = `${key}.${env}`;
      if (this.properties[envKey]) {
        return this.properties[envKey];
      }
    }
    
    // Fall back to base key
    return this.properties[key] || defaultValue;
  }

  getAll() {
    return { ...this.properties };
  }

  has(key) {
    return key in this.properties;
  }

  /**
   * Update a single key in memory and persist the whole file.
   * If the key already exists in the file, the line is updated in-place.
   * If it does not exist, it is appended.
   */
  saveKey(key, value) {
    this.properties[key] = value;

    let content = '';
    try {
      if (fs.existsSync(this.filePath)) {
        content = fs.readFileSync(this.filePath, 'utf8');
      }
    } catch (_) { /* ignore read errors — we'll write a fresh file */ }

    const lines = content.split('\n');
    let found = false;
    const updated = lines.map(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return line;
      const eq = trimmed.indexOf('=');
      if (eq > 0 && trimmed.substring(0, eq).trim() === key) {
        found = true;
        return `${key}=${value}`;
      }
      return line;
    });

    if (!found) updated.push(`${key}=${value}`);
    fs.writeFileSync(this.filePath, updated.join('\n'), 'utf8');
  }
}

module.exports = PropertiesReader;
