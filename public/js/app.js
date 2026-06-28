/**
 * DIROM SATELITAL - App Principal (Dashboard)
 */

// ==================== AUTH & CONFIG ====================
const token = localStorage.getItem('token');
const user = JSON.parse(localStorage.getItem('user') || '{}');

if (!token) {
  window.location.href = '/login.html';
}

const API_BASE = '/api';
let ws = null;
let map = null;
let markers = {};
let devices = [];
let historyLayer = null;
let currentPage = 'map';

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', () => {
  initUI();
  initMap();
  loadDevices();
  connectWebSocket();

  // Auto-refresh posiciones cada 10 segundos
  setInterval(() => {
    if (currentPage === 'map') {
      loadDevices();
    }
  }, 10000);
});

function initUI() {
  // Set user info
  document.getElementById('userName').textContent = user.name || user.username;
  document.getElementById('userRole').textContent = user.role === 'admin' ? 'Administrador' : 'Cliente';
  document.getElementById('userAvatar').textContent = (user.name || user.username || 'U')[0].toUpperCase();

  // Show admin nav if admin
  if (user.role === 'admin') {
    document.getElementById('adminSection').style.display = '';
    document.getElementById('navAdminDevices').style.display = '';
    document.getElementById('navAdminUsers').style.display = '';
    document.getElementById('navAdminEmail').style.display = '';
    document.getElementById('navAdminWhatsapp').style.display = '';
  }

  // Navigation
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const page = item.dataset.page;
      if (page) navigateTo(page);
    });
  });

  // Set default history dates
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('historyEnd').value = today;
  document.getElementById('historyStart').value = today;
}

// ==================== MAP ====================
function initMap() {
  map = L.map('map', {
    center: [23.6345, -102.5528], // Centro de México
    zoom: 5,
    zoomControl: true,
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19,
  }).addTo(map);

  historyLayer = L.layerGroup().addTo(map);
}

function createMarkerIcon(status, course) {
  const color = status === 'online' ? '#00c853' : '#ef5350';
  const rotation = course || 0;
  return L.divIcon({
    className: 'custom-marker',
    html: `<div style="
      width: 32px; height: 32px;
      background: ${color};
      border: 3px solid white;
      border-radius: 50%;
      box-shadow: 0 2px 8px rgba(0,0,0,0.4);
      display: flex; align-items: center; justify-content: center;
      font-size: 14px;
      transform: rotate(${rotation}deg);
    ">🚛</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -20],
  });
}

function updateMarker(device) {
  const { imei, latitude, longitude, speed, course, name, vehicle_plate, status } = device;
  
  if (!latitude || !longitude) return;

  const popupContent = `
    <div class="popup-content">
      <h4>${name}</h4>
      <p>Placa: <span class="value">${vehicle_plate || 'N/A'}</span></p>
      <p>Velocidad: <span class="value">${speed || 0} km/h</span></p>
      <p>Dirección: <span class="value">${course || 0}°</span></p>
      <p>Estado: <span class="value">${status === 'online' ? '🟢 En línea' : '🔴 Fuera de línea'}</span></p>
      <p>Última actualización: <span class="value">${device.last_update ? new Date(device.last_update + 'Z').toLocaleString('es-MX', {timeZone: 'America/Mexico_City'}) : 'N/A'}</span></p>
      <p style="margin-top:8px;">
        <button class="btn btn-primary btn-small" onclick="showDeviceHistory('${imei}')">Ver Historial</button>
      </p>
    </div>
  `;

  if (markers[imei]) {
    markers[imei].setLatLng([latitude, longitude]);
    markers[imei].setIcon(createMarkerIcon(status, course));
    markers[imei].setPopupContent(popupContent);
  } else {
    markers[imei] = L.marker([latitude, longitude], {
      icon: createMarkerIcon(status, course),
    }).addTo(map).bindPopup(popupContent);
  }
}

// ==================== DEVICES ====================
async function loadDevices() {
  try {
    const response = await apiGet('/positions/live');
    devices = response;
    renderDeviceList(devices);
    
    // Update markers
    devices.forEach(device => updateMarker(device));
    
    // Fit bounds if we have devices
    if (devices.length > 0) {
      const bounds = devices
        .filter(d => d.latitude && d.longitude)
        .map(d => [d.latitude, d.longitude]);
      if (bounds.length > 0) {
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 12 });
      }
    }

    // Update device count
    const online = devices.filter(d => d.status === 'online').length;
    document.getElementById('deviceCount').textContent = `${online}/${devices.length} en línea`;
    document.getElementById('panelDeviceCount').textContent = devices.length;

    // Subscribe to WebSocket updates
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'subscribe',
        imeis: devices.map(d => d.imei),
      }));
    }
  } catch (err) {
    console.error('Error loading devices:', err);
  }
}

function renderDeviceList(deviceList) {
  const container = document.getElementById('deviceList');
  if (deviceList.length === 0) {
    container.innerHTML = '<p style="padding:16px;color:var(--text-secondary);font-size:13px;">No hay unidades registradas</p>';
    return;
  }

  container.innerHTML = deviceList.map(device => `
    <div class="device-item" onclick="focusDevice('${device.imei}')" data-imei="${device.imei}">
      <div class="device-icon">${device.status === 'online' ? '🟢' : '🔴'}</div>
      <div class="device-info">
        <div class="name">${device.name}</div>
        <div class="plate">${device.vehicle_plate || 'Sin placa'}</div>
        ${device.speed > 0 ? `<div class="speed">🏎️ ${device.speed} km/h</div>` : ''}
      </div>
    </div>
  `).join('');
}

function filterDevices() {
  const search = document.getElementById('deviceSearch').value.toLowerCase();
  const filtered = devices.filter(d => 
    d.name.toLowerCase().includes(search) || 
    (d.vehicle_plate && d.vehicle_plate.toLowerCase().includes(search)) ||
    d.imei.includes(search)
  );
  renderDeviceList(filtered);
}

function focusDevice(imei) {
  const device = devices.find(d => d.imei === imei);
  if (device && device.latitude && device.longitude) {
    map.setView([device.latitude, device.longitude], 15);
    if (markers[imei]) markers[imei].openPopup();
  }
}

// ==================== HISTORY ====================
let selectedHistoryImei = null;

function showDeviceHistory(imei) {
  selectedHistoryImei = imei;
  navigateTo('history');
}

async function loadHistory() {
  if (!selectedHistoryImei) {
    alert('Selecciona una unidad primero (clic en un marcador -> Ver Historial)');
    return;
  }

  const start = document.getElementById('historyStart').value;
  const end = document.getElementById('historyEnd').value;

  if (!start || !end) {
    alert('Selecciona un rango de fechas');
    return;
  }

  try {
    const positions = await apiGet(`/positions/history/${selectedHistoryImei}?start=${start}T00:00:00&end=${end}T23:59:59&limit=5000`);
    
    clearHistory();

    if (positions.length === 0) {
      alert('No se encontraron posiciones en ese rango');
      return;
    }

    // Draw polyline
    const coords = positions.map(p => [p.latitude, p.longitude]).reverse();
    const polyline = L.polyline(coords, {
      color: '#3949ab',
      weight: 4,
      opacity: 0.8,
    }).addTo(historyLayer);

    // Start marker
    L.circleMarker(coords[0], {
      radius: 8, fillColor: '#00c853', fillOpacity: 1, color: 'white', weight: 2
    }).bindPopup('Inicio de ruta').addTo(historyLayer);

    // End marker
    L.circleMarker(coords[coords.length - 1], {
      radius: 8, fillColor: '#d32f2f', fillOpacity: 1, color: 'white', weight: 2
    }).bindPopup('Fin de ruta').addTo(historyLayer);

    map.fitBounds(polyline.getBounds(), { padding: [50, 50] });
  } catch (err) {
    console.error('Error loading history:', err);
    alert('Error al cargar historial');
  }
}

function clearHistory() {
  historyLayer.clearLayers();
}

// ==================== WEBSOCKET ====================
function connectWebSocket() {
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProtocol}//${window.location.host}/ws?token=${token}`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('[WS] Conectado');
    updateConnectionStatus(true);
    
    // Subscribe to all user devices
    if (devices.length > 0) {
      ws.send(JSON.stringify({
        type: 'subscribe',
        imeis: devices.map(d => d.imei),
      }));
    }
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleWsMessage(data);
    } catch (err) {
      console.error('[WS] Error parsing message:', err);
    }
  };

  ws.onclose = () => {
    console.log('[WS] Desconectado');
    updateConnectionStatus(false);
    // Reconnect after 5 seconds
    setTimeout(connectWebSocket, 5000);
  };

  ws.onerror = (err) => {
    console.error('[WS] Error:', err);
  };
}

function handleWsMessage(data) {
  switch (data.type) {
    case 'position':
      // Update device position in real-time
      const device = devices.find(d => d.imei === data.imei);
      if (device) {
        device.latitude = data.data.latitude;
        device.longitude = data.data.longitude;
        device.speed = data.data.speed;
        device.course = data.data.course;
        device.status = 'online';
        device.last_update = new Date().toISOString();
        updateMarker(device);
        renderDeviceList(devices);
      }
      break;

    case 'device_status':
      const dev = devices.find(d => d.imei === data.imei);
      if (dev) {
        dev.status = data.status;
        updateMarker(dev);
        renderDeviceList(devices);
        const online = devices.filter(d => d.status === 'online').length;
        document.getElementById('deviceCount').textContent = `${online}/${devices.length} en línea`;
      }
      break;

    case 'connected':
      console.log('[WS] Autenticado:', data.user.username);
      break;
  }
}

function updateConnectionStatus(connected) {
  const el = document.getElementById('wsStatus');
  if (connected) {
    el.className = 'connection-status connected';
    el.innerHTML = '<span class="status-dot"></span> En vivo';
  } else {
    el.className = 'connection-status';
    el.innerHTML = '<span class="status-dot"></span> Desconectado';
  }
}

// ==================== ALERTS ====================
async function loadAlerts() {
  try {
    const alerts = await apiGet('/positions/alerts');
    const tbody = document.getElementById('alertsTable');
    
    if (alerts.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-secondary);">Sin alertas</td></tr>';
      return;
    }

    tbody.innerHTML = alerts.map(alert => `
      <tr>
        <td>${new Date(alert.created_at).toLocaleString()}</td>
        <td>${alert.device_name} ${alert.vehicle_plate ? '(' + alert.vehicle_plate + ')' : ''}</td>
        <td><span class="status-badge status-${alert.type === 'sos' ? 'offline' : 'online'}">${alert.type}</span></td>
        <td>${alert.message}</td>
        <td>${alert.acknowledged ? '✓ Leída' : '<button class="btn btn-small btn-primary" onclick="ackAlert(' + alert.id + ')">Marcar leída</button>'}</td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Error loading alerts:', err);
  }
}

async function ackAlert(id) {
  try {
    await apiPut(`/positions/alerts/${id}/ack`);
    loadAlerts();
  } catch (err) {
    console.error('Error acknowledging alert:', err);
  }
}

// ==================== NAVIGATION ====================
function navigateTo(page) {
  currentPage = page;

  // Update nav
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.page === page);
  });

  // Hide all views
  document.getElementById('mapView').style.display = 'none';
  document.getElementById('alertsView').style.display = 'none';
  document.getElementById('eventsView').style.display = 'none';
  document.getElementById('adminDevicesView').style.display = 'none';
  document.getElementById('adminUsersView').style.display = 'none';
  document.getElementById('adminEmailView').style.display = 'none';
  document.getElementById('adminWhatsappView').style.display = 'none';
  document.getElementById('geofencesView').style.display = 'none';
  document.getElementById('reportsView').style.display = 'none';
  document.getElementById('historyControls').classList.remove('show');

  switch (page) {
    case 'map':
      document.getElementById('mapView').style.display = '';
      document.getElementById('pageTitle').textContent = 'Rastreo en Vivo';
      setTimeout(() => map.invalidateSize(), 100);
      break;
    case 'history':
      document.getElementById('mapView').style.display = '';
      document.getElementById('historyControls').classList.add('show');
      document.getElementById('pageTitle').textContent = 'Historial de Rutas';
      setTimeout(() => map.invalidateSize(), 100);
      break;
    case 'alerts':
      document.getElementById('alertsView').style.display = '';
      document.getElementById('pageTitle').textContent = 'Alertas';
      loadAlerts();
      break;
    case 'events':
      document.getElementById('eventsView').style.display = '';
      document.getElementById('pageTitle').textContent = 'Eventos y Bitácora';
      loadEventsView();
      break;
    case 'geofences':
      document.getElementById('mapView').style.display = '';
      document.getElementById('geofencesView').style.display = '';
      document.getElementById('pageTitle').textContent = 'Geocercas';
      setTimeout(() => map.invalidateSize(), 100);
      loadGeofences();
      break;
    case 'reports':
      document.getElementById('reportsView').style.display = '';
      document.getElementById('pageTitle').textContent = 'Reportes';
      loadReportsView();
      break;
    case 'admin-devices':
      document.getElementById('adminDevicesView').style.display = '';
      document.getElementById('pageTitle').textContent = 'Gestión de Dispositivos';
      loadAdminDevices();
      break;
    case 'admin-users':
      document.getElementById('adminUsersView').style.display = '';
      document.getElementById('pageTitle').textContent = 'Gestión de Usuarios';
      loadAdminUsers();
      break;
    case 'admin-email':
      document.getElementById('adminEmailView').style.display = '';
      document.getElementById('pageTitle').textContent = 'Notificaciones por Email';
      loadEmailSettings();
      break;
    case 'admin-whatsapp':
      document.getElementById('adminWhatsappView').style.display = '';
      document.getElementById('pageTitle').textContent = 'WhatsApp';
      loadWhatsappSettings();
      break;
  }
}

// ==================== ADMIN: DEVICES ====================
async function loadAdminDevices() {
  try {
    const devices = await apiGet('/devices');
    const container = document.getElementById('adminDevicesView');
    
    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <h3>Dispositivos GPS</h3>
        <button class="btn btn-success btn-small" onclick="showAddDeviceModal()">+ Nuevo Dispositivo</button>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>Nombre</th>
            <th>IMEI</th>
            <th>Placa</th>
            <th>Cliente</th>
            <th>Estado</th>
            <th>Última Actualización</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          ${devices.map(d => `
            <tr>
              <td>${d.name}</td>
              <td><code>${d.imei}</code></td>
              <td>${d.vehicle_plate || '-'}</td>
              <td>${d.owner_name || '-'}</td>
              <td><span class="status-badge status-${d.status === 'online' ? 'online' : 'offline'}"><span class="status-dot"></span> ${d.status}</span></td>
              <td>${d.last_update ? new Date(d.last_update + 'Z').toLocaleString('es-MX', {timeZone: 'America/Mexico_City'}) : 'Nunca'}</td>
              <td>
                <button class="btn btn-primary btn-small" onclick="editDevice(${d.id})">Editar</button>
                <button class="btn btn-danger btn-small" onclick="deleteDevice(${d.id})">Eliminar</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    console.error('Error loading admin devices:', err);
  }
}

async function deleteDevice(id) {
  if (!confirm('¿Estás seguro de eliminar este dispositivo?')) return;
  try {
    await apiDelete(`/devices/${id}`);
    loadAdminDevices();
  } catch (err) {
    alert('Error al eliminar dispositivo');
  }
}

async function showAddDeviceModal() {
  let users = [];
  try { users = await apiGet('/users'); } catch(e) {}

  const modal = document.createElement('div');
  modal.className = 'modal-overlay show';
  modal.id = 'deviceModal';
  modal.innerHTML = `
    <div class="modal">
      <h3>Nuevo Dispositivo GPS</h3>
      <div class="form-group">
        <label>Modelo / Protocolo</label>
        <select id="devModel" style="width:100%;padding:12px;background:var(--bg-dark);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:14px;" onchange="onModelChange()">
          <option value="eelink_tk419">EELINK TK419 (4G LTE) - Protocolo EELINK</option>
          <option value="istartek_vt200l">iStartek VT200-L - Protocolo GT06</option>
          <option value="micodus_mv730">MiCODUS MV730 - Protocolo GT06 (ID)</option>
          <option value="micodus_mv720">MiCODUS MV720 - Protocolo GT06 (ID)</option>
          <option value="concox_gt06n">Concox GT06N - Protocolo GT06</option>
          <option value="coban_tk103">Coban TK103 - Protocolo GT06</option>
          <option value="sinotrack_st901">Sinotrack ST-901 - Protocolo GT06</option>
          <option value="otro_gt06">Otro (Protocolo GT06)</option>
          <option value="otro_eelink">Otro (Protocolo EELINK)</option>
        </select>
      </div>
      <div id="modelInfo" class="form-group" style="background:var(--bg-dark);border-radius:8px;padding:12px;font-size:12px;color:var(--text-secondary);line-height:1.6;"></div>
      <div class="form-group">
        <label id="devImeiLabel">IMEI del dispositivo</label>
        <input type="text" id="devImei" placeholder="Ej: 860000000000001">
        <small id="devImeiHint" style="color:var(--text-secondary);font-size:11px;"></small>
      </div>
      <div class="form-group">
        <label>Nombre / Alias</label>
        <input type="text" id="devName" placeholder="Ej: Trailer Rojo">
      </div>
      <div class="form-group">
        <label>Placa del vehículo</label>
        <input type="text" id="devPlate" placeholder="Ej: ABC-123">
      </div>
      <div class="form-group">
        <label>Tipo de vehículo</label>
        <select id="devType" style="width:100%;padding:12px;background:var(--bg-dark);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:14px;">
          <option value="trailer">Trailer</option>
          <option value="camion">Camión</option>
          <option value="camioneta">Camioneta</option>
          <option value="auto">Auto</option>
          <option value="moto">Moto</option>
          <option value="otro">Otro</option>
        </select>
      </div>
      <div class="form-group">
        <label>Asignar a cliente</label>
        <select id="devUserId" style="width:100%;padding:12px;background:var(--bg-dark);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:14px;">
          ${users.map(u => `<option value="${u.id}">${u.name} (${u.username})${u.company ? ' - ' + u.company : ''}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Número SIM</label>
        <input type="text" id="devSim" placeholder="Ej: +52 000 000 0000">
      </div>
      <div class="modal-actions">
        <button class="btn btn-cancel" onclick="closeModal('deviceModal')">Cancelar</button>
        <button class="btn btn-primary" onclick="saveDevice()">Guardar</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  onModelChange();
}

function onModelChange() {
  const model = document.getElementById('devModel').value;
  const info = document.getElementById('modelInfo');
  const label = document.getElementById('devImeiLabel');
  const hint = document.getElementById('devImeiHint');

  const models = {
    eelink_tk419: {
      label: 'IMEI del dispositivo (15 dígitos)',
      hint: 'Lo encuentras en la etiqueta del dispositivo. Ej: 864292043414695',
      port: '5023',
      protocol: 'EELINK v2.0',
      smsServer: 'SERVER,tcp://216.238.66.234:5023#',
      smsAPN: 'APN,[tu_apn]#',
      info: '📡 <b>Puerto:</b> 5023 | <b>Protocolo:</b> EELINK v2.0<br>📲 <b>SMS configurar servidor:</b><br><code>SERVER,tcp://216.238.66.234:5023#</code><br>📲 <b>SMS configurar APN:</b><br><code>APN,internet.itelcel.com#</code>'
    },
    istartek_vt200l: {
      label: 'IMEI del dispositivo (15 dígitos)',
      hint: 'Lo encuentras en la etiqueta del dispositivo. Ej: 860000000000001',
      port: '5023',
      protocol: 'GT06',
      info: '📡 <b>Puerto:</b> 5023 | <b>Protocolo:</b> GT06<br>📲 <b>SMS configurar servidor:</b><br><code>SERVER,1,216.238.66.234,5023,0#</code><br>📲 <b>SMS configurar APN:</b><br><code>APN,internet.itelcel.com#</code>'
    },
    micodus_mv730: {
      label: 'ID del dispositivo (10 dígitos)',
      hint: '⚠️ MiCODUS usa ID, NO el IMEI. Envía SMS "CXZT" al GPS para obtener el ID. Ej: 7301134826',
      port: '8821 o 5023',
      protocol: 'GT06 (variante MiCODUS)',
      info: '📡 <b>Puerto:</b> 8821 (default) o 5023 | <b>Protocolo:</b> GT06<br>⚠️ <b>Usa ID, no IMEI.</b> Envía SMS <code>CXZT</code> para ver el ID.<br>📲 <b>SMS configurar servidor:</b><br><code>adminip123456,216.238.66.234:5023</code><br>📲 <b>SMS configurar APN:</b><br><code>apn123456,internet.itelcel.com</code><br>📲 <b>SMS reiniciar:</b> <code>reboot123456</code><br>📲 <b>SMS verificar estado:</b> <code>status123456</code><br><br>💡 Si GPRS:0, el chip no tiene datos. Verifica saldo/APN.'
    },
    micodus_mv720: {
      label: 'ID del dispositivo (10 dígitos)',
      hint: '⚠️ MiCODUS usa ID, NO el IMEI. Envía SMS "CXZT" al GPS para obtener el ID.',
      port: '8821 o 5023',
      protocol: 'GT06 (variante MiCODUS)',
      info: '📡 <b>Puerto:</b> 8821 (default) o 5023 | <b>Protocolo:</b> GT06<br>⚠️ <b>Usa ID, no IMEI.</b> Envía SMS <code>CXZT</code> para ver el ID.<br>📲 <b>SMS configurar servidor:</b><br><code>adminip123456,216.238.66.234:5023</code><br>📲 <b>SMS configurar APN:</b><br><code>apn123456,internet.itelcel.com</code><br>📲 <b>SMS reiniciar:</b> <code>reboot123456</code>'
    },
    concox_gt06n: {
      label: 'IMEI del dispositivo (15 dígitos)',
      hint: 'Ej: 860000000000001',
      port: '5023',
      protocol: 'GT06',
      info: '📡 <b>Puerto:</b> 5023 | <b>Protocolo:</b> GT06<br>📲 <b>SMS configurar servidor:</b><br><code>SERVER,1,216.238.66.234,5023,0#</code>'
    },
    coban_tk103: {
      label: 'IMEI del dispositivo (15 dígitos)',
      hint: 'Ej: 860000000000001',
      port: '5023',
      protocol: 'GT06',
      info: '📡 <b>Puerto:</b> 5023 | <b>Protocolo:</b> GT06<br>📲 <b>SMS configurar servidor:</b><br><code>adminip 216.238.66.234 5023</code>'
    },
    sinotrack_st901: {
      label: 'IMEI del dispositivo (15 dígitos)',
      hint: 'Ej: 860000000000001',
      port: '5023',
      protocol: 'GT06',
      info: '📡 <b>Puerto:</b> 5023 | <b>Protocolo:</b> GT06<br>📲 <b>SMS configurar servidor:</b><br><code>804#216.238.66.234#5023#</code>'
    },
    otro_gt06: {
      label: 'IMEI del dispositivo (15 dígitos)',
      hint: 'Dispositivo con protocolo GT06 (paquetes inician con 0x7878)',
      port: '5023',
      protocol: 'GT06',
      info: '📡 <b>Puerto:</b> 5023 | <b>Protocolo:</b> GT06<br>Configura tu GPS con IP <code>216.238.66.234</code> y puerto <code>5023</code>'
    },
    otro_eelink: {
      label: 'IMEI del dispositivo (15 dígitos)',
      hint: 'Dispositivo con protocolo EELINK (paquetes inician con 0x6767)',
      port: '5023',
      protocol: 'EELINK',
      info: '📡 <b>Puerto:</b> 5023 | <b>Protocolo:</b> EELINK<br>Configura tu GPS con IP <code>216.238.66.234</code> y puerto <code>5023</code>'
    },
  };

  const m = models[model] || models.otro_gt06;
  label.textContent = m.label;
  hint.textContent = m.hint;
  info.innerHTML = m.info;
}

async function saveDevice() {
  const data = {
    imei: document.getElementById('devImei').value.trim(),
    name: document.getElementById('devName').value.trim(),
    vehicle_plate: document.getElementById('devPlate').value.trim(),
    vehicle_type: document.getElementById('devType').value,
    user_id: parseInt(document.getElementById('devUserId').value),
    sim_number: document.getElementById('devSim').value.trim(),
  };

  if (!data.imei || !data.name || !data.user_id) {
    alert('IMEI/ID, nombre y usuario son requeridos');
    return;
  }

  try {
    await apiPost('/devices', data);
    closeModal('deviceModal');
    loadAdminDevices();
  } catch (err) {
    alert(err.message || 'Error al crear dispositivo');
  }
}

// ==================== ADMIN: USERS ====================
async function loadAdminUsers() {
  try {
    const users = await apiGet('/users');
    const container = document.getElementById('adminUsersView');
    
    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <h3>Usuarios / Clientes</h3>
        <button class="btn btn-success btn-small" onclick="showAddUserModal()">+ Nuevo Usuario</button>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Usuario</th>
            <th>Nombre</th>
            <th>Empresa</th>
            <th>Email</th>
            <th>Rol</th>
            <th>Fecha Registro</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          ${users.map(u => `
            <tr>
              <td>${u.id}</td>
              <td>${u.username}</td>
              <td>${u.name}</td>
              <td>${u.company || '-'}</td>
              <td>${u.email || '-'}</td>
              <td><span class="status-badge ${u.role === 'admin' ? 'status-online' : 'status-offline'}">${u.role}</span></td>
              <td>${new Date(u.created_at).toLocaleDateString()}</td>
              <td>
                ${u.role !== 'admin' ? `<button class="btn btn-danger btn-small" onclick="deleteUser(${u.id})">Eliminar</button>` : ''}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    console.error('Error loading users:', err);
  }
}

function showAddUserModal() {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay show';
  modal.id = 'userModal';
  modal.innerHTML = `
    <div class="modal">
      <h3>Nuevo Usuario</h3>
      <div class="form-group">
        <label>Nombre de usuario (login)</label>
        <input type="text" id="newUsername" placeholder="Ej: transportes_norte">
      </div>
      <div class="form-group">
        <label>Contraseña</label>
        <input type="password" id="newPassword" placeholder="Mínimo 6 caracteres">
      </div>
      <div class="form-group">
        <label>Nombre completo</label>
        <input type="text" id="newName" placeholder="Ej: Juan Pérez">
      </div>
      <div class="form-group">
        <label>Empresa</label>
        <input type="text" id="newCompany" placeholder="Ej: Transportes del Norte S.A.">
      </div>
      <div class="form-group">
        <label>Email</label>
        <input type="email" id="newEmail" placeholder="correo@empresa.com">
      </div>
      <div class="form-group">
        <label>Teléfono</label>
        <input type="text" id="newPhone" placeholder="+52 000 000 0000">
      </div>
      <div class="form-group">
        <label>Rol</label>
        <select id="newRole" style="width:100%;padding:12px;background:var(--bg-dark);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:14px;">
          <option value="client">Cliente</option>
          <option value="admin">Administrador</option>
        </select>
      </div>
      <div class="modal-actions">
        <button class="btn btn-cancel" onclick="closeModal('userModal')">Cancelar</button>
        <button class="btn btn-primary" onclick="saveUser()">Guardar</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

async function saveUser() {
  const data = {
    username: document.getElementById('newUsername').value.trim(),
    password: document.getElementById('newPassword').value,
    name: document.getElementById('newName').value.trim(),
    company: document.getElementById('newCompany').value.trim(),
    email: document.getElementById('newEmail').value.trim(),
    phone: document.getElementById('newPhone').value.trim(),
    role: document.getElementById('newRole').value,
  };

  if (!data.username || !data.password || !data.name) {
    alert('Usuario, contraseña y nombre son requeridos');
    return;
  }

  if (data.password.length < 6) {
    alert('La contraseña debe tener al menos 6 caracteres');
    return;
  }

  try {
    await apiPost('/users', data);
    closeModal('userModal');
    loadAdminUsers();
  } catch (err) {
    alert(err.message || 'Error al crear usuario');
  }
}

async function deleteUser(id) {
  if (!confirm('¿Estás seguro de eliminar este usuario?')) return;
  try {
    await apiDelete(`/users/${id}`);
    loadAdminUsers();
  } catch (err) {
    alert('Error al eliminar usuario');
  }
}

// ==================== UTILITIES ====================
function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.remove();
}

function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  window.location.href = '/login.html';
}

// ==================== API HELPERS ====================
async function apiGet(endpoint) {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (response.status === 401 || response.status === 403) {
    logout();
    return;
  }
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || 'Error de servidor');
  }
  return response.json();
}

async function apiPost(endpoint, data) {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });
  if (response.status === 401 || response.status === 403) {
    logout();
    return;
  }
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || 'Error de servidor');
  }
  return response.json();
}

async function apiPut(endpoint, data) {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data || {}),
  });
  if (response.status === 401 || response.status === 403) {
    logout();
    return;
  }
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || 'Error de servidor');
  }
  return response.json();
}

async function apiDelete(endpoint) {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (response.status === 401 || response.status === 403) {
    logout();
    return;
  }
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || 'Error de servidor');
  }
  return response.json();
}

// ==================== CHANGE PASSWORD ====================
function showChangePassword() {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay show';
  modal.id = 'passwordModal';
  modal.innerHTML = `
    <div class="modal">
      <h3>🔑 Cambiar Contraseña</h3>
      <div class="form-group">
        <label>Contraseña actual</label>
        <input type="password" id="currentPass" placeholder="Tu contraseña actual">
      </div>
      <div class="form-group">
        <label>Nueva contraseña</label>
        <input type="password" id="newPass" placeholder="Mínimo 6 caracteres">
      </div>
      <div class="form-group">
        <label>Confirmar nueva contraseña</label>
        <input type="password" id="confirmPass" placeholder="Repite la nueva contraseña">
      </div>
      <div id="passError" style="color:var(--danger);font-size:13px;margin-bottom:12px;display:none;"></div>
      <div class="modal-actions">
        <button class="btn btn-cancel" onclick="closeModal('passwordModal')">Cancelar</button>
        <button class="btn btn-primary" onclick="changePassword()">Guardar</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

async function changePassword() {
  const current = document.getElementById('currentPass').value;
  const newPass = document.getElementById('newPass').value;
  const confirm = document.getElementById('confirmPass').value;
  const errorDiv = document.getElementById('passError');

  errorDiv.style.display = 'none';

  if (!current || !newPass || !confirm) {
    errorDiv.textContent = 'Todos los campos son requeridos';
    errorDiv.style.display = 'block';
    return;
  }

  if (newPass.length < 6) {
    errorDiv.textContent = 'La nueva contraseña debe tener al menos 6 caracteres';
    errorDiv.style.display = 'block';
    return;
  }

  if (newPass !== confirm) {
    errorDiv.textContent = 'Las contraseñas no coinciden';
    errorDiv.style.display = 'block';
    return;
  }

  try {
    await apiPut('/auth/password', { currentPassword: current, newPassword: newPass });
    closeModal('passwordModal');
    alert('Contraseña cambiada exitosamente');
  } catch (err) {
    errorDiv.textContent = err.message || 'Error al cambiar contraseña';
    errorDiv.style.display = 'block';
  }
}

// ==================== EDIT DEVICE ====================
async function editDevice(id) {
  try {
    const device = await apiGet(`/devices/${id}`);
    const users = await apiGet('/users');

    const modal = document.createElement('div');
    modal.className = 'modal-overlay show';
    modal.id = 'editDeviceModal';
    modal.innerHTML = `
      <div class="modal">
        <h3>Editar Dispositivo</h3>
        <div class="form-group">
          <label>IMEI</label>
          <input type="text" value="${device.imei}" disabled style="opacity:0.6;">
        </div>
        <div class="form-group">
          <label>Nombre / Alias</label>
          <input type="text" id="editDevName" value="${device.name || ''}">
        </div>
        <div class="form-group">
          <label>Placa del vehículo</label>
          <input type="text" id="editDevPlate" value="${device.vehicle_plate || ''}">
        </div>
        <div class="form-group">
          <label>Tipo de vehículo</label>
          <select id="editDevType" style="width:100%;padding:12px;background:var(--bg-dark);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:14px;">
            <option value="trailer" ${device.vehicle_type === 'trailer' ? 'selected' : ''}>Trailer</option>
            <option value="camion" ${device.vehicle_type === 'camion' ? 'selected' : ''}>Camión</option>
            <option value="camioneta" ${device.vehicle_type === 'camioneta' ? 'selected' : ''}>Camioneta</option>
            <option value="auto" ${device.vehicle_type === 'auto' ? 'selected' : ''}>Auto</option>
            <option value="moto" ${device.vehicle_type === 'moto' ? 'selected' : ''}>Moto</option>
            <option value="otro" ${device.vehicle_type === 'otro' ? 'selected' : ''}>Otro</option>
          </select>
        </div>
        <div class="form-group">
          <label>Asignar a cliente</label>
          <select id="editDevUser" style="width:100%;padding:12px;background:var(--bg-dark);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:14px;">
            ${users.map(u => `<option value="${u.id}" ${u.id === device.user_id ? 'selected' : ''}>${u.name} (${u.username})${u.company ? ' - ' + u.company : ''}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Marca del vehículo</label>
          <input type="text" id="editDevBrand" value="${device.vehicle_brand || ''}">
        </div>
        <div class="form-group">
          <label>Modelo del vehículo</label>
          <input type="text" id="editDevModel" value="${device.vehicle_model || ''}">
        </div>
        <div class="form-group">
          <label>Número SIM</label>
          <input type="text" id="editDevSim" value="${device.sim_number || ''}">
        </div>
        <div class="form-group">
          <label>Operador SIM</label>
          <input type="text" id="editDevCarrier" value="${device.sim_carrier || ''}">
        </div>
        <div class="modal-actions">
          <button class="btn btn-cancel" onclick="closeModal('editDeviceModal')">Cancelar</button>
          <button class="btn btn-primary" onclick="saveEditDevice(${id})">Guardar</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  } catch (err) {
    alert('Error al cargar dispositivo: ' + (err.message || err));
  }
}

async function saveEditDevice(id) {
  const data = {
    name: document.getElementById('editDevName').value.trim(),
    vehicle_plate: document.getElementById('editDevPlate').value.trim(),
    vehicle_type: document.getElementById('editDevType').value,
    user_id: parseInt(document.getElementById('editDevUser').value),
    vehicle_brand: document.getElementById('editDevBrand').value.trim(),
    vehicle_model: document.getElementById('editDevModel').value.trim(),
    sim_number: document.getElementById('editDevSim').value.trim(),
    sim_carrier: document.getElementById('editDevCarrier').value.trim(),
  };

  if (!data.name) {
    alert('El nombre es requerido');
    return;
  }

  try {
    await apiPut(`/devices/${id}`, data);
    closeModal('editDeviceModal');
    loadAdminDevices();
    alert('Dispositivo actualizado correctamente');
  } catch (err) {
    alert(err.message || 'Error al actualizar');
  }
}
