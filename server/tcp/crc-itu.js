/**
 * DIROM SATELITAL - CRC-ITU para protocolo GT06
 *
 * GT06 usa CRC-ITU (equivalente a CRC-16/X-25):
 *   - Polinomio: 0x1021 (reflejado: 0x8408)
 *   - Valor inicial: 0xFFFF
 *   - Bits reflejados (refin/refout = true)
 *   - XOR final: 0xFFFF
 *
 * Vector de prueba: CRC de [0x05,0x01,0x00,0x01] = 0xD9DC
 * (respuesta de login estandar: 78 78 05 01 00 01 D9 DC 0D 0A)
 */

function crc16ccitt(buffer) {
  let crc = 0xFFFF;

  for (let i = 0; i < buffer.length; i++) {
    crc ^= buffer[i];
    for (let j = 0; j < 8; j++) {
      if (crc & 0x0001) {
        crc = (crc >>> 1) ^ 0x8408;
      } else {
        crc = crc >>> 1;
      }
    }
  }

  // XOR final con 0xFFFF
  return (~crc) & 0xFFFF;
}

module.exports = { crc16ccitt };
