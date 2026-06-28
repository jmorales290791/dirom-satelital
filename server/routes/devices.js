/**
 * DIROM SATELITAL - Rutas de Dispositivos GPS
 */

const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware/auth');

module.exports = function(db, tcpServer) {
  router.use(authenticateToken);

  /**
   * GET /api/devices
   * Listar dispositivos (admin: todos, client: solo los suyos)
   */
  router.get('/', (req, res) => {
    try {
      let devices;
      if (req.user.role === 'admin') {
        devices = db.getAllDevices();
      } else {
        devices = db.getDevicesByUser(req.user.id);
      }
      res.json(devices);
    } catch (err) {
      res.status(500).json({ error: 'Error al obtener dispositivos' });
    }
  });

  /**
   * GET /api/devices/:id
   * Obtener dispositivo por ID
   */
  router.get('/:id', (req, res) => {
    try {
      const device = db._get('SELECT * FROM devices WHERE id = ?', [parseInt(req.params.id)]);
      if (!device) {
        return res.status(404).json({ error: 'Dispositivo no encontrado' });
      }

      // Verificar que el usuario tenga acceso
      if (req.user.role !== 'admin' && device.user_id !== req.user.id) {
        return res.status(403).json({ error: 'No tienes acceso a este dispositivo' });
      }

      res.json(device);
    } catch (err) {
      res.status(500).json({ error: 'Error al obtener dispositivo' });
    }
  });

  /**
   * POST /api/devices
   * Crear nuevo dispositivo (solo admin)
   */
  router.post('/', requireAdmin, (req, res) => {
    try {
      const { imei, name, user_id, vehicle_plate, vehicle_type, vehicle_brand, vehicle_model, sim_number, sim_carrier } = req.body;

      if (!imei || !name || !user_id) {
        return res.status(400).json({ error: 'IMEI, nombre y usuario son requeridos' });
      }

      if (imei.length < 10) {
        return res.status(400).json({ error: 'El IMEI/ID debe tener al menos 10 dígitos' });
      }

      // Verificar IMEI duplicado
      const existing = db.getDeviceByImei(imei);
      if (existing) {
        if (existing.active === 1) {
          // Duplicado real: dispositivo activo con el mismo IMEI
          return res.status(409).json({ error: 'Ya existe un dispositivo activo con ese IMEI' });
        }

        // Fantasma de un borrado anterior (active = 0): limpiar para permitir re-alta
        console.log(`[DEVICES] Limpiando dispositivo fantasma (id=${existing.id}, imei=${imei}) para permitir re-registro`);
        db._run('DELETE FROM positions WHERE device_id = ?', [existing.id]);
        db._run('DELETE FROM alerts WHERE device_id = ?', [existing.id]);
        db._run('DELETE FROM events_log WHERE device_id = ?', [existing.id]);
        db._run('DELETE FROM trips WHERE device_id = ?', [existing.id]);
        db._run('DELETE FROM device_geofences WHERE device_id = ?', [existing.id]);
        db._run('DELETE FROM devices WHERE id = ?', [existing.id]);
        db.save();
      }

      const deviceId = db.createDevice({ imei, name, user_id, vehicle_plate, vehicle_type, vehicle_brand, vehicle_model, sim_number, sim_carrier });
      const device = db._get('SELECT * FROM devices WHERE id = ?', [deviceId]);
      res.status(201).json(device);
    } catch (err) {
      console.error('[DEVICES] Error al crear dispositivo:', err.message);
      res.status(500).json({ error: 'Error al crear dispositivo' });
    }
  });

  /**
   * PUT /api/devices/:id
   * Actualizar dispositivo (solo admin)
   */
  router.put('/:id', requireAdmin, (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const device = db._get('SELECT * FROM devices WHERE id = ?', [id]);
      if (!device) {
        return res.status(404).json({ error: 'Dispositivo no encontrado' });
      }

      db.updateDevice(id, req.body);
      const updated = db._get('SELECT * FROM devices WHERE id = ?', [id]);
      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: 'Error al actualizar dispositivo' });
    }
  });

  /**
   * DELETE /api/devices/:id
   * Desactivar dispositivo (solo admin)
   */
  router.delete('/:id', requireAdmin, (req, res) => {
    try {
      const id = parseInt(req.params.id);
      // Borrado real para permitir re-registro
      db._run('DELETE FROM positions WHERE device_id = ?', [id]);
      db._run('DELETE FROM alerts WHERE device_id = ?', [id]);
      db._run('DELETE FROM events_log WHERE device_id = ?', [id]);
      db._run('DELETE FROM trips WHERE device_id = ?', [id]);
      db._run('DELETE FROM device_geofences WHERE device_id = ?', [id]);
      db._run('DELETE FROM devices WHERE id = ?', [id]);
      db.save();
      res.json({ message: 'Dispositivo eliminado correctamente' });
    } catch (err) {
      res.status(500).json({ error: 'Error al eliminar dispositivo' });
    }
  });

  /**
   * GET /api/devices/:id/connected
   * Verificar si dispositivo está conectado al servidor TCP
   */
  router.get('/:id/connected', (req, res) => {
    try {
      const device = db._get('SELECT imei FROM devices WHERE id = ?', [parseInt(req.params.id)]);
      if (!device) {
        return res.status(404).json({ error: 'Dispositivo no encontrado' });
      }

      const connected = tcpServer ? tcpServer.getConnectedDevices().includes(device.imei) : false;
      res.json({ connected });
    } catch (err) {
      res.status(500).json({ error: 'Error al verificar conexión' });
    }
  });

  return router;
};
