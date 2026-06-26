/**
 * DIROM SATELITAL - Rutas de Eventos y Bitácora
 * Log técnico + Historial de viajes
 */

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');

module.exports = function(db) {
  router.use(authenticateToken);

  /**
   * GET /api/events/log
   * Bitácora técnica: todos los eventos del GPS
   * Query: imei, type, start, end, limit, offset
   */
  router.get('/log', (req, res) => {
    try {
      const { imei, type, start, end, limit = 100, offset = 0 } = req.query;
      let query = `
        SELECT e.*, d.name as device_name, d.vehicle_plate
        FROM events_log e
        JOIN devices d ON e.device_id = d.id
        WHERE 1=1
      `;
      const params = [];

      // Filtrar por acceso del usuario
      if (req.user.role !== 'admin') {
        query += ' AND d.user_id = ?';
        params.push(req.user.id);
      }

      if (imei) { query += ' AND e.imei = ?'; params.push(imei); }
      if (type) { query += ' AND e.event_type = ?'; params.push(type); }
      if (start) { query += ' AND e.created_at >= ?'; params.push(start); }
      if (end) { query += ' AND e.created_at <= ?'; params.push(end); }

      // Count total
      const countQuery = query.replace('SELECT e.*, d.name as device_name, d.vehicle_plate', 'SELECT COUNT(*) as total');
      const total = db._get(countQuery, params)?.total || 0;

      query += ' ORDER BY e.created_at DESC LIMIT ? OFFSET ?';
      params.push(parseInt(limit), parseInt(offset));

      const events = db._all(query, params);
      res.json({ events, total, limit: parseInt(limit), offset: parseInt(offset) });
    } catch (err) {
      console.error('[EVENTS] Error:', err.message);
      res.status(500).json({ error: 'Error al obtener eventos' });
    }
  });

  /**
   * GET /api/events/trips
   * Historial de viajes: encendido -> recorrido -> apagado
   * Query: imei, start, end, limit
   */
  router.get('/trips', (req, res) => {
    try {
      const { imei, start, end, limit = 50 } = req.query;
      let query = `
        SELECT t.*, d.name as device_name, d.vehicle_plate
        FROM trips t
        JOIN devices d ON t.device_id = d.id
        WHERE 1=1
      `;
      const params = [];

      if (req.user.role !== 'admin') {
        query += ' AND d.user_id = ?';
        params.push(req.user.id);
      }

      if (imei) { query += ' AND t.imei = ?'; params.push(imei); }
      if (start) { query += ' AND t.start_time >= ?'; params.push(start); }
      if (end) { query += ' AND t.end_time <= ?'; params.push(end); }

      query += ' ORDER BY t.start_time DESC LIMIT ?';
      params.push(parseInt(limit));

      const trips = db._all(query, params);
      res.json(trips);
    } catch (err) {
      res.status(500).json({ error: 'Error al obtener viajes' });
    }
  });

  /**
   * GET /api/events/trips/:id/route
   * Obtener ruta completa de un viaje
   */
  router.get('/trips/:id/route', (req, res) => {
    try {
      const trip = db._get('SELECT * FROM trips WHERE id = ?', [parseInt(req.params.id)]);
      if (!trip) return res.status(404).json({ error: 'Viaje no encontrado' });

      const positions = db._all(
        'SELECT latitude, longitude, speed, course, timestamp FROM positions WHERE imei = ? AND timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC',
        [trip.imei, trip.start_time, trip.end_time]
      );

      res.json({ trip, positions });
    } catch (err) {
      res.status(500).json({ error: 'Error al obtener ruta' });
    }
  });

  /**
   * GET /api/events/export
   * Exportar eventos a CSV
   */
  router.get('/export', (req, res) => {
    try {
      const { imei, type, start, end } = req.query;
      let query = `
        SELECT e.created_at as fecha, d.name as unidad, d.vehicle_plate as placa, 
               e.imei, e.event_type as tipo, e.description as descripcion,
               e.latitude as lat, e.longitude as lon, e.speed as velocidad
        FROM events_log e
        JOIN devices d ON e.device_id = d.id
        WHERE 1=1
      `;
      const params = [];

      if (req.user.role !== 'admin') {
        query += ' AND d.user_id = ?';
        params.push(req.user.id);
      }
      if (imei) { query += ' AND e.imei = ?'; params.push(imei); }
      if (type) { query += ' AND e.event_type = ?'; params.push(type); }
      if (start) { query += ' AND e.created_at >= ?'; params.push(start); }
      if (end) { query += ' AND e.created_at <= ?'; params.push(end); }

      query += ' ORDER BY e.created_at DESC LIMIT 5000';

      const events = db._all(query, params);

      // Generar CSV
      let csv = 'Fecha,Unidad,Placa,IMEI,Tipo,Descripción,Latitud,Longitud,Velocidad\n';
      events.forEach(e => {
        csv += `"${e.fecha}","${e.unidad}","${e.placa || ''}","${e.imei}","${e.tipo}","${e.descripcion || ''}",${e.lat || ''},${e.lon || ''},${e.velocidad || ''}\n`;
      });

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="eventos_${new Date().toISOString().split('T')[0]}.csv"`);
      res.send('\ufeff' + csv); // BOM para Excel
    } catch (err) {
      res.status(500).json({ error: 'Error al exportar' });
    }
  });

  return router;
};
