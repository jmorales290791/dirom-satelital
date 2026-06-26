/**
 * DIROM SATELITAL - Verificador de Geocercas
 * Detecta entrada/salida de dispositivos en geocercas
 */

class GeofenceChecker {
  constructor(db, notificationService, wsServer) {
    this.db = db;
    this.notifications = notificationService;
    this.wsServer = wsServer;
    // Estado anterior: imei -> Set de geofence_ids donde estaba dentro
    this.deviceGeofenceState = new Map();
  }

  /**
   * Verifica si un dispositivo entró o salió de alguna geocerca
   * Se llama cada vez que se recibe una nueva posición
   */
  check(imei, latitude, longitude) {
    try {
      const device = this.db.getDeviceByImei(imei);
      if (!device) return;

      // Obtener geocercas asignadas a este dispositivo
      const geofences = this.db._all(`
        SELECT g.* FROM geofences g
        JOIN device_geofences dg ON g.id = dg.geofence_id
        WHERE dg.device_id = ? AND g.active = 1
      `, [device.id]);

      if (geofences.length === 0) return;

      // Estado anterior
      if (!this.deviceGeofenceState.has(imei)) {
        this.deviceGeofenceState.set(imei, new Set());
      }
      const prevState = this.deviceGeofenceState.get(imei);
      const currentInside = new Set();

      for (const gf of geofences) {
        const isInside = this.isInsideGeofence(latitude, longitude, gf);

        if (isInside) {
          currentInside.add(gf.id);
        }

        // Detectar ENTRADA (no estaba antes, ahora sí)
        if (isInside && !prevState.has(gf.id)) {
          this.triggerEvent(device, gf, 'enter', { latitude, longitude });
        }

        // Detectar SALIDA (estaba antes, ahora no)
        if (!isInside && prevState.has(gf.id)) {
          this.triggerEvent(device, gf, 'exit', { latitude, longitude });
        }
      }

      // Actualizar estado
      this.deviceGeofenceState.set(imei, currentInside);
    } catch (err) {
      console.error('[GEOFENCE] Error checking:', err.message);
    }
  }

  /**
   * Verifica si un punto está dentro de una geocerca
   */
  isInsideGeofence(lat, lng, geofence) {
    if (geofence.type === 'circle') {
      return this.isInsideCircle(lat, lng, geofence.center_lat, geofence.center_lng, geofence.radius);
    } else if (geofence.type === 'polygon') {
      const points = typeof geofence.polygon_points === 'string'
        ? JSON.parse(geofence.polygon_points)
        : geofence.polygon_points;
      return this.isInsidePolygon(lat, lng, points);
    }
    return false;
  }

  /**
   * Verifica si un punto está dentro de un círculo
   */
  isInsideCircle(lat, lng, centerLat, centerLng, radiusMeters) {
    const distance = this.haversineMeters(lat, lng, centerLat, centerLng);
    return distance <= radiusMeters;
  }

  /**
   * Verifica si un punto está dentro de un polígono (Ray Casting)
   */
  isInsidePolygon(lat, lng, polygon) {
    if (!polygon || polygon.length < 3) return false;

    let inside = false;
    const n = polygon.length;

    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = polygon[i][0], yi = polygon[i][1];
      const xj = polygon[j][0], yj = polygon[j][1];

      const intersect = ((yi > lng) !== (yj > lng)) &&
        (lat < (xj - xi) * (lng - yi) / (yj - yi) + xi);

      if (intersect) inside = !inside;
    }

    return inside;
  }

  /**
   * Dispara evento de geocerca
   */
  triggerEvent(device, geofence, eventType, position) {
    const eventName = eventType === 'enter' ? 'enter_geofence' : 'exit_geofence';
    const message = eventType === 'enter'
      ? `Entrada a geocerca "${geofence.name}"`
      : `Salida de geocerca "${geofence.name}"`;

    console.log(`[GEOFENCE] ${device.name} ${eventType === 'enter' ? 'ENTRÓ' : 'SALIÓ'} de "${geofence.name}"`);

    // Guardar alerta en BD
    this.db._run(
      'INSERT INTO alerts (device_id, imei, type, message, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?)',
      [device.id, device.imei, eventName, message, position.latitude, position.longitude]
    );
    this.db.save();

    // Enviar por WebSocket
    if (this.wsServer) {
      this.wsServer.broadcast({
        type: 'geofence_event',
        imei: device.imei,
        event: eventType,
        geofence: geofence.name,
        position,
      });
    }

    // Enviar notificación por email
    if (this.notifications) {
      this.notifications.sendGeofenceNotification(device.id, geofence.name, eventType, position);
    }
  }

  /**
   * Distancia Haversine en metros
   */
  haversineMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000; // metros
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  toRad(deg) {
    return deg * (Math.PI / 180);
  }
}

module.exports = GeofenceChecker;
