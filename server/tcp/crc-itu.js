/**
 * DIROM SATELITAL - CRC-ITU (CRC-CCITT) para protocolo GT06
 * Polinomio: x^16 + x^12 + x^5 + 1 (0x1021)
 * Valor inicial: 0xFFFF
 */

function crc16ccitt(buffer) {
  let crc = 0xFFFF;

  for (let i = 0; i < buffer.length; i++) {
    crc ^= (buffer[i] << 8);
    for (let j = 0; j < 8; j++) {
      if (crc & 0x8000) {
        crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
      } else {
        crc = (crc << 1) & 0xFFFF;
      }
    }
  }

  return crc;
}

module.exports = { crc16ccitt };
