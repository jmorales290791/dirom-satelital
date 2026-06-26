/**
 * DIROM SATELITAL - Rutas de WhatsApp (Webhook + Config)
 * 
 * Endpoints:
 * - GET  /api/whatsapp/webhook  -> Verificación del webhook por Meta
 * - POST /api/whatsapp/webhook  -> Recibir mensajes entrantes
 * - GET  /api/whatsapp/settings -> Obtener configuración
 * - POST /api/whatsapp/settings -> Guardar configuración
 * - POST /api/whatsapp/test     -> Enviar mensaje de prueba
 */

const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware/auth');

module.exports = function(db, whatsappService) {

  // ==================== WEBHOOK (sin autenticación) ====================

  /**
   * GET /api/whatsapp/webhook
   * Meta envía un GET para verificar el webhook al configurarlo
   */
  router.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === whatsappService.verifyToken) {
      console.log('[WHATSAPP] Webhook verificado correctamente');
      return res.status(200).send(challenge);
    }

    console.log('[WHATSAPP] Verificación de webhook fallida');
    return res.sendStatus(403);
  });

  /**
   * POST /api/whatsapp/webhook
   * Meta envía mensajes entrantes aquí
   */
  router.post('/webhook', async (req, res) => {
    // Siempre responder 200 rápido para que Meta no reintente
    res.sendStatus(200);

    try {
      const body = req.body;

      if (body.object !== 'whatsapp_business_account') return;

      const entries = body.entry || [];
      for (const entry of entries) {
        const changes = entry.changes || [];
        for (const change of changes) {
          if (change.field !== 'messages') continue;

          const value = change.value;
          if (!value || !value.messages) continue;

          const messages = value.messages;
          for (const msg of messages) {
            // Solo procesar mensajes de texto
            if (msg.type === 'text' && msg.text && msg.text.body) {
              const from = msg.from; // Número del remitente
              const text = msg.text.body;

              console.log(`[WHATSAPP] Mensaje de ${from}: "${text}"`);

              // Procesar el comando
              await whatsappService.handleIncomingMessage(from, text);
            }

            // Procesar mensajes de ubicación compartida
            if (msg.type === 'location' && msg.location) {
              const from = msg.from;
              console.log(`[WHATSAPP] Ubicación recibida de ${from}: ${msg.location.latitude}, ${msg.location.longitude}`);
              // Por ahora solo confirmar recepción
              await whatsappService.sendText(from, '📍 Ubicación recibida. Escribe *ayuda* para ver comandos.');
            }
          }
        }
      }
    } catch (err) {
      console.error('[WHATSAPP] Error procesando webhook:', err.message);
    }
  });

  // ==================== CONFIGURACIÓN (requiere auth) ====================

  /**
   * GET /api/whatsapp/settings
   * Obtener configuración de WhatsApp del usuario actual
   */
  router.get('/settings', authenticateToken, (req, res) => {
    try {
      const userId = req.user.role === 'admin' && req.query.user_id
        ? parseInt(req.query.user_id)
        : req.user.id;

      const settings = db._get('SELECT * FROM whatsapp_settings WHERE user_id = ?', [userId]);
      res.json(settings || { user_id: userId, active: 0, notify_numbers: '', notify_alerts: 1, notify_geofence: 1, notify_offline: 0 });
    } catch (err) {
      res.status(500).json({ error: 'Error al obtener configuración' });
    }
  });

  /**
   * POST /api/whatsapp/settings
   * Guardar configuración de WhatsApp
   */
  router.post('/settings', authenticateToken, (req, res) => {
    try {
      const { notify_numbers, notify_alerts, notify_geofence, notify_offline, user_id } = req.body;
      const targetUserId = (req.user.role === 'admin' && user_id) ? user_id : req.user.id;

      const existing = db._get('SELECT id FROM whatsapp_settings WHERE user_id = ?', [targetUserId]);

      if (existing) {
        db._run(
          'UPDATE whatsapp_settings SET notify_numbers = ?, notify_alerts = ?, notify_geofence = ?, notify_offline = ?, active = 1 WHERE user_id = ?',
          [notify_numbers || '', notify_alerts ? 1 : 0, notify_geofence ? 1 : 0, notify_offline ? 1 : 0, targetUserId]
        );
      } else {
        db._run(
          'INSERT INTO whatsapp_settings (user_id, notify_numbers, notify_alerts, notify_geofence, notify_offline, active) VALUES (?, ?, ?, ?, ?, 1)',
          [targetUserId, notify_numbers || '', notify_alerts ? 1 : 0, notify_geofence ? 1 : 0, notify_offline ? 1 : 0]
        );
      }

      db.save();
      res.json({ message: 'Configuración de WhatsApp guardada' });
    } catch (err) {
      console.error('[WHATSAPP] Error guardando config:', err.message);
      res.status(500).json({ error: 'Error al guardar configuración' });
    }
  });

  /**
   * POST /api/whatsapp/test
   * Enviar mensaje de prueba
   */
  router.post('/test', authenticateToken, async (req, res) => {
    try {
      const { phone } = req.body;
      if (!phone) return res.status(400).json({ error: 'Número de teléfono requerido' });

      const result = await whatsappService.sendText(phone,
        '✅ *DIROM SATELITAL*\n\nMensaje de prueba exitoso. Tu integración de WhatsApp está funcionando correctamente.'
      );

      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  /**
   * GET /api/whatsapp/status
   * Verificar si WhatsApp está configurado y activo
   */
  router.get('/status', authenticateToken, (req, res) => {
    res.json({
      enabled: whatsappService.isActive(),
      phoneId: whatsappService.phoneId ? '***' + whatsappService.phoneId.slice(-4) : null,
    });
  });

  return router;
};
