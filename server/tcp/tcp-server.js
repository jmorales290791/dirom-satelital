/**
 * DIROM SATELITAL - Servidor TCP para dispositivos GPS
 * Escucha conexiones TCP de múltiples protocolos:
 *   - GT06 (iStartek VT200-L) - paquetes inician con 0x7878 o 0x7979
 *   - EELINK v2.0 (TK419 4G LTE) - paquetes inician con 0x6767
 * Puerto por defecto: 5023
 */

const net = require('net');
const gt06 = require('./gt06-parser');
const eelink = require('./eelink-parser');

class TcpGpsServer {
  constructor(port, db, wsServer) {
    this.port = port;
    this.db = db;
    this.wsServer = wsServer;
    this.server = null;
    this.connections = new Map(); // imei -> socket
    this.geofenceChecker = null;
    this.notificationService = null;
  }

  start() {
    this.server = net.createServer((socket) => {
      this.handleConnection(socket);
    });

    this.server.listen(this.port, () => {
      console.log(`[TCP] Servidor GPS escuchando en puerto ${this.port}`);
    });

    this.server.on('error', (err) => {
      console.error('[TCP] Error del servidor:', err.message);
    });
  }

  handleConnection(socket) {
    const remoteAddress = `${socket.remoteAddress}:${socket.remotePort}`;
    let deviceImei = null;
    let protocol = null; // 'gt06' | 'eelink' - auto-detectado

    console.log(`[TCP] Nueva conexión desde ${remoteAddress}`);

    socket.on('data', (data) => {
      try {
        // Auto-detectar protocolo con el primer paquete
        if (!protocol) {
          if (eelink.isEelinkProtocol(data)) {
            protocol = 'eelink';
          } else {
            protocol = 'gt06';
          }
          console.log(`[TCP] Protocolo detectado: ${protocol.toUpperCase()} desde ${remoteAddress}`);
        }

        // Parsear según protocolo detectado
        const packets = protocol === 'eelink'
          ? eelink.parseBuffer(data)
          : gt06.parseBuffer(data);

        for (const packet of packets) {
          if (!packet) continue;

          switch (packet.type) {
            case 'login':
              deviceImei = packet.imei;
              this.connections.set(deviceImei, socket);
              console.log(`[TCP] Dispositivo login (${protocol}): IMEI ${deviceImei}`);
              
              // Responder según protocolo
              if (protocol === 'eelink') {
                socket.write(eelink.buildLoginResponse(packet.sequence));
              } else {
                socket.write(gt06.buildLoginResponse(packet.serial));
              }
              
              // Actualizar estado del dispositivo en BD
              this.db.updateDeviceStatus(deviceImei, 'online');
              
              // Registrar evento de conexión
              this.db.logEvent(deviceImei, 'connect', 'Dispositivo conectado al servidor');
              
              // Notificar via WebSocket
              this.broadcastStatus(deviceImei, 'online');
              break;

            case 'heartbeat':
              // Responder heartbeat
              if (protocol === 'eelink') {
                socket.write(eelink.buildHeartbeatResponse(packet.sequence));
                if (deviceImei) {
                  this.db.updateDeviceInfo(deviceImei, {
                    ignition: packet.accOn ? 1 : 0,
                    charging: packet.charging ? 1 : 0,
                  });
                }
              } else {
                socket.write(gt06.buildHeartbeatResponse(packet.serial));
                if (deviceImei) {
                  this.db.updateDeviceInfo(deviceImei, {
                    voltage: packet.voltage,
                    gsmSignal: packet.gsmSignal,
                    ignition: packet.ignition,
                    charging: packet.charging,
                  });
                }
              }
              break;

            case 'location':
            case 'gps_lbs':
            case 'alarm':
            case 'warning':
            case 'report':
              if (deviceImei && packet.gpsValid) {
                // Guardar posición en BD
                const position = {
                  imei: deviceImei,
                  latitude: packet.latitude,
                  longitude: packet.longitude,
                  speed: packet.speed,
                  course: packet.course,
                  satellites: packet.satellites,
                  timestamp: packet.timestamp,
                  alarm: packet.alarm || null,
                };

                this.db.savePosition(position);

                // Registrar evento si hay alarma
                if (packet.alarm && packet.alarm !== 'normal') {
                  this.db.logEvent(deviceImei, packet.alarm, `Alarma: ${packet.alarm}`, position);
                }

                // Gestión de viajes: detectar ACC/ignición
                if (packet.accOn || packet.ignition) {
                  this.db.startTrip(deviceImei, packet.latitude, packet.longitude);
                }

                // Enviar posición en tiempo real via WebSocket
                this.broadcastPosition(deviceImei, position);

                // Verificar geocercas
                if (this.geofenceChecker) {
                  this.geofenceChecker.check(deviceImei, packet.latitude, packet.longitude);
                }

                // Enviar notificación de alerta por email
                if (packet.alarm && packet.alarm !== 'normal' && this.notificationService) {
                  const dev = this.db.getDeviceByImei(deviceImei);
                  if (dev) {
                    this.notificationService.sendAlertNotification(dev.id, {
                      alarm: packet.alarm,
                      latitude: packet.latitude,
                      longitude: packet.longitude,
                      speed: packet.speed,
                    });
                    // También enviar por WhatsApp
                    if (this.whatsappService) {
                      this.whatsappService.sendGpsAlert(dev.id, {
                        alarm: packet.alarm,
                        latitude: packet.latitude,
                        longitude: packet.longitude,
                        speed: packet.speed,
                      });
                    }
                  }
                }

                console.log(`[TCP] ${deviceImei} -> Lat: ${packet.latitude.toFixed(6)}, Lon: ${packet.longitude.toFixed(6)}, Vel: ${packet.speed} km/h`);
              }

              // Para EELINK warnings, responder
              if (protocol === 'eelink' && packet.type === 'warning') {
                socket.write(eelink.buildWarningResponse(packet.sequence));
              }
              break;

            case 'status':
              if (deviceImei) {
                this.db.updateDeviceInfo(deviceImei, {
                  voltage: packet.voltage,
                  gsmSignal: packet.gsmSignal,
                  ignition: packet.ignition,
                });
              }
              break;

            default:
              console.log(`[TCP] Paquete tipo '${packet.type}' de ${deviceImei || 'desconocido'}`);
          }
        }
      } catch (err) {
        console.error(`[TCP] Error procesando datos de ${remoteAddress}:`, err.message);
      }
    });

    socket.on('close', () => {
      console.log(`[TCP] Desconexión: ${deviceImei || remoteAddress}`);
      if (deviceImei) {
        this.connections.delete(deviceImei);
        this.db.updateDeviceStatus(deviceImei, 'offline');
        this.broadcastStatus(deviceImei, 'offline');

        // Registrar evento de desconexión y finalizar viaje
        this.db.logEvent(deviceImei, 'disconnect', 'Dispositivo desconectado');
        this.db.endTrip(deviceImei, null, null);

        // Notificar por email si está configurado
        if (this.notificationService) {
          this.notificationService.sendOfflineNotification(deviceImei);
        }
        // Notificar por WhatsApp si está configurado
        if (this.whatsappService) {
          this.whatsappService.sendOfflineAlert(deviceImei);
        }
      }
    });

    socket.on('error', (err) => {
      console.error(`[TCP] Error socket ${deviceImei || remoteAddress}:`, err.message);
    });

    // Timeout de 5 minutos sin datos
    socket.setTimeout(300000);
    socket.on('timeout', () => {
      console.log(`[TCP] Timeout: ${deviceImei || remoteAddress}`);
      socket.destroy();
    });
  }

  /**
   * Envía posición a todos los clientes WebSocket suscritos
   */
  broadcastPosition(imei, position) {
    if (this.wsServer) {
      this.wsServer.broadcast({
        type: 'position',
        imei,
        data: position,
      });
    }
  }

  /**
   * Envía cambio de estado del dispositivo
   */
  broadcastStatus(imei, status) {
    if (this.wsServer) {
      this.wsServer.broadcast({
        type: 'device_status',
        imei,
        status,
      });
    }
  }

  /**
   * Envía un comando al dispositivo por IMEI
   */
  sendCommand(imei, command) {
    const socket = this.connections.get(imei);
    if (!socket) {
      return { success: false, message: 'Dispositivo no conectado' };
    }
    // TODO: Implementar construcción de paquete de comando GT06
    return { success: true, message: 'Comando enviado' };
  }

  /**
   * Obtiene lista de dispositivos conectados
   */
  getConnectedDevices() {
    return Array.from(this.connections.keys());
  }

  stop() {
    if (this.server) {
      this.server.close();
      this.connections.forEach((socket) => socket.destroy());
      this.connections.clear();
      console.log('[TCP] Servidor detenido');
    }
  }
}

module.exports = TcpGpsServer;
