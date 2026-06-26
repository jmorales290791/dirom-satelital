/**
 * DIROM SATELITAL - Generador de Reportes PDF
 * Genera reportes de rutas, kilometraje, paradas y resumen de operación
 */

const PDFDocument = require('pdfkit');

class ReportGenerator {
  constructor(db) {
    this.db = db;
  }

  /**
   * Genera reporte de ruta de un dispositivo
   */
  generateRouteReport(imei, startDate, endDate) {
    return new Promise((resolve, reject) => {
      try {
        const device = this.db.getDeviceByImei(imei);
        if (!device) {
          return reject(new Error('Dispositivo no encontrado'));
        }

        const positions = this.db.getPositions(imei, startDate, endDate, 10000);
        if (positions.length === 0) {
          return reject(new Error('Sin datos para el rango seleccionado'));
        }

        // Calcular estadísticas
        const stats = this.calculateStats(positions);

        const doc = new PDFDocument({ margin: 50, size: 'LETTER' });
        const buffers = [];

        doc.on('data', (chunk) => buffers.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(buffers)));

        // Header
        this.drawHeader(doc, 'Reporte de Ruta');
        
        // Info del dispositivo
        this.drawDeviceInfo(doc, device, startDate, endDate);

        // Estadísticas
        this.drawStats(doc, stats);

        // Tabla de posiciones (primeras 50)
        this.drawPositionsTable(doc, positions.slice(0, 50));

        // Paradas detectadas
        if (stats.stops.length > 0) {
          this.drawStopsTable(doc, stats.stops);
        }

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Genera reporte general de flota
   */
  generateFleetReport(userId) {
    return new Promise((resolve, reject) => {
      try {
        const devices = userId 
          ? this.db.getDevicesByUser(userId) 
          : this.db.getAllDevices();

        const doc = new PDFDocument({ margin: 50, size: 'LETTER' });
        const buffers = [];

        doc.on('data', (chunk) => buffers.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(buffers)));

        // Header
        this.drawHeader(doc, 'Reporte de Flota');

        doc.moveDown();
        doc.fontSize(12).fillColor('#333');
        doc.text(`Fecha de generación: ${new Date().toLocaleString('es-MX')}`, { align: 'left' });
        doc.text(`Total de unidades: ${devices.length}`, { align: 'left' });
        const online = devices.filter(d => d.status === 'online').length;
        doc.text(`En línea: ${online} | Fuera de línea: ${devices.length - online}`);
        doc.moveDown();

        // Tabla de dispositivos
        this.drawFleetTable(doc, devices);

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Calcula estadísticas de un conjunto de posiciones
   */
  calculateStats(positions) {
    let totalDistance = 0;
    let maxSpeed = 0;
    let totalSpeed = 0;
    let speedCount = 0;
    const stops = [];
    let stopStart = null;

    // Posiciones ordenadas por tiempo (más antiguo primero)
    const sorted = [...positions].reverse();

    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];

      // Distancia
      const dist = this.haversine(prev.latitude, prev.longitude, curr.latitude, curr.longitude);
      totalDistance += dist;

      // Velocidad
      if (curr.speed > 0) {
        totalSpeed += curr.speed;
        speedCount++;
        if (curr.speed > maxSpeed) maxSpeed = curr.speed;
      }

      // Detectar paradas (velocidad 0 por más de 5 min)
      if (curr.speed === 0 && !stopStart) {
        stopStart = curr;
      } else if (curr.speed > 0 && stopStart) {
        const stopDuration = (new Date(curr.timestamp) - new Date(stopStart.timestamp)) / 60000;
        if (stopDuration >= 5) {
          stops.push({
            latitude: stopStart.latitude,
            longitude: stopStart.longitude,
            start: stopStart.timestamp,
            end: curr.timestamp,
            duration: Math.round(stopDuration),
          });
        }
        stopStart = null;
      }
    }

    const firstPos = sorted[0];
    const lastPos = sorted[sorted.length - 1];
    const totalTime = (new Date(lastPos.timestamp) - new Date(firstPos.timestamp)) / 3600000;

    return {
      totalDistance: Math.round(totalDistance * 100) / 100,
      maxSpeed,
      avgSpeed: speedCount > 0 ? Math.round(totalSpeed / speedCount) : 0,
      totalTime: Math.round(totalTime * 100) / 100,
      totalPositions: positions.length,
      stops,
    };
  }

  // ==================== PDF DRAWING HELPERS ====================

  drawHeader(doc, title) {
    doc.rect(0, 0, doc.page.width, 80).fill('#1a237e');
    doc.fontSize(22).fillColor('#ffffff').text('DIROM SATELITAL', 50, 25, { align: 'left' });
    doc.fontSize(10).fillColor('#b0bec5').text(title, 50, 52, { align: 'left' });
    doc.fontSize(9).text(new Date().toLocaleString('es-MX'), doc.page.width - 200, 30, { align: 'right' });
    doc.moveDown(3);
  }

  drawDeviceInfo(doc, device, startDate, endDate) {
    doc.y = 100;
    doc.fontSize(14).fillColor('#1a237e').text('Información del Vehículo');
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor('#333');
    doc.text(`Nombre: ${device.name}`);
    doc.text(`IMEI: ${device.imei}`);
    doc.text(`Placa: ${device.vehicle_plate || 'N/A'}`);
    doc.text(`Tipo: ${device.vehicle_type || 'N/A'}`);
    doc.text(`Período: ${startDate} a ${endDate}`);
    doc.moveDown();
  }

  drawStats(doc, stats) {
    doc.fontSize(14).fillColor('#1a237e').text('Resumen de Operación');
    doc.moveDown(0.5);

    // Tabla de stats
    const statsData = [
      ['Distancia Total', `${stats.totalDistance} km`],
      ['Velocidad Máxima', `${stats.maxSpeed} km/h`],
      ['Velocidad Promedio', `${stats.avgSpeed} km/h`],
      ['Tiempo Total', `${stats.totalTime} hrs`],
      ['Posiciones Registradas', `${stats.totalPositions}`],
      ['Paradas Detectadas', `${stats.stops.length}`],
    ];

    doc.fontSize(10).fillColor('#333');
    statsData.forEach(([label, value]) => {
      doc.text(`${label}: ${value}`);
    });
    doc.moveDown();
  }

  drawPositionsTable(doc, positions) {
    // Verificar espacio
    if (doc.y > doc.page.height - 200) doc.addPage();

    doc.fontSize(14).fillColor('#1a237e').text('Detalle de Posiciones (primeras 50)');
    doc.moveDown(0.5);

    // Header de tabla
    const tableTop = doc.y;
    const colWidths = [130, 80, 80, 60, 60];
    const headers = ['Fecha/Hora', 'Latitud', 'Longitud', 'Velocidad', 'Rumbo'];

    doc.fontSize(8).fillColor('#ffffff');
    doc.rect(50, tableTop, 510, 18).fill('#3949ab');
    let x = 55;
    headers.forEach((h, i) => {
      doc.text(h, x, tableTop + 5, { width: colWidths[i] });
      x += colWidths[i];
    });

    doc.fillColor('#333');
    let y = tableTop + 20;

    positions.forEach((pos, idx) => {
      if (y > doc.page.height - 60) {
        doc.addPage();
        y = 50;
      }

      if (idx % 2 === 0) {
        doc.rect(50, y - 2, 510, 14).fill('#f5f5f5');
        doc.fillColor('#333');
      }

      x = 55;
      doc.fontSize(7);
      doc.text(new Date(pos.timestamp).toLocaleString('es-MX'), x, y, { width: colWidths[0] }); x += colWidths[0];
      doc.text(pos.latitude.toFixed(6), x, y, { width: colWidths[1] }); x += colWidths[1];
      doc.text(pos.longitude.toFixed(6), x, y, { width: colWidths[2] }); x += colWidths[2];
      doc.text(`${pos.speed} km/h`, x, y, { width: colWidths[3] }); x += colWidths[3];
      doc.text(`${pos.course}°`, x, y, { width: colWidths[4] });
      y += 14;
    });

    doc.y = y + 10;
  }

  drawStopsTable(doc, stops) {
    if (doc.y > doc.page.height - 150) doc.addPage();

    doc.fontSize(14).fillColor('#1a237e').text('Paradas Detectadas (> 5 min)');
    doc.moveDown(0.5);

    const tableTop = doc.y;
    const colWidths = [130, 130, 80, 80, 80];
    const headers = ['Inicio', 'Fin', 'Duración', 'Latitud', 'Longitud'];

    doc.fontSize(8).fillColor('#ffffff');
    doc.rect(50, tableTop, 510, 18).fill('#ff8f00');
    let x = 55;
    headers.forEach((h, i) => {
      doc.text(h, x, tableTop + 5, { width: colWidths[i] });
      x += colWidths[i];
    });

    doc.fillColor('#333');
    let y = tableTop + 20;

    stops.slice(0, 30).forEach((stop, idx) => {
      if (y > doc.page.height - 60) {
        doc.addPage();
        y = 50;
      }

      if (idx % 2 === 0) {
        doc.rect(50, y - 2, 510, 14).fill('#fff8e1');
        doc.fillColor('#333');
      }

      x = 55;
      doc.fontSize(7);
      doc.text(new Date(stop.start).toLocaleString('es-MX'), x, y, { width: colWidths[0] }); x += colWidths[0];
      doc.text(new Date(stop.end).toLocaleString('es-MX'), x, y, { width: colWidths[1] }); x += colWidths[1];
      doc.text(`${stop.duration} min`, x, y, { width: colWidths[2] }); x += colWidths[2];
      doc.text(stop.latitude.toFixed(6), x, y, { width: colWidths[3] }); x += colWidths[3];
      doc.text(stop.longitude.toFixed(6), x, y, { width: colWidths[4] });
      y += 14;
    });

    doc.y = y + 10;
  }

  drawFleetTable(doc, devices) {
    const tableTop = doc.y;
    const colWidths = [100, 100, 70, 70, 60, 110];
    const headers = ['Nombre', 'IMEI', 'Placa', 'Estado', 'Vel.', 'Última Actualización'];

    doc.fontSize(8).fillColor('#ffffff');
    doc.rect(50, tableTop, 510, 18).fill('#3949ab');
    let x = 55;
    headers.forEach((h, i) => {
      doc.text(h, x, tableTop + 5, { width: colWidths[i] });
      x += colWidths[i];
    });

    doc.fillColor('#333');
    let y = tableTop + 20;

    devices.forEach((dev, idx) => {
      if (y > doc.page.height - 60) {
        doc.addPage();
        y = 50;
      }

      if (idx % 2 === 0) {
        doc.rect(50, y - 2, 510, 14).fill('#f5f5f5');
        doc.fillColor('#333');
      }

      x = 55;
      doc.fontSize(7);
      doc.text(dev.name, x, y, { width: colWidths[0] }); x += colWidths[0];
      doc.text(dev.imei, x, y, { width: colWidths[1] }); x += colWidths[1];
      doc.text(dev.vehicle_plate || '-', x, y, { width: colWidths[2] }); x += colWidths[2];
      doc.text(dev.status, x, y, { width: colWidths[3] }); x += colWidths[3];
      doc.text(dev.last_speed ? `${dev.last_speed} km/h` : '-', x, y, { width: colWidths[4] }); x += colWidths[4];
      doc.text(dev.last_update ? new Date(dev.last_update).toLocaleString('es-MX') : 'Nunca', x, y, { width: colWidths[5] });
      y += 14;
    });
  }

  /**
   * Fórmula de Haversine para calcular distancia entre 2 puntos GPS en km
   */
  haversine(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  toRad(deg) {
    return deg * (Math.PI / 180);
  }
}

module.exports = ReportGenerator;
