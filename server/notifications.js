/**
 * DIROM SATELITAL - Sistema de Notificaciones por Email
 * Envía alertas, notificaciones de geocercas y reportes por email
 */

const nodemailer = require('nodemailer');

class NotificationService {
  constructor(db) {
    this.db = db;
    this.transporters = new Map(); // userId -> transporter
  }

  /**
   * Obtiene o crea un transporter para un usuario
   */
  getTransporter(userId) {
    // Buscar configuración de email del usuario
    const settings = this.db._get('SELECT * FROM email_settings WHERE user_id = ? AND active = 1', [userId]);
    if (!settings || !settings.smtp_host || !settings.smtp_user) {
      return null;
    }

    // Crear transporter si no existe o si cambió la config
    const key = `${userId}_${settings.smtp_host}_${settings.smtp_user}`;
    if (!this.transporters.has(key)) {
      const transporter = nodemailer.createTransport({
        host: settings.smtp_host,
        port: settings.smtp_port || 587,
        secure: settings.smtp_port === 465,
        auth: {
          user: settings.smtp_user,
          pass: settings.smtp_pass,
        },
        tls: { rejectUnauthorized: false },
      });
      this.transporters.set(key, { transporter, settings });
    }

    return this.transporters.get(key);
  }

  /**
   * Envía notificación de alerta a los emails configurados
   */
  async sendAlertNotification(deviceId, alertData) {
    try {
      const device = this.db._get('SELECT * FROM devices WHERE id = ?', [deviceId]);
      if (!device) return;

      const settings = this.db._get(
        'SELECT * FROM email_settings WHERE user_id = ? AND active = 1 AND notify_alerts = 1',
        [device.user_id]
      );
      if (!settings || !settings.notification_emails) return;

      const transport = this.getTransporter(device.user_id);
      if (!transport) return;

      const emails = settings.notification_emails.split(',').map(e => e.trim()).filter(Boolean);
      if (emails.length === 0) return;

      const alarmNames = {
        sos: '🚨 SOS - Emergencia',
        power_cut: '⚡ Corte de Energía',
        vibration: '📳 Vibración Detectada',
        overspeed: '🏎️ Exceso de Velocidad',
        enter_geofence: '📍 Entrada a Geocerca',
        exit_geofence: '📍 Salida de Geocerca',
        low_battery: '🔋 Batería Baja',
        acc_on: '🔑 Motor Encendido',
        acc_off: '🔑 Motor Apagado',
        disassemble: '⚠️ Dispositivo Removido',
      };

      const alarmTitle = alarmNames[alertData.alarm] || `⚠️ Alerta: ${alertData.alarm}`;
      const mapLink = `https://www.google.com/maps?q=${alertData.latitude},${alertData.longitude}`;

      const htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #1a237e; padding: 20px; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 20px;">DIROM SATELITAL</h1>
            <p style="color: #b0bec5; margin: 5px 0 0; font-size: 12px;">Sistema de Rastreo GPS</p>
          </div>
          
          <div style="padding: 30px; background: #f5f5f5;">
            <h2 style="color: #d32f2f; margin-top: 0;">${alarmTitle}</h2>
            
            <table style="width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden;">
              <tr style="border-bottom: 1px solid #eee;">
                <td style="padding: 12px; font-weight: bold; color: #666;">Unidad:</td>
                <td style="padding: 12px;">${device.name} ${device.vehicle_plate ? '(' + device.vehicle_plate + ')' : ''}</td>
              </tr>
              <tr style="border-bottom: 1px solid #eee;">
                <td style="padding: 12px; font-weight: bold; color: #666;">IMEI:</td>
                <td style="padding: 12px;">${device.imei}</td>
              </tr>
              <tr style="border-bottom: 1px solid #eee;">
                <td style="padding: 12px; font-weight: bold; color: #666;">Ubicación:</td>
                <td style="padding: 12px;">${alertData.latitude.toFixed(6)}, ${alertData.longitude.toFixed(6)}</td>
              </tr>
              <tr style="border-bottom: 1px solid #eee;">
                <td style="padding: 12px; font-weight: bold; color: #666;">Velocidad:</td>
                <td style="padding: 12px;">${alertData.speed || 0} km/h</td>
              </tr>
              <tr>
                <td style="padding: 12px; font-weight: bold; color: #666;">Fecha/Hora:</td>
                <td style="padding: 12px;">${new Date().toLocaleString('es-MX')}</td>
              </tr>
            </table>
            
            <div style="text-align: center; margin-top: 20px;">
              <a href="${mapLink}" style="display: inline-block; background: #1a237e; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold;">
                📍 Ver en Mapa
              </a>
            </div>
          </div>
          
          <div style="padding: 15px; text-align: center; color: #999; font-size: 11px;">
            DIROM SATELITAL - Notificación automática del sistema
          </div>
        </div>
      `;

      await transport.transporter.sendMail({
        from: settings.from_email || settings.smtp_user,
        to: emails.join(', '),
        subject: `[DIROM] ${alarmTitle} - ${device.name}`,
        html: htmlContent,
      });

      console.log(`[EMAIL] Alerta enviada a ${emails.join(', ')} para ${device.name}`);
    } catch (err) {
      console.error('[EMAIL] Error enviando alerta:', err.message);
    }
  }

  /**
   * Envía notificación de geocerca
   */
  async sendGeofenceNotification(deviceId, geofenceName, eventType, position) {
    try {
      const device = this.db._get('SELECT * FROM devices WHERE id = ?', [deviceId]);
      if (!device) return;

      const settings = this.db._get(
        'SELECT * FROM email_settings WHERE user_id = ? AND active = 1 AND notify_geofence = 1',
        [device.user_id]
      );
      if (!settings || !settings.notification_emails) return;

      const transport = this.getTransporter(device.user_id);
      if (!transport) return;

      const emails = settings.notification_emails.split(',').map(e => e.trim()).filter(Boolean);
      if (emails.length === 0) return;

      const eventText = eventType === 'enter' ? 'ENTRÓ a' : 'SALIÓ de';
      const mapLink = `https://www.google.com/maps?q=${position.latitude},${position.longitude}`;

      const htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #1a237e; padding: 20px; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 20px;">DIROM SATELITAL</h1>
            <p style="color: #b0bec5; margin: 5px 0 0; font-size: 12px;">Alerta de Geocerca</p>
          </div>
          
          <div style="padding: 30px; background: #f5f5f5;">
            <h2 style="color: #ff8f00; margin-top: 0;">📍 ${device.name} ${eventText} geocerca "${geofenceName}"</h2>
            
            <table style="width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden;">
              <tr style="border-bottom: 1px solid #eee;">
                <td style="padding: 12px; font-weight: bold; color: #666;">Unidad:</td>
                <td style="padding: 12px;">${device.name} ${device.vehicle_plate ? '(' + device.vehicle_plate + ')' : ''}</td>
              </tr>
              <tr style="border-bottom: 1px solid #eee;">
                <td style="padding: 12px; font-weight: bold; color: #666;">Evento:</td>
                <td style="padding: 12px;">${eventText} geocerca "${geofenceName}"</td>
              </tr>
              <tr style="border-bottom: 1px solid #eee;">
                <td style="padding: 12px; font-weight: bold; color: #666;">Ubicación:</td>
                <td style="padding: 12px;">${position.latitude.toFixed(6)}, ${position.longitude.toFixed(6)}</td>
              </tr>
              <tr>
                <td style="padding: 12px; font-weight: bold; color: #666;">Fecha/Hora:</td>
                <td style="padding: 12px;">${new Date().toLocaleString('es-MX')}</td>
              </tr>
            </table>
            
            <div style="text-align: center; margin-top: 20px;">
              <a href="${mapLink}" style="display: inline-block; background: #1a237e; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold;">
                📍 Ver en Mapa
              </a>
            </div>
          </div>
          
          <div style="padding: 15px; text-align: center; color: #999; font-size: 11px;">
            DIROM SATELITAL - Notificación automática del sistema
          </div>
        </div>
      `;

      await transport.transporter.sendMail({
        from: settings.from_email || settings.smtp_user,
        to: emails.join(', '),
        subject: `[DIROM] Geocerca - ${device.name} ${eventText} "${geofenceName}"`,
        html: htmlContent,
      });

      console.log(`[EMAIL] Geocerca notificada a ${emails.join(', ')}`);
    } catch (err) {
      console.error('[EMAIL] Error enviando geocerca:', err.message);
    }
  }

  /**
   * Envía notificación de dispositivo offline
   */
  async sendOfflineNotification(imei) {
    try {
      const device = this.db.getDeviceByImei(imei);
      if (!device) return;

      const settings = this.db._get(
        'SELECT * FROM email_settings WHERE user_id = ? AND active = 1 AND notify_offline = 1',
        [device.user_id]
      );
      if (!settings || !settings.notification_emails) return;

      const transport = this.getTransporter(device.user_id);
      if (!transport) return;

      const emails = settings.notification_emails.split(',').map(e => e.trim()).filter(Boolean);
      if (emails.length === 0) return;

      await transport.transporter.sendMail({
        from: settings.from_email || settings.smtp_user,
        to: emails.join(', '),
        subject: `[DIROM] ⚠️ ${device.name} se desconectó`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 30px; background: #f5f5f5;">
            <h2 style="color: #d32f2f;">⚠️ Dispositivo Desconectado</h2>
            <p>La unidad <strong>${device.name}</strong> ${device.vehicle_plate ? '(' + device.vehicle_plate + ')' : ''} se ha desconectado del servidor.</p>
            <p>IMEI: ${device.imei}</p>
            <p>Última conexión: ${device.last_update || 'Desconocida'}</p>
            <hr style="border: 1px solid #ddd;">
            <p style="color: #999; font-size: 11px;">DIROM SATELITAL - Notificación automática</p>
          </div>
        `,
      });

      console.log(`[EMAIL] Offline notificado para ${device.name}`);
    } catch (err) {
      console.error('[EMAIL] Error enviando offline:', err.message);
    }
  }

  /**
   * Verifica la configuración SMTP (test)
   */
  async testConnection(smtpConfig) {
    try {
      const transporter = nodemailer.createTransport({
        host: smtpConfig.smtp_host,
        port: smtpConfig.smtp_port || 587,
        secure: smtpConfig.smtp_port === 465,
        auth: {
          user: smtpConfig.smtp_user,
          pass: smtpConfig.smtp_pass,
        },
        tls: { rejectUnauthorized: false },
      });

      await transporter.verify();
      return { success: true, message: 'Conexión SMTP exitosa' };
    } catch (err) {
      return { success: false, message: `Error: ${err.message}` };
    }
  }
}

module.exports = NotificationService;
