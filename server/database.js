/**
 * DIROM SATELITAL - Base de Datos SQLite (sql.js)
 * Gestión de usuarios, dispositivos y posiciones GPS
 */

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

class TrackerDB {
  constructor(dbPath) {
    this.dbPath = dbPath || path.join(__dirname, '..', 'data', 'tracker.db');
    this.db = null;
    this.ready = false;
  }

  async initialize() {
    const SQL = await initSqlJs();
    
    // Crear directorio data si no existe
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Cargar BD existente o crear nueva
    if (fs.existsSync(this.dbPath)) {
      const buffer = fs.readFileSync(this.dbPath);
      this.db = new SQL.Database(buffer);
    } else {
      this.db = new SQL.Database();
    }

    this.db.run('PRAGMA journal_mode = WAL');
    this.db.run('PRAGMA foreign_keys = ON');
    this.init();
    this.ready = true;
    return this;
  }

  /**
   * Guarda la base de datos a disco
   */
  save() {
    if (this.db) {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(this.dbPath, buffer);
    }
  }

  /**
   * Inicializa las tablas de la base de datos
   */
  init() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        name TEXT NOT NULL,
        email TEXT,
        phone TEXT,
        company TEXT,
        role TEXT DEFAULT 'client' CHECK(role IN ('admin', 'client')),
        active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS devices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        imei TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        user_id INTEGER NOT NULL,
        vehicle_plate TEXT,
        vehicle_type TEXT DEFAULT 'trailer',
        vehicle_brand TEXT,
        vehicle_model TEXT,
        sim_number TEXT,
        sim_carrier TEXT,
        status TEXT DEFAULT 'offline' CHECK(status IN ('online', 'offline', 'inactive')),
        voltage REAL,
        gsm_signal INTEGER,
        ignition INTEGER DEFAULT 0,
        charging INTEGER DEFAULT 0,
        last_latitude REAL,
        last_longitude REAL,
        last_speed REAL,
        last_course REAL,
        last_update DATETIME,
        active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS positions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id INTEGER NOT NULL,
        imei TEXT NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        speed REAL DEFAULT 0,
        course REAL DEFAULT 0,
        satellites INTEGER DEFAULT 0,
        alarm TEXT,
        timestamp DATETIME NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (device_id) REFERENCES devices(id)
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id INTEGER NOT NULL,
        imei TEXT NOT NULL,
        type TEXT NOT NULL,
        message TEXT,
        latitude REAL,
        longitude REAL,
        acknowledged INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (device_id) REFERENCES devices(id)
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS geofences (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        type TEXT DEFAULT 'circle' CHECK(type IN ('circle', 'polygon')),
        center_lat REAL,
        center_lng REAL,
        radius REAL,
        polygon_points TEXT,
        active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS device_geofences (
        device_id INTEGER NOT NULL,
        geofence_id INTEGER NOT NULL,
        PRIMARY KEY (device_id, geofence_id),
        FOREIGN KEY (device_id) REFERENCES devices(id),
        FOREIGN KEY (geofence_id) REFERENCES geofences(id)
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS email_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        smtp_host TEXT,
        smtp_port INTEGER DEFAULT 587,
        smtp_user TEXT,
        smtp_pass TEXT,
        from_email TEXT,
        notify_alerts INTEGER DEFAULT 1,
        notify_geofence INTEGER DEFAULT 1,
        notify_offline INTEGER DEFAULT 0,
        notification_emails TEXT,
        active INTEGER DEFAULT 1,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    // Índices
    this.db.run('CREATE INDEX IF NOT EXISTS idx_positions_imei ON positions(imei)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_positions_timestamp ON positions(timestamp)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_positions_device_time ON positions(device_id, timestamp DESC)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_devices_imei ON devices(imei)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_alerts_device ON alerts(device_id)');

    // Tabla de configuración WhatsApp
    this.db.run(`
      CREATE TABLE IF NOT EXISTS whatsapp_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL UNIQUE,
        notify_numbers TEXT,
        notify_alerts INTEGER DEFAULT 1,
        notify_geofence INTEGER DEFAULT 1,
        notify_offline INTEGER DEFAULT 0,
        active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    // Tabla de bitácora de eventos
    this.db.run(`
      CREATE TABLE IF NOT EXISTS events_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id INTEGER NOT NULL,
        imei TEXT NOT NULL,
        event_type TEXT NOT NULL,
        description TEXT,
        latitude REAL,
        longitude REAL,
        speed REAL,
        extra TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (device_id) REFERENCES devices(id)
      )
    `);

    // Tabla de viajes
    this.db.run(`
      CREATE TABLE IF NOT EXISTS trips (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id INTEGER NOT NULL,
        imei TEXT NOT NULL,
        start_time DATETIME,
        end_time DATETIME,
        start_lat REAL,
        start_lon REAL,
        end_lat REAL,
        end_lon REAL,
        distance REAL DEFAULT 0,
        max_speed REAL DEFAULT 0,
        avg_speed REAL DEFAULT 0,
        duration INTEGER DEFAULT 0,
        positions_count INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (device_id) REFERENCES devices(id)
      )
    `);

    // Índices para eventos y viajes
    this.db.run('CREATE INDEX IF NOT EXISTS idx_events_imei ON events_log(imei)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_events_type ON events_log(event_type)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_events_date ON events_log(created_at DESC)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_trips_imei ON trips(imei)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_trips_start ON trips(start_time DESC)');

    // Crear admin por defecto
    this.createDefaultAdmin();
    this.save();

    console.log('[DB] Base de datos inicializada correctamente');
  }

  // ==================== HELPERS ====================

  _get(sql, params = []) {
    const stmt = this.db.prepare(sql);
    stmt.bind(params);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return row;
    }
    stmt.free();
    return null;
  }

  _all(sql, params = []) {
    const stmt = this.db.prepare(sql);
    stmt.bind(params);
    const results = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  }

  _run(sql, params = []) {
    this.db.run(sql, params);
    return {
      lastInsertRowid: this.db.exec("SELECT last_insert_rowid()")[0]?.values[0]?.[0],
      changes: this.db.getRowsModified(),
    };
  }

  // ==================== DEFAULT ADMIN ====================

  createDefaultAdmin() {
    const admin = this._get('SELECT id FROM users WHERE username = ?', ['admin']);
    if (!admin) {
      const hashedPassword = bcrypt.hashSync('admin123', 10);
      this._run(
        'INSERT INTO users (username, password, name, email, role) VALUES (?, ?, ?, ?, ?)',
        ['admin', hashedPassword, 'Administrador', 'admin@dirom.com', 'admin']
      );
      console.log('[DB] Usuario admin creado (usuario: admin, contraseña: admin123)');
    }
  }

  // ==================== USUARIOS ====================

  createUser(userData) {
    const hashedPassword = bcrypt.hashSync(userData.password, 10);
    const result = this._run(
      'INSERT INTO users (username, password, name, email, phone, company, role) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [userData.username, hashedPassword, userData.name, userData.email || null, userData.phone || null, userData.company || null, userData.role || 'client']
    );
    this.save();
    return result.lastInsertRowid;
  }

  getUserByUsername(username) {
    return this._get('SELECT * FROM users WHERE username = ? AND active = 1', [username]);
  }

  getUserById(id) {
    return this._get('SELECT id, username, name, email, phone, company, role, active, created_at FROM users WHERE id = ?', [id]);
  }

  getAllUsers() {
    return this._all('SELECT id, username, name, email, phone, company, role, active, created_at FROM users ORDER BY created_at DESC');
  }

  updateUser(id, userData) {
    const fields = [];
    const values = [];

    if (userData.name) { fields.push('name = ?'); values.push(userData.name); }
    if (userData.email !== undefined) { fields.push('email = ?'); values.push(userData.email); }
    if (userData.phone !== undefined) { fields.push('phone = ?'); values.push(userData.phone); }
    if (userData.company !== undefined) { fields.push('company = ?'); values.push(userData.company); }
    if (userData.password) { fields.push('password = ?'); values.push(bcrypt.hashSync(userData.password, 10)); }
    if (userData.active !== undefined) { fields.push('active = ?'); values.push(userData.active); }

    fields.push("updated_at = datetime('now')");
    values.push(id);

    this._run(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values);
    this.save();
  }

  deleteUser(id) {
    this._run("UPDATE users SET active = 0, updated_at = datetime('now') WHERE id = ?", [id]);
    this.save();
  }

  validatePassword(plainPassword, hashedPassword) {
    return bcrypt.compareSync(plainPassword, hashedPassword);
  }

  // ==================== DISPOSITIVOS ====================

  createDevice(deviceData) {
    const result = this._run(
      'INSERT INTO devices (imei, name, user_id, vehicle_plate, vehicle_type, vehicle_brand, vehicle_model, sim_number, sim_carrier) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [deviceData.imei, deviceData.name, deviceData.user_id, deviceData.vehicle_plate || null, deviceData.vehicle_type || 'trailer', deviceData.vehicle_brand || null, deviceData.vehicle_model || null, deviceData.sim_number || null, deviceData.sim_carrier || null]
    );
    this.save();
    return result.lastInsertRowid;
  }

  getDeviceByImei(imei) {
    return this._get('SELECT * FROM devices WHERE imei = ?', [imei]);
  }

  getDevicesByUser(userId) {
    return this._all('SELECT * FROM devices WHERE user_id = ? AND active = 1 ORDER BY name', [userId]);
  }

  getAllDevices() {
    return this._all(`
      SELECT d.*, u.name as owner_name, u.company as owner_company
      FROM devices d
      LEFT JOIN users u ON d.user_id = u.id
      WHERE d.active = 1
      ORDER BY d.status DESC, d.name
    `);
  }

  updateDevice(id, deviceData) {
    const fields = [];
    const values = [];

    if (deviceData.name) { fields.push('name = ?'); values.push(deviceData.name); }
    if (deviceData.vehicle_plate !== undefined) { fields.push('vehicle_plate = ?'); values.push(deviceData.vehicle_plate); }
    if (deviceData.vehicle_type) { fields.push('vehicle_type = ?'); values.push(deviceData.vehicle_type); }
    if (deviceData.vehicle_brand !== undefined) { fields.push('vehicle_brand = ?'); values.push(deviceData.vehicle_brand); }
    if (deviceData.vehicle_model !== undefined) { fields.push('vehicle_model = ?'); values.push(deviceData.vehicle_model); }
    if (deviceData.sim_number !== undefined) { fields.push('sim_number = ?'); values.push(deviceData.sim_number); }
    if (deviceData.sim_carrier !== undefined) { fields.push('sim_carrier = ?'); values.push(deviceData.sim_carrier); }
    if (deviceData.user_id) { fields.push('user_id = ?'); values.push(deviceData.user_id); }

    fields.push("updated_at = datetime('now')");
    values.push(id);

    this._run(`UPDATE devices SET ${fields.join(', ')} WHERE id = ?`, values);
    this.save();
  }

  deleteDevice(id) {
    this._run("UPDATE devices SET active = 0, updated_at = datetime('now') WHERE id = ?", [id]);
    this.save();
  }

  updateDeviceStatus(imei, status) {
    this._run("UPDATE devices SET status = ?, updated_at = datetime('now') WHERE imei = ?", [status, imei]);
    this.save();
  }

  updateDeviceInfo(imei, info) {
    const fields = ["updated_at = datetime('now')"];
    const values = [];

    if (info.voltage !== undefined) { fields.push('voltage = ?'); values.push(info.voltage); }
    if (info.gsmSignal !== undefined) { fields.push('gsm_signal = ?'); values.push(info.gsmSignal); }
    if (info.ignition !== undefined) { fields.push('ignition = ?'); values.push(info.ignition); }
    if (info.charging !== undefined) { fields.push('charging = ?'); values.push(info.charging); }

    values.push(imei);
    this._run(`UPDATE devices SET ${fields.join(', ')} WHERE imei = ?`, values);
    this.save();
  }

  // ==================== POSICIONES ====================

  savePosition(posData) {
    const device = this.getDeviceByImei(posData.imei);
    if (!device) {
      console.log(`[DB] Dispositivo no registrado: ${posData.imei}`);
      return null;
    }

    const ts = posData.timestamp instanceof Date ? posData.timestamp.toISOString() : posData.timestamp;

    this._run(
      'INSERT INTO positions (device_id, imei, latitude, longitude, speed, course, satellites, alarm, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [device.id, posData.imei, posData.latitude, posData.longitude, posData.speed || 0, posData.course || 0, posData.satellites || 0, posData.alarm || null, ts]
    );

    this._run(
      "UPDATE devices SET last_latitude = ?, last_longitude = ?, last_speed = ?, last_course = ?, last_update = datetime('now'), status = 'online' WHERE imei = ?",
      [posData.latitude, posData.longitude, posData.speed || 0, posData.course || 0, posData.imei]
    );

    if (posData.alarm && posData.alarm !== 'normal') {
      this.saveAlert(device.id, posData);
    }

    this.save();
    return device.id;
  }

  getPositions(imei, startDate, endDate, limit = 1000) {
    let query = 'SELECT * FROM positions WHERE imei = ?';
    const params = [imei];

    if (startDate) { query += ' AND timestamp >= ?'; params.push(startDate); }
    if (endDate) { query += ' AND timestamp <= ?'; params.push(endDate); }

    query += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(limit);

    return this._all(query, params);
  }

  getLastPosition(imei) {
    return this._get('SELECT * FROM positions WHERE imei = ? ORDER BY timestamp DESC LIMIT 1', [imei]);
  }

  getLastPositionsByUser(userId) {
    return this._all(`
      SELECT d.id, d.imei, d.name, d.vehicle_plate, d.vehicle_type, d.status,
             d.last_latitude as latitude, d.last_longitude as longitude,
             d.last_speed as speed, d.last_course as course, d.last_update,
             d.voltage, d.gsm_signal, d.ignition
      FROM devices d
      WHERE d.user_id = ? AND d.active = 1 AND d.last_latitude IS NOT NULL
      ORDER BY d.name
    `, [userId]);
  }

  // ==================== ALERTAS ====================

  saveAlert(deviceId, posData) {
    const alarmMessages = {
      sos: 'Botón SOS activado',
      power_cut: 'Corte de energía detectado',
      vibration: 'Vibración detectada',
      overspeed: 'Exceso de velocidad',
      enter_geofence: 'Entrada a geocerca',
      exit_geofence: 'Salida de geocerca',
      low_battery: 'Batería baja',
      acc_on: 'Motor encendido',
      acc_off: 'Motor apagado',
      disassemble: 'Dispositivo removido',
    };

    this._run(
      'INSERT INTO alerts (device_id, imei, type, message, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?)',
      [deviceId, posData.imei, posData.alarm, alarmMessages[posData.alarm] || `Alarma: ${posData.alarm}`, posData.latitude, posData.longitude]
    );
  }

  getAlerts(userId, limit = 50) {
    return this._all(`
      SELECT a.*, d.name as device_name, d.vehicle_plate
      FROM alerts a
      JOIN devices d ON a.device_id = d.id
      WHERE d.user_id = ?
      ORDER BY a.created_at DESC
      LIMIT ?
    `, [userId, limit]);
  }

  getAllAlerts(limit = 100) {
    return this._all(`
      SELECT a.*, d.name as device_name, d.vehicle_plate, u.name as owner_name
      FROM alerts a
      JOIN devices d ON a.device_id = d.id
      JOIN users u ON d.user_id = u.id
      ORDER BY a.created_at DESC
      LIMIT ?
    `, [limit]);
  }

  acknowledgeAlert(alertId) {
    this._run('UPDATE alerts SET acknowledged = 1 WHERE id = ?', [alertId]);
    this.save();
  }

  // ==================== EVENTOS / BITÁCORA ====================

  logEvent(imei, eventType, description, position = {}) {
    const device = this.getDeviceByImei(imei);
    if (!device) return;

    this._run(
      'INSERT INTO events_log (device_id, imei, event_type, description, latitude, longitude, speed) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [device.id, imei, eventType, description, position.latitude || null, position.longitude || null, position.speed || null]
    );
    // No save() aquí para rendimiento, se guarda con la siguiente posición
  }

  startTrip(imei, latitude, longitude) {
    const device = this.getDeviceByImei(imei);
    if (!device) return;

    // Verificar que no haya un viaje activo
    const activeTrip = this._get("SELECT id FROM trips WHERE imei = ? AND status = 'active'", [imei]);
    if (activeTrip) return activeTrip.id;

    const result = this._run(
      "INSERT INTO trips (device_id, imei, start_time, start_lat, start_lon, status) VALUES (?, ?, datetime('now'), ?, ?, 'active')",
      [device.id, imei, latitude || 0, longitude || 0]
    );
    this.save();
    return result.lastInsertRowid;
  }

  endTrip(imei, latitude, longitude) {
    const trip = this._get("SELECT * FROM trips WHERE imei = ? AND status = 'active'", [imei]);
    if (!trip) return;

    // Calcular estadísticas del viaje
    const positions = this._all(
      'SELECT * FROM positions WHERE imei = ? AND timestamp >= ? ORDER BY timestamp ASC',
      [imei, trip.start_time]
    );

    let distance = 0, maxSpeed = 0, totalSpeed = 0, speedCount = 0;
    for (let i = 1; i < positions.length; i++) {
      const prev = positions[i - 1];
      const curr = positions[i];
      distance += this.haversine(prev.latitude, prev.longitude, curr.latitude, curr.longitude);
      if (curr.speed > maxSpeed) maxSpeed = curr.speed;
      if (curr.speed > 0) { totalSpeed += curr.speed; speedCount++; }
    }

    const startTime = new Date(trip.start_time).getTime();
    const duration = Math.round((Date.now() - startTime) / 60000); // minutos
    const avgSpeed = speedCount > 0 ? Math.round(totalSpeed / speedCount) : 0;

    this._run(
      "UPDATE trips SET end_time = datetime('now'), end_lat = ?, end_lon = ?, distance = ?, max_speed = ?, avg_speed = ?, duration = ?, positions_count = ?, status = 'completed' WHERE id = ?",
      [latitude || 0, longitude || 0, Math.round(distance * 100) / 100, maxSpeed, avgSpeed, duration, positions.length, trip.id]
    );
    this.save();
  }

  haversine(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // ==================== ESTADÍSTICAS ====================

  getStats() {
    const totalDevices = this._get('SELECT COUNT(*) as count FROM devices WHERE active = 1')?.count || 0;
    const onlineDevices = this._get("SELECT COUNT(*) as count FROM devices WHERE status = 'online' AND active = 1")?.count || 0;
    const totalUsers = this._get("SELECT COUNT(*) as count FROM users WHERE active = 1 AND role = 'client'")?.count || 0;
    const todayAlerts = this._get("SELECT COUNT(*) as count FROM alerts WHERE DATE(created_at) = DATE('now')")?.count || 0;

    return { totalDevices, onlineDevices, totalUsers, todayAlerts };
  }

  getUserStats(userId) {
    const totalDevices = this._get('SELECT COUNT(*) as count FROM devices WHERE user_id = ? AND active = 1', [userId])?.count || 0;
    const onlineDevices = this._get("SELECT COUNT(*) as count FROM devices WHERE user_id = ? AND status = 'online' AND active = 1", [userId])?.count || 0;
    const todayAlerts = this._get(`
      SELECT COUNT(*) as count FROM alerts a
      JOIN devices d ON a.device_id = d.id
      WHERE d.user_id = ? AND DATE(a.created_at) = DATE('now')
    `, [userId])?.count || 0;

    return { totalDevices, onlineDevices, todayAlerts };
  }

  close() {
    if (this.db) {
      this.save();
      this.db.close();
      console.log('[DB] Conexión cerrada');
    }
  }
}

module.exports = TrackerDB;
