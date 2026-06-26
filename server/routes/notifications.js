/**
 * DIROM SATELITAL - Rutas de Configuración de Notificaciones
 */

const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware/auth');

module.exports = function(db, notificationService) {
  router.use(authenticateToken);

  /**
   * GET /api/notifications/settings
   * Obtener configuración de email del usuario o admin
   */
  router.get('/settings', (req, res) => {
    try {
      let settings;
      if (req.user.role === 'admin' && req.query.user_id) {
        settings = db._get('SELECT * FROM email_settings WHERE user_id = ?', [parseInt(req.query.user_id)]);
      } else {
        settings = db._get('SELECT * FROM email_settings WHERE user_id = ?', [req.user.id]);
      }

      if (settings) {
        // No enviar la contraseña SMTP
        settings.smtp_pass = settings.smtp_pass ? '••••••••' : '';
      }

      res.json(settings || { user_id: req.user.id, active: 0 });
    } catch (err) {
      res.status(500).json({ error: 'Error al obtener configuración' });
    }
  });

  /**
   * GET /api/notifications/settings/all
   * Obtener todas las configuraciones (admin)
   */
  router.get('/settings/all', requireAdmin, (req, res) => {
    try {
      const settings = db._all(`
        SELECT es.*, u.name as user_name, u.username
        FROM email_settings es
        JOIN users u ON es.user_id = u.id
        ORDER BY u.name
      `);
      // Ocultar passwords
      settings.forEach(s => { s.smtp_pass = s.smtp_pass ? '••••••••' : ''; });
      res.json(settings);
    } catch (err) {
      res.status(500).json({ error: 'Error al obtener configuraciones' });
    }
  });

  /**
   * POST /api/notifications/settings
   * Crear o actualizar configuración de email
   */
  router.post('/settings', (req, res) => {
    try {
      const { smtp_host, smtp_port, smtp_user, smtp_pass, from_email, notify_alerts, notify_geofence, notify_offline, notification_emails, user_id } = req.body;
      
      const targetUserId = (req.user.role === 'admin' && user_id) ? user_id : req.user.id;

      const existing = db._get('SELECT id FROM email_settings WHERE user_id = ?', [targetUserId]);

      if (existing) {
        const fields = ['active = 1'];
        const values = [];

        if (smtp_host !== undefined) { fields.push('smtp_host = ?'); values.push(smtp_host); }
        if (smtp_port !== undefined) { fields.push('smtp_port = ?'); values.push(smtp_port); }
        if (smtp_user !== undefined) { fields.push('smtp_user = ?'); values.push(smtp_user); }
        if (smtp_pass && smtp_pass !== '••••••••') { fields.push('smtp_pass = ?'); values.push(smtp_pass); }
        if (from_email !== undefined) { fields.push('from_email = ?'); values.push(from_email); }
        if (notify_alerts !== undefined) { fields.push('notify_alerts = ?'); values.push(notify_alerts ? 1 : 0); }
        if (notify_geofence !== undefined) { fields.push('notify_geofence = ?'); values.push(notify_geofence ? 1 : 0); }
        if (notify_offline !== undefined) { fields.push('notify_offline = ?'); values.push(notify_offline ? 1 : 0); }
        if (notification_emails !== undefined) { fields.push('notification_emails = ?'); values.push(notification_emails); }

        values.push(targetUserId);
        db._run(`UPDATE email_settings SET ${fields.join(', ')} WHERE user_id = ?`, values);
      } else {
        db._run(
          'INSERT INTO email_settings (user_id, smtp_host, smtp_port, smtp_user, smtp_pass, from_email, notify_alerts, notify_geofence, notify_offline, notification_emails) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [targetUserId, smtp_host || '', smtp_port || 587, smtp_user || '', smtp_pass || '', from_email || '', notify_alerts ? 1 : 0, notify_geofence ? 1 : 0, notify_offline ? 1 : 0, notification_emails || '']
        );
      }

      db.save();
      res.json({ message: 'Configuración guardada correctamente' });
    } catch (err) {
      console.error('[NOTIFICATIONS] Error:', err.message);
      res.status(500).json({ error: 'Error al guardar configuración' });
    }
  });

  /**
   * POST /api/notifications/test
   * Probar conexión SMTP
   */
  router.post('/test', async (req, res) => {
    try {
      const { smtp_host, smtp_port, smtp_user, smtp_pass } = req.body;

      if (!smtp_host || !smtp_user || !smtp_pass) {
        return res.status(400).json({ error: 'Host, usuario y contraseña SMTP son requeridos' });
      }

      const result = await notificationService.testConnection({ smtp_host, smtp_port, smtp_user, smtp_pass });
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  return router;
};
