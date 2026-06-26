/**
 * DIROM SATELITAL - Servidor WebSocket
 * Envía datos de posición en tiempo real a los clientes web
 */

const WebSocket = require('ws');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dirom_satelital_secret_key';

class WsServer {
  constructor() {
    this.wss = null;
    this.clients = new Map(); // ws -> { userId, role, subscribedImeis }
  }

  /**
   * Inicializa el servidor WebSocket sobre un servidor HTTP existente
   */
  init(server) {
    this.wss = new WebSocket.Server({ server, path: '/ws' });

    this.wss.on('connection', (ws, req) => {
      this.handleConnection(ws, req);
    });

    console.log('[WS] Servidor WebSocket iniciado en /ws');
  }

  /**
   * Maneja nueva conexión WebSocket
   */
  handleConnection(ws, req) {
    // Extraer token de la URL: /ws?token=xxx
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');

    if (!token) {
      ws.close(4001, 'Token requerido');
      return;
    }

    // Verificar token JWT
    let user;
    try {
      user = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      ws.close(4003, 'Token inválido');
      return;
    }

    // Registrar cliente
    this.clients.set(ws, {
      userId: user.id,
      role: user.role,
      subscribedImeis: new Set(),
    });

    console.log(`[WS] Cliente conectado: ${user.username} (${user.role})`);

    // Enviar confirmación
    ws.send(JSON.stringify({
      type: 'connected',
      message: 'Conectado al servidor de rastreo en tiempo real',
      user: { id: user.id, username: user.username, role: user.role },
    }));

    // Manejar mensajes del cliente
    ws.on('message', (message) => {
      this.handleMessage(ws, message);
    });

    ws.on('close', () => {
      this.clients.delete(ws);
      console.log(`[WS] Cliente desconectado: ${user.username}`);
    });

    ws.on('error', (err) => {
      console.error(`[WS] Error cliente ${user.username}:`, err.message);
      this.clients.delete(ws);
    });

    // Ping cada 30 segundos para mantener conexión
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      } else {
        clearInterval(pingInterval);
      }
    }, 30000);

    ws.on('close', () => clearInterval(pingInterval));
  }

  /**
   * Maneja mensajes entrantes del cliente
   */
  handleMessage(ws, rawMessage) {
    try {
      const message = JSON.parse(rawMessage);
      const client = this.clients.get(ws);
      if (!client) return;

      switch (message.type) {
        case 'subscribe':
          // Suscribirse a actualizaciones de dispositivos específicos
          if (Array.isArray(message.imeis)) {
            message.imeis.forEach(imei => client.subscribedImeis.add(imei));
          }
          ws.send(JSON.stringify({
            type: 'subscribed',
            imeis: Array.from(client.subscribedImeis),
          }));
          break;

        case 'unsubscribe':
          if (Array.isArray(message.imeis)) {
            message.imeis.forEach(imei => client.subscribedImeis.delete(imei));
          } else {
            client.subscribedImeis.clear();
          }
          break;

        case 'ping':
          ws.send(JSON.stringify({ type: 'pong', time: Date.now() }));
          break;

        default:
          break;
      }
    } catch (err) {
      // Ignorar mensajes malformados
    }
  }

  /**
   * Envía datos a todos los clientes que deben recibirlos
   * Usado por el servidor TCP cuando llega una posición nueva
   */
  broadcast(data) {
    if (!this.wss) return;

    const message = JSON.stringify(data);

    this.clients.forEach((client, ws) => {
      if (ws.readyState !== WebSocket.OPEN) return;

      // Admin recibe todo
      if (client.role === 'admin') {
        ws.send(message);
        return;
      }

      // Clientes reciben solo sus dispositivos suscritos
      if (data.imei && client.subscribedImeis.has(data.imei)) {
        ws.send(message);
      }
    });
  }

  /**
   * Envía mensaje a un usuario específico
   */
  sendToUser(userId, data) {
    if (!this.wss) return;

    const message = JSON.stringify(data);

    this.clients.forEach((client, ws) => {
      if (ws.readyState === WebSocket.OPEN && client.userId === userId) {
        ws.send(message);
      }
    });
  }

  /**
   * Obtiene el número de clientes conectados
   */
  getConnectedCount() {
    return this.clients.size;
  }

  /**
   * Cierra el servidor WebSocket
   */
  close() {
    if (this.wss) {
      this.wss.clients.forEach(ws => ws.close());
      this.wss.close();
      console.log('[WS] Servidor WebSocket cerrado');
    }
  }
}

module.exports = WsServer;
