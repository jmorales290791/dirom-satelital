/**
 * DIROM SATELITAL - EELINK Protocol Parser v2.0
 * Decodifica paquetes del protocolo EELINK usado por TK419 (4G LTE)
 * 
 * Estructura de paquetes EELINK:
 * - Mark: 0x67 0x67
 * - PID: 1 byte (Package Identifier)
 * - Size: 2 bytes (tamaño desde siguiente byte hasta el final)
 * - Sequence: 2 bytes
 * - Content: variable
 */

// Package Identifiers
const PID = {
  LOGIN: 0x01,
  HEARTBEAT: 0x03,
  LOCATION: 0x12,
  WARNING: 0x14,
  REPORT: 0x15,
  MESSAGE: 0x16,
  INSTRUCTION: 0x80,
};

/**
 * Parsea un buffer TCP y extrae los paquetes EELINK
 */
function parseBuffer(buffer) {
  const packets = [];
  let offset = 0;

  while (offset < buffer.length - 5) {
    // Buscar marcador 0x6767
    if (buffer[offset] === 0x67 && buffer[offset + 1] === 0x67) {
      const pid = buffer[offset + 2];
      const size = buffer.readUInt16BE(offset + 3);
      const totalLength = 5 + size; // Mark(2) + PID(1) + Size(2) + Content(size)

      if (offset + totalLength <= buffer.length) {
        const packet = buffer.slice(offset, offset + totalLength);
        const parsed = parsePacket(packet);
        if (parsed) packets.push(parsed);
        offset += totalLength;
      } else {
        break;
      }
    } else {
      offset++;
    }
  }

  return packets;
}

/**
 * Parsea un paquete individual EELINK
 */
function parsePacket(packet) {
  try {
    const pid = packet[2];
    const size = packet.readUInt16BE(3);
    const sequence = packet.readUInt16BE(5);
    const content = packet.slice(7); // Después del sequence

    const result = { pid, sequence, raw: packet.toString('hex') };

    switch (pid) {
      case PID.LOGIN:
        return { ...result, type: 'login', ...parseLogin(content) };
      case PID.HEARTBEAT:
        return { ...result, type: 'heartbeat', ...parseHeartbeat(content) };
      case PID.LOCATION:
        return { ...result, type: 'location', ...parseLocation(content) };
      case PID.WARNING:
        return { ...result, type: 'warning', ...parseWarning(content) };
      case PID.REPORT:
        return { ...result, type: 'report', ...parseReport(content) };
      default:
        return { ...result, type: 'unknown' };
    }
  } catch (err) {
    console.error('[EELINK] Error parsing packet:', err.message);
    return null;
  }
}

/**
 * Parsea login (PID 0x01)
 * IMEI (8 bytes) + Language(1) + Timezone(1) + SysVer(2) + AppVer(2) + ...
 */
function parseLogin(data) {
  // IMEI: 8 bytes en formato BCD/hex
  const imeiBuffer = data.slice(0, 8);
  let imei = '';
  for (let i = 0; i < 8; i++) {
    imei += imeiBuffer[i].toString(16).padStart(2, '0');
  }
  // El IMEI real tiene 15 dígitos, remover el primer 0
  imei = imei.replace(/^0+/, '');
  if (imei.length > 15) imei = imei.substring(0, 15);

  const language = data[8]; // 0x00=Chinese, 0x01=English
  const timezone = data.readInt8(9); // en unidades de 15 min

  return { imei, language, timezone };
}

/**
 * Parsea heartbeat (PID 0x03)
 * Status(2 bytes)
 */
function parseHeartbeat(data) {
  const status = data.readUInt16BE(0);
  return {
    gpsFixed: !!(status & 0x01),
    accOn: !!(status & 0x04),
    moving: !!(status & 0x200),
    charging: !!(status & 0x100),
    relayOn: !!(status & 0x40),
    statusRaw: status,
  };
}

/**
 * Parsea location (PID 0x12)
 * Position(variable) + Status(2) + Battery(2) + AIN0(2) + AIN1(2) + Mileage(4) + ...
 */
function parseLocation(data) {
  let offset = 0;

  // Position: Time(4) + Mask(1) + GPS Data(variable) + Cell Data(variable)
  const timestamp = data.readUInt32BE(offset); offset += 4;
  const mask = data[offset]; offset++;

  let latitude = 0, longitude = 0, altitude = 0, speed = 0, course = 0, satellites = 0;
  let gpsValid = false;

  // BIT0: GPS data válida
  if (mask & 0x01) {
    gpsValid = true;
    // Latitude: signed 32 bits (en 1/500 de segundo de arco)
    const latRaw = data.readInt32BE(offset); offset += 4;
    // Longitude: signed 32 bits (en 1/500 de segundo de arco)
    const lonRaw = data.readInt32BE(offset); offset += 4;
    // Altitude: signed 16 bits (metros)
    altitude = data.readInt16BE(offset); offset += 2;
    // Speed: unsigned 16 bits (km/h)
    speed = data.readUInt16BE(offset); offset += 2;
    // Course: unsigned 16 bits (grados)
    course = data.readUInt16BE(offset); offset += 2;
    // Satellites: 1 byte
    satellites = data[offset]; offset++;

    // Convertir coordenadas: 1/500 de segundo de arco a grados decimales
    // grados = raw / (3600 * 500) = raw / 1800000
    latitude = latRaw / 1800000.0;
    longitude = lonRaw / 1800000.0;
  }

  // BIT1: BSID0 (home cell)
  if (mask & 0x02) {
    // MCC(2) + MNC(2) + LAC(2) + CID(4) + RxLev(1) = 11 bytes
    offset += 11;
  }

  // BIT2: BSID1 (1st neighbor)
  if (mask & 0x04) {
    // LAC(2) + CI(4) + RxLev(1) = 7 bytes
    offset += 7;
  }

  // BIT3: BSID2 (2nd neighbor)
  if (mask & 0x08) {
    offset += 7;
  }

  // BIT4-6: WiFi data (7 bytes cada uno)
  if (mask & 0x10) offset += 7;
  if (mask & 0x20) offset += 7;
  if (mask & 0x40) offset += 7;

  // BIT7: LTE data (variable)
  if (mask & 0x80) {
    const rat = data[offset]; offset++;
    const noc = data[offset]; offset++;
    if (noc > 0) {
      // Serving cell: MCC(2)+MNC(2)+LAC(2)+TAC(2)+CID(4)+TA(2)+PCID(2)+EARFCN(2)+RSRP(1) = 19
      offset += 19;
      // Neighbor cells: (PCID(2)+EARFCN(2)+RSRP(1)) * (noc-1) = 5*(noc-1)
      offset += 5 * (noc - 1);
    }
  }

  // Ahora vienen los datos adicionales del location package
  let statusRaw = 0, battery = 0, mileage = 0;
  let accOn = false, ignition = false;

  if (offset + 2 <= data.length) {
    statusRaw = data.readUInt16BE(offset); offset += 2;
    accOn = !!(statusRaw & 0x04);
    ignition = accOn;
  }
  if (offset + 2 <= data.length) {
    battery = data.readUInt16BE(offset); offset += 2;
  }
  // AIN0(2) + AIN1(2)
  if (offset + 4 <= data.length) offset += 4;
  // Mileage(4)
  if (offset + 4 <= data.length) {
    mileage = data.readUInt32BE(offset); offset += 4;
  }

  return {
    timestamp: new Date(timestamp * 1000),
    latitude,
    longitude,
    altitude,
    speed,
    course,
    satellites,
    gpsValid,
    battery,
    mileage,
    ignition,
    accOn,
    statusRaw,
  };
}

/**
 * Parsea warning (PID 0x14)
 */
function parseWarning(data) {
  // Position data primero, luego Warning(1) + Status(2)
  const locData = parseLocation(data);

  // El warning type está después de la position data
  // Como la position es variable, buscamos el byte de warning
  const warningTypes = {
    0x01: 'power_cut',
    0x02: 'sos',
    0x03: 'low_battery',
    0x04: 'vibration',
    0x05: 'shift',
    0x08: 'gps_antenna_open',
    0x09: 'gps_antenna_short',
    0x82: 'overspeed',
    0x83: 'enter_geofence',
    0x84: 'exit_geofence',
    0x85: 'shock',
    0x86: 'freefall',
  };

  // Intentar extraer el tipo de alarma del final
  let alarm = 'unknown';
  if (data.length > 2) {
    const warnByte = data[data.length - 3]; // Warning type antes de Status(2)
    alarm = warningTypes[warnByte] || `unknown_0x${warnByte.toString(16)}`;
  }

  return { ...locData, alarm };
}

/**
 * Parsea report (PID 0x15)
 * Position + Report(1) + Status(2)
 */
function parseReport(data) {
  const locData = parseLocation(data);
  const reportTypes = {
    0x01: 'acc_on',
    0x02: 'acc_off',
    0x03: 'din_changed',
  };

  let reportType = 'unknown';
  if (data.length > 2) {
    const reportByte = data[data.length - 3];
    reportType = reportTypes[reportByte] || `unknown_0x${reportByte.toString(16)}`;
  }

  return { ...locData, reportType };
}

// ==================== RESPUESTAS AL DISPOSITIVO ====================

/**
 * Genera respuesta de Login
 * Mark(2) + PID(1) + Size(2) + Sequence(2) + Time(4) + Version(2) + PSAction(1)
 */
function buildLoginResponse(sequence) {
  const response = Buffer.alloc(14);
  response[0] = 0x67;
  response[1] = 0x67;
  response[2] = PID.LOGIN; // PID
  response.writeUInt16BE(9, 3); // Size: Sequence(2) + Time(4) + Version(2) + PSAction(1)
  response.writeUInt16BE(sequence, 5); // Sequence
  response.writeUInt32BE(Math.floor(Date.now() / 1000), 7); // Time UTC
  response.writeUInt16BE(0x0002, 11); // Protocol version 2 (soporta LTE)
  response[13] = 0x00; // PS Action: no upload param-set
  return response;
}

/**
 * Genera respuesta de Heartbeat
 * Mark(2) + PID(1) + Size(2) + Sequence(2)
 */
function buildHeartbeatResponse(sequence) {
  const response = Buffer.alloc(7);
  response[0] = 0x67;
  response[1] = 0x67;
  response[2] = PID.HEARTBEAT;
  response.writeUInt16BE(2, 3); // Size: solo Sequence
  response.writeUInt16BE(sequence, 5);
  return response;
}

/**
 * Genera respuesta de Location (para UDP, en TCP no es necesario)
 */
function buildLocationResponse(sequence) {
  const response = Buffer.alloc(7);
  response[0] = 0x67;
  response[1] = 0x67;
  response[2] = PID.LOCATION;
  response.writeUInt16BE(2, 3);
  response.writeUInt16BE(sequence, 5);
  return response;
}

/**
 * Genera respuesta de Warning
 */
function buildWarningResponse(sequence, content = '') {
  const contentBuf = Buffer.from(content, 'utf8');
  const response = Buffer.alloc(7 + contentBuf.length);
  response[0] = 0x67;
  response[1] = 0x67;
  response[2] = PID.WARNING;
  response.writeUInt16BE(2 + contentBuf.length, 3);
  response.writeUInt16BE(sequence, 5);
  if (contentBuf.length > 0) {
    contentBuf.copy(response, 7);
  }
  return response;
}

/**
 * Detecta si un buffer es protocolo EELINK (empieza con 0x6767)
 */
function isEelinkProtocol(buffer) {
  return buffer.length >= 2 && buffer[0] === 0x67 && buffer[1] === 0x67;
}

module.exports = {
  parseBuffer,
  parsePacket,
  buildLoginResponse,
  buildHeartbeatResponse,
  buildLocationResponse,
  buildWarningResponse,
  isEelinkProtocol,
  PID,
};
