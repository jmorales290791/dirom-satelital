/**
 * DIROM SATELITAL - Rutas de Posiciones e Historial
 */

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');

module.exports = function(db) {
  router.use(authenticateToken);

  /**
   * GET /api/positions/live
   * Obtener última posición de todos los dispositivos del usuario
   */
  router.get('/live', (req, res) => {
    try {
      let positions;
      if (req.user.role === 'admin') {
        // Admin ve todos los dispositivos con posición
        positions = db._all(`
          SELECT d.id, d.imei, d.name, d.vehicle_plate, d.vehicle_type, d.status,
                 d.last_latitude as latitude, d.last_longitude as longitude,
                 d.last_speed as speed, d.last_course as course, d.last_update,
                 d.voltage, d.gsm_signal, d.ignition, u.name as owner_name
          FROM devices d
          LEFT JOIN users u ON d.user_id = u.id
          WHERE d.active = 1 AND d.last_latitude IS NOT NULL
          ORDER BY d.status DESC, d.name
        `);
      } else {
        positions = db.getLastPositionsByUser(req.user.id);
      }
      res.json(positions);
    } catch (err) {
      res.status(500).json({ error: 'Error al obtener posiciones' });
    }
  });

  /**
   * GET /api/positions/history/:imei
   * Obtener historial de posiciones de un dispositivo
   */
  router.get('/history/:imei', (req, res) => {
    try {
      const { imei } = req.params;
      const { start, end, limit } = req.query;

      // Verificar acceso al dispositivo
      const device = db.getDeviceByImei(imei);
      if (!device) {
        return res.status(404).json({ error: 'Dispositivo no encontrado' });
      }

      if (req.user.role !== 'admin' && device.user_id !== req.user.id) {
        return res.status(403).json({ error: 'No tienes acceso a este dispositivo' });
      }

      const positions = db.getPositions(imei, start || null, end || null, parseInt(limit) || 1000);
      res.json(positions);
    } catch (err) {
      res.status(500).json({ error: 'Error al obtener historial' });
    }
  });

  /**
   * GET /api/positions/last/:imei
   * Obtener la última posición de un dispositivo
   */
  router.get('/last/:imei', (req, res) => {
    try {
      const { imei } = req.params;
      const device = db.getDeviceByImei(imei);
      if (!device) {
        return res.status(404).json({ error: 'Dispositivo no encontrado' });
      }

      if (req.user.role !== 'admin' && device.user_id !== req.user.id) {
        return res.status(403).json({ error: 'No tienes acceso a este dispositivo' });
      }

      const position = db.getLastPosition(imei);
      res.json(position || { message: 'Sin posiciones registradas' });
    } catch (err) {
      res.status(500).json({ error: 'Error al obtener posición' });
    }
  });

  /**
   * GET /api/positions/alerts
   * Obtener alertas del usuario
   */
  router.get('/alerts', (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 50;
      let alerts;

      if (req.user.role === 'admin') {
        alerts = db.getAllAlerts(limit);
      } else {
        alerts = db.getAlerts(req.user.id, limit);
      }

      res.json(alerts);
    } catch (err) {
      res.status(500).json({ error: 'Error al obtener alertas' });
    }
  });

  /**
   * PUT /api/positions/alerts/:id/ack
   * Marcar alerta como leída
   */
  router.put('/alerts/:id/ack', (req, res) => {
    try {
      db.acknowledgeAlert(parseInt(req.params.id));
      res.json({ message: 'Alerta marcada como leída' });
    } catch (err) {
      res.status(500).json({ error: 'Error al actualizar alerta' });
    }
  });

  /**
   * GET /api/positions/stats
   * Obtener estadísticas
   */
  router.get('/stats', (req, res) => {
    try {
      let stats;
      if (req.user.role === 'admin') {
        stats = db.getStats();
      } else {
        stats = db.getUserStats(req.user.id);
      }
      res.json(stats);
    } catch (err) {
      res.status(500).json({ error: 'Error al obtener estadísticas' });
    }
  });

  return router;
};
