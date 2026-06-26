/**
 * DIROM SATELITAL - Rutas de Geocercas
 * CRUD de geocercas + asignación a dispositivos
 */

const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware/auth');

module.exports = function(db) {
  router.use(authenticateToken);

  /**
   * GET /api/geofences
   * Listar geocercas del usuario (admin: todas)
   */
  router.get('/', (req, res) => {
    try {
      let geofences;
      if (req.user.role === 'admin') {
        geofences = db._all(`
          SELECT g.*, u.name as owner_name
          FROM geofences g
          LEFT JOIN users u ON g.user_id = u.id
          WHERE g.active = 1
          ORDER BY g.created_at DESC
        `);
      } else {
        geofences = db._all(
          'SELECT * FROM geofences WHERE user_id = ? AND active = 1 ORDER BY created_at DESC',
          [req.user.id]
        );
      }

      // Agregar dispositivos asignados a cada geocerca
      geofences = geofences.map(g => {
        const devices = db._all(`
          SELECT d.id, d.imei, d.name, d.vehicle_plate
          FROM device_geofences dg
          JOIN devices d ON dg.device_id = d.id
          WHERE dg.geofence_id = ?
        `, [g.id]);
        return { ...g, devices };
      });

      res.json(geofences);
    } catch (err) {
      console.error('[GEOFENCES] Error:', err.message);
      res.status(500).json({ error: 'Error al obtener geocercas' });
    }
  });

  /**
   * GET /api/geofences/:id
   */
  router.get('/:id', (req, res) => {
    try {
      const geofence = db._get('SELECT * FROM geofences WHERE id = ? AND active = 1', [parseInt(req.params.id)]);
      if (!geofence) {
        return res.status(404).json({ error: 'Geocerca no encontrada' });
      }
      if (req.user.role !== 'admin' && geofence.user_id !== req.user.id) {
        return res.status(403).json({ error: 'Sin acceso a esta geocerca' });
      }

      const devices = db._all(`
        SELECT d.id, d.imei, d.name, d.vehicle_plate
        FROM device_geofences dg
        JOIN devices d ON dg.device_id = d.id
        WHERE dg.geofence_id = ?
      `, [geofence.id]);

      res.json({ ...geofence, devices });
    } catch (err) {
      res.status(500).json({ error: 'Error al obtener geocerca' });
    }
  });

  /**
   * POST /api/geofences
   * Crear geocerca
   */
  router.post('/', (req, res) => {
    try {
      const { name, type, center_lat, center_lng, radius, polygon_points, device_ids } = req.body;

      if (!name) {
        return res.status(400).json({ error: 'El nombre es requerido' });
      }

      if (type === 'circle' && (!center_lat || !center_lng || !radius)) {
        return res.status(400).json({ error: 'Para geocerca circular se requiere centro y radio' });
      }

      if (type === 'polygon' && (!polygon_points || polygon_points.length < 3)) {
        return res.status(400).json({ error: 'Para geocerca poligonal se requieren al menos 3 puntos' });
      }

      const userId = req.user.role === 'admin' && req.body.user_id ? req.body.user_id : req.user.id;

      const result = db._run(
        'INSERT INTO geofences (user_id, name, type, center_lat, center_lng, radius, polygon_points) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [userId, name, type || 'circle', center_lat || null, center_lng || null, radius || null, polygon_points ? JSON.stringify(polygon_points) : null]
      );

      const geofenceId = result.lastInsertRowid;

      // Asignar dispositivos
      if (device_ids && Array.isArray(device_ids)) {
        device_ids.forEach(deviceId => {
          db._run('INSERT OR IGNORE INTO device_geofences (device_id, geofence_id) VALUES (?, ?)', [deviceId, geofenceId]);
        });
      }

      db.save();
      const geofence = db._get('SELECT * FROM geofences WHERE id = ?', [geofenceId]);
      res.status(201).json(geofence);
    } catch (err) {
      console.error('[GEOFENCES] Error al crear:', err.message);
      res.status(500).json({ error: 'Error al crear geocerca' });
    }
  });

  /**
   * PUT /api/geofences/:id
   * Actualizar geocerca
   */
  router.put('/:id', (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const geofence = db._get('SELECT * FROM geofences WHERE id = ?', [id]);
      if (!geofence) {
        return res.status(404).json({ error: 'Geocerca no encontrada' });
      }

      const { name, center_lat, center_lng, radius, polygon_points, device_ids } = req.body;
      const fields = [];
      const values = [];

      if (name) { fields.push('name = ?'); values.push(name); }
      if (center_lat !== undefined) { fields.push('center_lat = ?'); values.push(center_lat); }
      if (center_lng !== undefined) { fields.push('center_lng = ?'); values.push(center_lng); }
      if (radius !== undefined) { fields.push('radius = ?'); values.push(radius); }
      if (polygon_points) { fields.push('polygon_points = ?'); values.push(JSON.stringify(polygon_points)); }

      if (fields.length > 0) {
        values.push(id);
        db._run(`UPDATE geofences SET ${fields.join(', ')} WHERE id = ?`, values);
      }

      // Actualizar dispositivos asignados
      if (device_ids && Array.isArray(device_ids)) {
        db._run('DELETE FROM device_geofences WHERE geofence_id = ?', [id]);
        device_ids.forEach(deviceId => {
          db._run('INSERT INTO device_geofences (device_id, geofence_id) VALUES (?, ?)', [deviceId, id]);
        });
      }

      db.save();
      res.json({ message: 'Geocerca actualizada' });
    } catch (err) {
      res.status(500).json({ error: 'Error al actualizar geocerca' });
    }
  });

  /**
   * DELETE /api/geofences/:id
   */
  router.delete('/:id', (req, res) => {
    try {
      const id = parseInt(req.params.id);
      db._run('UPDATE geofences SET active = 0 WHERE id = ?', [id]);
      db._run('DELETE FROM device_geofences WHERE geofence_id = ?', [id]);
      db.save();
      res.json({ message: 'Geocerca eliminada' });
    } catch (err) {
      res.status(500).json({ error: 'Error al eliminar geocerca' });
    }
  });

  /**
   * POST /api/geofences/:id/devices
   * Asignar dispositivos a geocerca
   */
  router.post('/:id/devices', (req, res) => {
    try {
      const geofenceId = parseInt(req.params.id);
      const { device_ids } = req.body;

      if (!device_ids || !Array.isArray(device_ids)) {
        return res.status(400).json({ error: 'device_ids es requerido (array)' });
      }

      device_ids.forEach(deviceId => {
        db._run('INSERT OR IGNORE INTO device_geofences (device_id, geofence_id) VALUES (?, ?)', [deviceId, geofenceId]);
      });

      db.save();
      res.json({ message: 'Dispositivos asignados' });
    } catch (err) {
      res.status(500).json({ error: 'Error al asignar dispositivos' });
    }
  });

  return router;
};
