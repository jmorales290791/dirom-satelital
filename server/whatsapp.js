/**
 * DIROM SATELITAL - Módulo de WhatsApp Business Cloud API
 * Envía alertas, ubicaciones y responde consultas por WhatsApp
 * 
 * Requiere:
 * - WHATSAPP_TOKEN: Token permanente de la API
 * - WHATSAPP_PHONE_ID: ID del número de teléfono de WhatsApp Business
 * - WHATSAPP_VERIFY_TOKEN: Token para verificar webhook
 */

const GRAPH_API_URL = 'https://graph.facebook.com/v18.0';

class WhatsAppService {
  constructor(db) {
    this.db = db;
    this.token = process.env.WHATSAPP_TOKEN || '';
    this.phoneId = process.env.WHATSAPP_PHONE_ID || '';
    this.verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || 'dirom_satelital_webhook_2024';
    this.enabled = !!(this.token && this.phoneId);

    if (this.enabled) {
      console.log('[WHATSAPP] Servicio de WhatsApp activo');
    } else {
      console.log('[WHATSAPP] Servicio deshabilitado (configurar WHATSAPP_TOKEN y WHATSAPP_PHONE_ID en .env)');
    }
  }

  /**
   * Envía un mensaje de texto simple
   */
  async sendText(to, message) {
    if (!this.enabled) return { success: false, message: 'WhatsApp no configurado' };

    try {
      const response = await fetch(`${GRAPH_API_URL}/${this.phoneId}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: this.formatPhone(to),
          type: 'text',
          text: { preview_url: true, body: message },
        }),
      });

      const data = await response.json();
      if (data.messages && data.messages[0]) {
        return { success: true, messageId: data.messages[0].id };
      }
      console.error('[WHATSAPP] Error enviando:', data.error?.message || JSON.stringify(data));
      return { success: false, message: data.error?.message || 'Error desconocido' };
    } catch (err) {
      console.error('[WHATSAPP] Error de red:', err.message);
      return { success: false, message: err.message };
    }
  }

  /**
   * Envía ubicación por WhatsApp
   */
  async sendLocation(to, latitude, longitude, name, address) {
    if (!this.enabled) return { success: false, message: 'WhatsApp no configurado' };

    try {
      const response = await fetch(`${GRAPH_API_URL}/${this.phoneId}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: this.formatPhone(to),
          type: 'location',
          location: { latitude, longitude, name: name || 'Ubicación GPS', address: address || '' },
        }),
      });

      const data = await response.json();
      if (data.messages && data.messages[0]) {
        return { success: true, messageId: data.messages[0].id };
      }
      return { success: false, message: data.error?.message || 'Error' };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }

  /**
   * Envía alerta GPS por WhatsApp
   */
  async sendGpsAlert(deviceId, alertData) {
    try {
      const device = this.db._get('SELECT * FROM devices WHERE id = ?', [deviceId]);
      if (!device) return;

      // Obtener números de WhatsApp configurados para el usuario dueño
      const settings = this.db._get(
        'SELECT * FROM whatsapp_settings WHERE user_id = ? AND active = 1',
        [device.user_id]
      );
      if (!settings || !settings.notify_numbers) return;

      const numbers = settings.notify_numbers.split(',').map(n => n.trim()).filter(Boolean);
      if (numbers.length === 0) return;

      const alarmNames = {
        sos: '🚨 SOS - EMERGENCIA',
        power_cut: '⚡ Corte de Energía',
        vibration: '📳 Vibración Detectada',
        overspeed: '🏎️ Exceso de Velocidad',
        enter_geofence: '📍 Entrada a Geocerca',
        exit_geofence: '📍 Salida de Geocerca',
        low_battery: '🔋 Batería Baja',
        acc_on: '🔑 Motor Encendido',
        acc_off: '🔑 Motor Apagado',
        disassemble: '⚠️ Dispositivo Removido',
        shock: '💥 Impacto Detectado',
        freefall: '⬇️ Caída Libre',
      };

      const alarmTitle = alarmNames[alertData.alarm] || `⚠️ Alerta: ${alertData.alarm}`;
      const mapUrl = `https://www.google.com/maps?q=${alertData.latitude},${alertData.longitude}`;
      const time = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });

      const message = `*DIROM SATELITAL*\n` +
        `━━━━━━━━━━━━━━━━━\n` +
        `${alarmTitle}\n` +
        `━━━━━━━━━━━━━━━━━\n\n` +
        `🚛 *Unidad:* ${device.name}\n` +
        `🔢 *Placa:* ${device.vehicle_plate || 'N/A'}\n` +
        `📡 *IMEI:* ${device.imei}\n` +
        `🏎️ *Velocidad:* ${alertData.speed || 0} km/h\n` +
        `🕐 *Hora:* ${time}\n\n` +
        `📍 *Ubicación:*\n${mapUrl}`;

      // Enviar a todos los números configurados
      for (const number of numbers) {
        await this.sendText(number, message);

        // Si es SOS o alerta crítica, también enviar ubicación
        if (['sos', 'power_cut', 'disassemble'].includes(alertData.alarm)) {
          await this.sendLocation(number, alertData.latitude, alertData.longitude,
            `${device.name} - ${alarmTitle}`, device.vehicle_plate || '');
        }
      }

      console.log(`[WHATSAPP] Alerta "${alertData.alarm}" enviada para ${device.name}`);
    } catch (err) {
      console.error('[WHATSAPP] Error enviando alerta:', err.message);
    }
  }

  /**
   * Envía notificación de dispositivo offline
   */
  async sendOfflineAlert(imei) {
    try {
      const device = this.db.getDeviceByImei(imei);
      if (!device) return;

      const settings = this.db._get(
        'SELECT * FROM whatsapp_settings WHERE user_id = ? AND active = 1 AND notify_offline = 1',
        [device.user_id]
      );
      if (!settings || !settings.notify_numbers) return;

      const numbers = settings.notify_numbers.split(',').map(n => n.trim()).filter(Boolean);
      const time = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });

      const message = `*DIROM SATELITAL*\n` +
        `━━━━━━━━━━━━━━━━━\n` +
        `⚠️ Dispositivo Desconectado\n` +
        `━━━━━━━━━━━━━━━━━\n\n` +
        `🚛 *Unidad:* ${device.name}\n` +
        `🔢 *Placa:* ${device.vehicle_plate || 'N/A'}\n` +
        `🕐 *Hora:* ${time}\n\n` +
        `El dispositivo se ha desconectado del servidor.`;

      for (const number of numbers) {
        await this.sendText(number, message);
      }
    } catch (err) {
      console.error('[WHATSAPP] Error enviando offline:', err.message);
    }
  }

  /**
   * Procesa mensaje entrante de WhatsApp (webhook)
   * Responde a comandos como: ubicacion, estatus, ayuda
   */
  async handleIncomingMessage(from, messageBody) {
    const command = messageBody.toLowerCase().trim();

    // Buscar usuario por número de teléfono
    const settings = this.db._get(
      'SELECT * FROM whatsapp_settings WHERE notify_numbers LIKE ? AND active = 1',
      [`%${from.slice(-10)}%`]
    );

    if (!settings) {
      await this.sendText(from, '❌ Tu número no está registrado en DIROM SATELITAL.\nContacta al administrador.');
      return;
    }

    const userId = settings.user_id;
    const user = this.db.getUserById(userId);

    switch (true) {
      case command === 'ayuda' || command === 'help' || command === 'menu':
        await this.sendHelpMenu(from, user);
        break;

      case command === 'ubicacion' || command === 'ubicación' || command === 'ubi' || command === 'gps':
        await this.sendAllLocations(from, userId, user);
        break;

      case command === 'estatus' || command === 'status' || command === 'estado':
        await this.sendFleetStatus(from, userId, user);
        break;

      case command.startsWith('buscar ') || command.startsWith('unidad '):
        const query = command.replace(/^(buscar|unidad)\s+/, '');
        await this.sendDeviceLocation(from, userId, query);
        break;

      case command === 'alertas':
        await this.sendRecentAlerts(from, userId);
        break;

      default:
        await this.sendText(from,
          `👋 Hola ${user ? user.name : ''}!\n\n` +
          `No entendí tu mensaje. Escribe *ayuda* para ver los comandos disponibles.`
        );
    }
  }

  /**
   * Envía menú de ayuda
   */
  async sendHelpMenu(to, user) {
    const message = `*🛰️ DIROM SATELITAL*\n` +
      `━━━━━━━━━━━━━━━━━\n` +
      `Hola ${user ? user.name : ''}! Estos son los comandos disponibles:\n\n` +
      `📍 *ubicacion* - Ver ubicación de todas tus unidades\n` +
      `📊 *estatus* - Resumen de tu flota\n` +
      `🔍 *buscar [nombre/placa]* - Buscar una unidad específica\n` +
      `🔔 *alertas* - Ver alertas recientes\n` +
      `❓ *ayuda* - Ver este menú\n\n` +
      `_Ejemplo: buscar trailer rojo_`;

    await this.sendText(to, message);
  }

  /**
   * Envía ubicación de todas las unidades del usuario
   */
  async sendAllLocations(to, userId, user) {
    const devices = this.db._all(`
      SELECT * FROM devices WHERE user_id = ? AND active = 1 AND last_latitude IS NOT NULL
      ORDER BY name
    `, [userId]);

    if (devices.length === 0) {
      await this.sendText(to, '📍 No hay unidades con ubicación disponible.');
      return;
    }

    let message = `*🛰️ DIROM SATELITAL*\n`;
    message += `📍 *Ubicación de tus unidades:*\n`;
    message += `━━━━━━━━━━━━━━━━━\n\n`;

    for (const dev of devices) {
      const status = dev.status === 'online' ? '🟢' : '🔴';
      const speed = dev.last_speed ? `${dev.last_speed} km/h` : 'Detenido';
      const mapUrl = `https://maps.google.com/?q=${dev.last_latitude},${dev.last_longitude}`;
      const lastUpdate = dev.last_update ? new Date(dev.last_update).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' }) : 'N/A';

      message += `${status} *${dev.name}*${dev.vehicle_plate ? ' (' + dev.vehicle_plate + ')' : ''}\n`;
      message += `   🏎️ ${speed} | 🕐 ${lastUpdate}\n`;
      message += `   📍 ${mapUrl}\n\n`;
    }

    await this.sendText(to, message);

    // Si hay solo 1-3 unidades, enviar ubicación nativa también
    if (devices.length <= 3) {
      for (const dev of devices) {
        await this.sendLocation(to, dev.last_latitude, dev.last_longitude,
          dev.name, dev.vehicle_plate || '');
      }
    }
  }

  /**
   * Envía estatus de la flota
   */
  async sendFleetStatus(to, userId, user) {
    const total = this.db._get('SELECT COUNT(*) as count FROM devices WHERE user_id = ? AND active = 1', [userId])?.count || 0;
    const online = this.db._get("SELECT COUNT(*) as count FROM devices WHERE user_id = ? AND status = 'online' AND active = 1", [userId])?.count || 0;
    const todayAlerts = this.db._get(`
      SELECT COUNT(*) as count FROM alerts a
      JOIN devices d ON a.device_id = d.id
      WHERE d.user_id = ? AND DATE(a.created_at) = DATE('now')
    `, [userId])?.count || 0;

    const message = `*🛰️ DIROM SATELITAL*\n` +
      `━━━━━━━━━━━━━━━━━\n` +
      `📊 *Resumen de tu flota:*\n\n` +
      `🚛 Total unidades: *${total}*\n` +
      `🟢 En línea: *${online}*\n` +
      `🔴 Fuera de línea: *${total - online}*\n` +
      `🔔 Alertas hoy: *${todayAlerts}*\n\n` +
      `Escribe *ubicacion* para ver dónde están tus unidades.`;

    await this.sendText(to, message);
  }

  /**
   * Busca y envía ubicación de una unidad específica
   */
  async sendDeviceLocation(to, userId, query) {
    const device = this.db._get(`
      SELECT * FROM devices 
      WHERE user_id = ? AND active = 1 AND (name LIKE ? OR vehicle_plate LIKE ? OR imei LIKE ?)
      LIMIT 1
    `, [userId, `%${query}%`, `%${query}%`, `%${query}%`]);

    if (!device) {
      await this.sendText(to, `❌ No encontré ninguna unidad con "${query}".\nIntenta con otro nombre, placa o IMEI.`);
      return;
    }

    if (!device.last_latitude) {
      await this.sendText(to, `📍 *${device.name}* no tiene ubicación disponible todavía.`);
      return;
    }

    const status = device.status === 'online' ? '🟢 En línea' : '🔴 Fuera de línea';
    const speed = device.last_speed ? `${device.last_speed} km/h` : 'Detenido';
    const mapUrl = `https://maps.google.com/?q=${device.last_latitude},${device.last_longitude}`;
    const lastUpdate = device.last_update ? new Date(device.last_update).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' }) : 'N/A';

    const message = `*🛰️ DIROM SATELITAL*\n` +
      `━━━━━━━━━━━━━━━━━\n` +
      `🚛 *${device.name}*\n\n` +
      `🔢 Placa: ${device.vehicle_plate || 'N/A'}\n` +
      `📡 IMEI: ${device.imei}\n` +
      `${status}\n` +
      `🏎️ Velocidad: ${speed}\n` +
      `🕐 Última actualización: ${lastUpdate}\n\n` +
      `📍 *Ubicación:*\n${mapUrl}`;

    await this.sendText(to, message);
    await this.sendLocation(to, device.last_latitude, device.last_longitude,
      device.name, device.vehicle_plate || '');
  }

  /**
   * Envía alertas recientes
   */
  async sendRecentAlerts(to, userId) {
    const alerts = this.db._all(`
      SELECT a.*, d.name as device_name, d.vehicle_plate
      FROM alerts a
      JOIN devices d ON a.device_id = d.id
      WHERE d.user_id = ?
      ORDER BY a.created_at DESC
      LIMIT 10
    `, [userId]);

    if (alerts.length === 0) {
      await this.sendText(to, '🔔 No tienes alertas recientes.');
      return;
    }

    let message = `*🛰️ DIROM SATELITAL*\n`;
    message += `🔔 *Últimas alertas:*\n`;
    message += `━━━━━━━━━━━━━━━━━\n\n`;

    for (const alert of alerts) {
      const time = new Date(alert.created_at).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
      message += `• *${alert.device_name}* - ${alert.message || alert.type}\n  🕐 ${time}\n\n`;
    }

    await this.sendText(to, message);
  }

  /**
   * Formatea número de teléfono (quita +, espacios, guiones)
   */
  formatPhone(phone) {
    return phone.replace(/[\s\-\+\(\)]/g, '');
  }

  /**
   * Verifica si el servicio está activo
   */
  isActive() {
    return this.enabled;
  }
}

module.exports = WhatsAppService;
