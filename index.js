/**
 * DIROM SATELITAL - Servidor Principal
 * Plataforma de rastreo GPS para flotillas
 * 
 * Componentes:
 * - Express (API REST + archivos estáticos)
 * - WebSocket (actualizaciones en tiempo real)
 * - TCP Server (recibe datos de dispositivos GPS - protocolo GT06)
 * - Geocercas (detección de entrada/salida)
 * - Notificaciones por email
 * - Reportes PDF
 */

require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');

// Importar módulos del servidor
const TrackerDB = require('./server/database');
const WsServer = require('./server/websocket');
const TcpGpsServer = require('./server/tcp/tcp-server');
const GeofenceChecker = require('./server/geofence-checker');
const NotificationService = require('./server/notifications');
const WhatsAppService = require('./server/whatsapp');

// Importar rutas
const authRoutes = require('./server/routes/auth');
const usersRoutes = require('./server/routes/users');
const devicesRoutes = require('./server/routes/devices');
const positionsRoutes = require('./server/routes/positions');
const geofencesRoutes = require('./server/routes/geofences');
const reportsRoutes = require('./server/routes/reports');
const notificationsRoutes = require('./server/routes/notifications');
const whatsappRoutes = require('./server/routes/whatsapp');
const eventsRoutes = require('./server/routes/events');

// Configuración
const PORT = process.env.PORT || 3000;
const TCP_PORT = process.env.TCP_PORT || 5023;

// ==================== INICIALIZACIÓN ====================

async function startServer() {
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║        DIROM SATELITAL v1.0              ║');
  console.log('║   Plataforma de Rastreo GPS Satelital    ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log('');

  // 1. Base de datos (async init)
  const db = new TrackerDB(process.env.DB_PATH);
  await db.initialize();

  // 2. Servicios
  const notificationService = new NotificationService(db);
  const whatsappService = new WhatsAppService(db);

  // 3. Express App
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Archivos estáticos
  app.use(express.static(path.join(__dirname, 'public')));

  // Rutas API
  app.use('/api/auth', authRoutes(db));
  app.use('/api/users', usersRoutes(db));
  app.use('/api/devices', devicesRoutes(db, null));
  app.use('/api/positions', positionsRoutes(db));
  app.use('/api/geofences', geofencesRoutes(db));
  app.use('/api/reports', reportsRoutes(db));
  app.use('/api/notifications', notificationsRoutes(db, notificationService));
  app.use('/api/whatsapp', whatsappRoutes(db, whatsappService));
  app.use('/api/events', eventsRoutes(db));

  // Redirigir raíz al login
  app.get('/', (req, res) => {
    res.redirect('/login.html');
  });

  // 404 para API
  app.use('/api/*', (req, res) => {
    res.status(404).json({ error: 'Endpoint no encontrado' });
  });

  // 4. Servidor HTTP
  const server = http.createServer(app);

  // 5. WebSocket Server
  const wsServer = new WsServer();
  wsServer.init(server);

  // 6. Geofence Checker
  const geofenceChecker = new GeofenceChecker(db, notificationService, wsServer);

  // 7. TCP GPS Server
  const tcpServer = new TcpGpsServer(TCP_PORT, db, wsServer);
  tcpServer.geofenceChecker = geofenceChecker;
  tcpServer.notificationService = notificationService;
  tcpServer.whatsappService = whatsappService;

  // ==================== ARRANQUE ====================

  server.listen(PORT, () => {
    console.log(`[HTTP] Servidor web en http://localhost:${PORT}`);
    console.log(`[HTTP] Login: http://localhost:${PORT}/login.html`);
    console.log('');

    // Iniciar servidor TCP para GPS
    tcpServer.start();

    console.log('[GEOFENCE] Verificador de geocercas activo');
    console.log('[EMAIL] Servicio de notificaciones activo');
    console.log('[REPORTS] Generador de reportes PDF activo');
    console.log('');
    console.log('─────────────────────────────────────────');
    console.log(' Credenciales por defecto:');
    console.log('   Usuario: admin');
    console.log('   Contraseña: admin123');
    console.log('─────────────────────────────────────────');
    console.log('');
    console.log(' Para conectar un GPS iStartek VT200-L:');
    console.log(`   Configurar IP del servidor y puerto ${TCP_PORT}`);
    console.log('   Protocolo: GT06');
    console.log('─────────────────────────────────────────');
    console.log('');
  });

  // ==================== GRACEFUL SHUTDOWN ====================

  process.on('SIGINT', () => {
    console.log('\n[SYSTEM] Cerrando servidor...');
    tcpServer.stop();
    wsServer.close();
    db.close();
    server.close(() => {
      console.log('[SYSTEM] Servidor cerrado correctamente');
      process.exit(0);
    });
  });

  process.on('SIGTERM', () => {
    console.log('\n[SYSTEM] SIGTERM recibido, cerrando...');
    tcpServer.stop();
    wsServer.close();
    db.close();
    server.close(() => process.exit(0));
  });
}

startServer().catch(err => {
  console.error('[FATAL] Error al iniciar servidor:', err);
  process.exit(1);
});
