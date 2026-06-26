/**
 * DIROM SATELITAL - Rutas de Reportes PDF
 */

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const ReportGenerator = require('../reports');

module.exports = function(db) {
  const reportGen = new ReportGenerator(db);
  router.use(authenticateToken);

  /**
   * GET /api/reports/route/:imei
   * Descargar reporte de ruta en PDF
   * Query: start, end (fechas ISO)
   */
  router.get('/route/:imei', async (req, res) => {
    try {
      const { imei } = req.params;
      const { start, end } = req.query;

      if (!start || !end) {
        return res.status(400).json({ error: 'Parámetros start y end son requeridos' });
      }

      // Verificar acceso
      const device = db.getDeviceByImei(imei);
      if (!device) {
        return res.status(404).json({ error: 'Dispositivo no encontrado' });
      }
      if (req.user.role !== 'admin' && device.user_id !== req.user.id) {
        return res.status(403).json({ error: 'Sin acceso a este dispositivo' });
      }

      const pdfBuffer = await reportGen.generateRouteReport(imei, start, end);

      const filename = `reporte_ruta_${device.name.replace(/\s+/g, '_')}_${start.split('T')[0]}.pdf`;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', pdfBuffer.length);
      res.send(pdfBuffer);
    } catch (err) {
      console.error('[REPORTS] Error:', err.message);
      res.status(500).json({ error: err.message || 'Error al generar reporte' });
    }
  });

  /**
   * GET /api/reports/fleet
   * Descargar reporte de flota en PDF
   */
  router.get('/fleet', async (req, res) => {
    try {
      const userId = req.user.role === 'admin' ? null : req.user.id;
      const pdfBuffer = await reportGen.generateFleetReport(userId);

      const filename = `reporte_flota_${new Date().toISOString().split('T')[0]}.pdf`;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', pdfBuffer.length);
      res.send(pdfBuffer);
    } catch (err) {
      console.error('[REPORTS] Error flota:', err.message);
      res.status(500).json({ error: err.message || 'Error al generar reporte' });
    }
  });

  /**
   * GET /api/reports/stats/:imei
   * Obtener estadísticas sin PDF (para mostrar en frontend)
   */
  router.get('/stats/:imei', (req, res) => {
    try {
      const { imei } = req.params;
      const { start, end } = req.query;

      const device = db.getDeviceByImei(imei);
      if (!device) {
        return res.status(404).json({ error: 'Dispositivo no encontrado' });
      }
      if (req.user.role !== 'admin' && device.user_id !== req.user.id) {
        return res.status(403).json({ error: 'Sin acceso' });
      }

      const positions = db.getPositions(imei, start || null, end || null, 10000);
      if (positions.length === 0) {
        return res.json({ totalDistance: 0, maxSpeed: 0, avgSpeed: 0, totalTime: 0, totalPositions: 0, stops: [] });
      }

      const stats = reportGen.calculateStats(positions);
      res.json(stats);
    } catch (err) {
      res.status(500).json({ error: 'Error al calcular estadísticas' });
    }
  });

  return router;
};
