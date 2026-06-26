/**
 * DIROM SATELITAL - GT06 Protocol Parser
 * Decodifica paquetes del protocolo GT06 usado por iStartek VT200-L
 * 
 * Estructura de paquetes GT06:
 * - Start: 0x7878 (paquete corto) o 0x7979 (paquete largo)
 * - Length: 1 byte (7878) o 2 bytes (7979)
 * - Protocol Number: 1 byte (identifica tipo de mensaje)
 * - Data: variable
 * - Serial: 2 bytes
 * - CRC: 2 bytes (CRC-ITU)
 * - End: 0x0D0A
 */

const { crc16ccitt } = require('./crc-itu');

// Protocol Numbers
const PROTOCOL = {
  LOGIN: 0x01,
  LOCATION: 0x12,
  STATUS: 0x13,
  HEARTBEAT: 0x23,
  STRING: 0x15,
  ALARM: 0x26,
  GPS_LBS_STATUS: 0x16,
  GPS_LBS_1: 0x22,
  GPS_LBS_2: 0x2C,
  COMMAND_RESPONSE: 0x21,
};

/**
 * Parsea un buffer TCP completo y extrae los paquetes GT06
 */
function parseBuffer(buffer) {
  const packets = [];
  let offset = 0;

  while (offset < buffer.length - 4) {
    // Buscar inicio de paquete
    if (buffer[offset] === 0x78 && buffer[offset + 1] === 0x78) {
      // Paquete corto (7878)
      const length = buffer[offset + 2];
      const totalLength = length + 5; // 2(start) + 1(length) + length + 2(end)
      
      if (offset + totalLength <= buffer.length) {
        const packet = buffer.slice(offset, offset + totalLength);
        const parsed = parsePacket(packet, false);
        if (parsed) packets.push(parsed);
        offset += totalLength;
      } else {
        break;
      }
    } else if (buffer[offset] === 0x79 && buffer[offset + 1] === 0x79) {
      // Paquete largo (7979)
      const length = buffer.readUInt16BE(offset + 2);
      const totalLength = length + 6; // 2(start) + 2(length) + length + 2(end)
      
      if (offset + totalLength <= buffer.length) {
        const packet = buffer.slice(offset, offset + totalLength);
        const parsed = parsePacket(packet, true);
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
 * Parsea un paquete individual GT06
 */
function parsePacket(packet, isLong) {
  try {
    const headerSize = isLong ? 4 : 3;
    const protocolNumber = packet[headerSize];
    const data = packet.slice(headerSize + 1, packet.length - 4); // Sin serial, CRC, end
    const serial = packet.readUInt16BE(packet.length - 4);

    const result = {
      protocolNumber,
      serial,
      raw: packet.toString('hex'),
    };

    switch (protocolNumber) {
      case PROTOCOL.LOGIN:
        return { ...result, type: 'login', ...parseLogin(data) };
      case PROTOCOL.LOCATION:
        return { ...result, type: 'location', ...parseLocation(data) };
      case PROTOCOL.HEARTBEAT:
        return { ...result, type: 'heartbeat', ...parseHeartbeat(data) };
      case PROTOCOL.STATUS:
        return { ...result, type: 'status', ...parseStatus(data) };
      case PROTOCOL.ALARM:
        return { ...result, type: 'alarm', ...parseAlarm(data) };
      case PROTOCOL.GPS_LBS_STATUS:
      case PROTOCOL.GPS_LBS_1:
      case PROTOCOL.GPS_LBS_2:
        return { ...result, type: 'gps_lbs', ...parseGpsLbs(data) };
      default:
        return { ...result, type: 'unknown' };
    }
  } catch (err) {
    console.error('[GT06] Error parsing packet:', err.message);
    return null;
  }
}

/**
 * Parsea paquete de login (0x01)
 * Contiene el IMEI del dispositivo (8 bytes BCD)
 */
function parseLogin(data) {
  // IMEI en formato BCD, 8 bytes
  const imeiHex = data.slice(0, 8).toString('hex');
  // Remover el primer dígito (siempre 0) para obtener 15 dígitos del IMEI
  const imei = imeiHex.replace(/^0/, '');
  
  return { imei };
}

/**
 * Parsea datos de localización GPS
 */
function parseLocation(data) {
  return parseGpsData(data, 0);
}

/**
 * Parsea datos GPS desde un offset dado
 */
function parseGpsData(data, offset) {
  // Fecha y hora (6 bytes): YY MM DD HH MM SS
  const year = 2000 + data[offset];
  const month = data[offset + 1];
  const day = data[offset + 2];
  const hour = data[offset + 3];
  const minute = data[offset + 4];
  const second = data[offset + 5];
  
  const timestamp = new Date(year, month - 1, day, hour, minute, second);

  // GPS info byte
  const gpsInfoLength = (data[offset + 6] >> 4) & 0x0F;
  const satellites = data[offset + 6] & 0x0F;

  // Latitud (4 bytes) - en minutos * 30000
  const latRaw = data.readUInt32BE(offset + 7);
  let latitude = latRaw / 1800000.0;

  // Longitud (4 bytes) - en minutos * 30000
  const lonRaw = data.readUInt32BE(offset + 11);
  let longitude = lonRaw / 1800000.0;

  // Velocidad (1 byte) en km/h
  const speed = data[offset + 15];

  // Curso/dirección (2 bytes)
  const courseStatus = data.readUInt16BE(offset + 16);
  
  // Bit 12: 0=Norte, 1=Sur
  // Bit 11: 0=Este, 1=Oeste
  // Bit 10: GPS positioning (1=real time)
  const isSouth = (courseStatus >> 12) & 0x01;
  const isWest = (courseStatus >> 11) & 0x01;
  const isGpsValid = (courseStatus >> 10) & 0x01;
  const course = courseStatus & 0x03FF; // últimos 10 bits

  if (isSouth) latitude = -latitude;
  if (isWest) longitude = -longitude;

  return {
    timestamp,
    latitude,
    longitude,
    speed,
    course,
    satellites,
    gpsValid: isGpsValid === 1,
  };
}

/**
 * Parsea heartbeat (0x23)
 */
function parseHeartbeat(data) {
  const terminalInfo = data[0];
  const voltage = data.readUInt16BE(1);
  const gsmSignal = data[3];
  
  return {
    charging: (terminalInfo >> 7) & 0x01,
    ignition: (terminalInfo >> 1) & 0x01,
    voltage: voltage / 100, // Voltaje en V
    gsmSignal,
  };
}

/**
 * Parsea status (0x13)
 */
function parseStatus(data) {
  return parseHeartbeat(data);
}

/**
 * Parsea alarma (0x26)
 */
function parseAlarm(data) {
  const gpsData = parseGpsData(data, 0);
  
  // El byte de alarma está después de los datos GPS+LBS
  const alarmType = data[data.length - 1];
  const alarmNames = {
    0x00: 'normal',
    0x01: 'sos',
    0x02: 'power_cut',
    0x03: 'vibration',
    0x04: 'enter_geofence',
    0x05: 'exit_geofence',
    0x06: 'overspeed',
    0x09: 'displacement',
    0x0A: 'enter_gps_dead_zone',
    0x0B: 'exit_gps_dead_zone',
    0x0C: 'power_on',
    0x0D: 'gps_first_fix',
    0x0E: 'low_battery',
    0x0F: 'low_battery_protection',
    0x10: 'sim_change',
    0x11: 'power_off',
    0x12: 'airplane_mode',
    0x13: 'disassemble',
    0x14: 'door',
    0xFF: 'acc_on',
    0xFE: 'acc_off',
  };

  return {
    ...gpsData,
    alarm: alarmNames[alarmType] || `unknown_0x${alarmType.toString(16)}`,
    alarmCode: alarmType,
  };
}

/**
 * Parsea GPS+LBS combinado (0x16, 0x22, 0x2C)
 */
function parseGpsLbs(data) {
  const gpsData = parseGpsData(data, 0);
  
  // LBS data empieza después de GPS (18 bytes)
  // MCC(2) + MNC(1) + LAC(2) + CellID(3)
  let lbs = {};
  if (data.length > 18) {
    const lbsOffset = 18;
    if (data.length > lbsOffset + 7) {
      lbs = {
        mcc: data.readUInt16BE(lbsOffset),
        mnc: data[lbsOffset + 2],
        lac: data.readUInt16BE(lbsOffset + 3),
        cellId: (data[lbsOffset + 5] << 16) | data.readUInt16BE(lbsOffset + 6),
      };
    }
  }

  return { ...gpsData, lbs };
}

/**
 * Genera respuesta de login para el dispositivo
 */
function buildLoginResponse(serial) {
  const response = Buffer.alloc(10);
  response[0] = 0x78;
  response[1] = 0x78;
  response[2] = 0x05; // length
  response[3] = PROTOCOL.LOGIN; // protocol number
  response.writeUInt16BE(serial, 4); // serial
  
  // CRC sobre bytes 2 a 5 (length + protocol + serial)
  const crcData = response.slice(2, 6);
  const crc = crc16ccitt(crcData);
  response.writeUInt16BE(crc, 6);
  
  response[8] = 0x0D;
  response[9] = 0x0A;
  
  return response;
}

/**
 * Genera respuesta de heartbeat
 */
function buildHeartbeatResponse(serial) {
  const response = Buffer.alloc(10);
  response[0] = 0x78;
  response[1] = 0x78;
  response[2] = 0x05;
  response[3] = PROTOCOL.HEARTBEAT;
  response.writeUInt16BE(serial, 4);
  
  const crcData = response.slice(2, 6);
  const crc = crc16ccitt(crcData);
  response.writeUInt16BE(crc, 6);
  
  response[8] = 0x0D;
  response[9] = 0x0A;
  
  return response;
}

module.exports = {
  parseBuffer,
  parsePacket,
  buildLoginResponse,
  buildHeartbeatResponse,
  PROTOCOL,
};
