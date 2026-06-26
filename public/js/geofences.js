/**
 * DIROM SATELITAL - Módulo de Geocercas
 * Dibujar círculos y polígonos en el mapa
 */

let geofences = [];
let geofenceLayers = {};
let drawingMode = null; // 'circle' | 'polygon' | null
let tempCircle = null;
let tempPolygonPoints = [];
let tempPolygonMarkers = [];
let tempPolygonLine = null;

// ==================== CARGAR GEOCERCAS ====================

async function loadGeofences() {
  try {
    geofences = await apiGet('/geofences');
    renderGeofencesOnMap();
    renderGeofenceList();
  } catch (err) {
    console.error('Error loading geofences:', err);
  }
}

function renderGeofencesOnMap() {
  // Limpiar geocercas anteriores
  Object.values(geofenceLayers).forEach(layer => {
    if (map.hasLayer(layer)) map.removeLayer(layer);
  });
  geofenceLayers = {};

  geofences.forEach(gf => {
    let layer;
    if (gf.type === 'circle' && gf.center_lat && gf.center_lng && gf.radius) {
      layer = L.circle([gf.center_lat, gf.center_lng], {
        radius: gf.radius,
        color: '#3949ab',
        fillColor: '#3949ab',
        fillOpacity: 0.1,
        weight: 2,
        dashArray: '5, 5',
      });
    } else if (gf.type === 'polygon' && gf.polygon_points) {
      const points = typeof gf.polygon_points === 'string' ? JSON.parse(gf.polygon_points) : gf.polygon_points;
      layer = L.polygon(points, {
        color: '#ff8f00',
        fillColor: '#ff8f00',
        fillOpacity: 0.1,
        weight: 2,
        dashArray: '5, 5',
      });
    }

    if (layer) {
      layer.bindPopup(`
        <div class="popup-content">
          <h4>📍 ${gf.name}</h4>
          <p>Tipo: <span class="value">${gf.type === 'circle' ? 'Circular' : 'Polígono'}</span></p>
          ${gf.type === 'circle' ? `<p>Radio: <span class="value">${gf.radius}m</span></p>` : ''}
          <p>Dispositivos: <span class="value">${gf.devices ? gf.devices.length : 0}</span></p>
          <p style="margin-top:8px;">
            <button class="btn btn-danger btn-small" onclick="deleteGeofence(${gf.id})">Eliminar</button>
          </p>
        </div>
      `);
      layer.addTo(map);
      geofenceLayers[gf.id] = layer;
    }
  });
}

function renderGeofenceList() {
  const container = document.getElementById('geofenceList');
  if (!container) return;

  if (geofences.length === 0) {
    container.innerHTML = '<p style="padding:16px;color:var(--text-secondary);font-size:13px;">No hay geocercas creadas</p>';
    return;
  }

  container.innerHTML = geofences.map(gf => `
    <div class="device-item" onclick="focusGeofence(${gf.id})">
      <div class="device-icon">${gf.type === 'circle' ? '⭕' : '🔷'}</div>
      <div class="device-info">
        <div class="name">${gf.name}</div>
        <div class="plate">${gf.type === 'circle' ? `Radio: ${gf.radius}m` : 'Polígono'}</div>
        <div class="speed">${gf.devices ? gf.devices.length : 0} dispositivos</div>
      </div>
      <button class="btn btn-danger btn-small" onclick="event.stopPropagation();deleteGeofence(${gf.id})" style="padding:4px 8px;font-size:11px;">✕</button>
    </div>
  `).join('');
}

function focusGeofence(id) {
  const layer = geofenceLayers[id];
  if (layer) {
    map.fitBounds(layer.getBounds(), { padding: [50, 50] });
    layer.openPopup();
  }
}

async function deleteGeofence(id) {
  if (!confirm('¿Eliminar esta geocerca?')) return;
  try {
    await apiDelete(`/geofences/${id}`);
    loadGeofences();
  } catch (err) {
    alert('Error al eliminar geocerca');
  }
}

// ==================== DIBUJAR GEOCERCAS ====================

function startDrawCircle() {
  cancelDrawing();
  drawingMode = 'circle';
  map.getContainer().style.cursor = 'crosshair';
  showDrawingToast('Haz clic en el mapa para colocar el centro del círculo');
  
  map.once('click', (e) => {
    const center = e.latlng;
    // Crear círculo con radio inicial de 500m
    tempCircle = L.circle([center.lat, center.lng], {
      radius: 500,
      color: '#00c853',
      fillColor: '#00c853',
      fillOpacity: 0.15,
      weight: 3,
    }).addTo(map);

    showDrawingToast('Arrastra para ajustar el radio, o ingresa el radio manualmente');
    showCircleRadiusModal(center);
  });
}

function showCircleRadiusModal(center) {
  drawingMode = null;
  map.getContainer().style.cursor = '';

  const modal = document.createElement('div');
  modal.className = 'modal-overlay show';
  modal.id = 'geofenceModal';
  modal.innerHTML = `
    <div class="modal">
      <h3>Nueva Geocerca Circular</h3>
      <div class="form-group">
        <label>Nombre de la geocerca</label>
        <input type="text" id="gfName" placeholder="Ej: Zona de carga Monterrey">
      </div>
      <div class="form-group">
        <label>Radio (metros)</label>
        <input type="number" id="gfRadius" value="500" min="50" max="50000" oninput="updateTempCircleRadius(this.value)">
      </div>
      <div class="form-group">
        <label>Centro: ${center.lat.toFixed(6)}, ${center.lng.toFixed(6)}</label>
      </div>
      <div class="form-group">
        <label>Asignar a dispositivos</label>
        <div id="gfDeviceCheckboxes" style="max-height:150px;overflow-y:auto;background:var(--bg-dark);border-radius:8px;padding:8px;">
          ${devices.map(d => `
            <label style="display:flex;align-items:center;gap:8px;padding:4px 8px;font-size:13px;color:var(--text-secondary);cursor:pointer;">
              <input type="checkbox" value="${d.id}" style="accent-color:var(--accent);"> ${d.name} (${d.vehicle_plate || d.imei})
            </label>
          `).join('')}
          ${devices.length === 0 ? '<p style="color:var(--text-secondary);font-size:12px;padding:8px;">No hay dispositivos</p>' : ''}
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-cancel" onclick="cancelGeofenceCreate()">Cancelar</button>
        <button class="btn btn-primary" onclick="saveCircleGeofence(${center.lat}, ${center.lng})">Guardar</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

function updateTempCircleRadius(radius) {
  if (tempCircle) {
    tempCircle.setRadius(parseInt(radius) || 500);
  }
}

async function saveCircleGeofence(lat, lng) {
  const name = document.getElementById('gfName').value.trim();
  const radius = parseInt(document.getElementById('gfRadius').value) || 500;
  
  if (!name) { alert('Ingresa un nombre para la geocerca'); return; }

  const checkboxes = document.querySelectorAll('#gfDeviceCheckboxes input[type="checkbox"]:checked');
  const device_ids = Array.from(checkboxes).map(cb => parseInt(cb.value));

  try {
    await apiPost('/geofences', {
      name,
      type: 'circle',
      center_lat: lat,
      center_lng: lng,
      radius,
      device_ids,
    });
    
    cancelGeofenceCreate();
    loadGeofences();
  } catch (err) {
    alert(err.message || 'Error al crear geocerca');
  }
}

// ==================== DIBUJAR POLÍGONO ====================

function startDrawPolygon() {
  cancelDrawing();
  drawingMode = 'polygon';
  tempPolygonPoints = [];
  tempPolygonMarkers = [];
  map.getContainer().style.cursor = 'crosshair';
  showDrawingToast('Haz clic en el mapa para agregar puntos del polígono. Doble clic para finalizar.');

  map.on('click', onPolygonClick);
  map.on('dblclick', onPolygonFinish);
}

function onPolygonClick(e) {
  if (drawingMode !== 'polygon') return;

  tempPolygonPoints.push([e.latlng.lat, e.latlng.lng]);
  
  // Agregar marcador visual
  const marker = L.circleMarker([e.latlng.lat, e.latlng.lng], {
    radius: 6,
    fillColor: '#ff8f00',
    fillOpacity: 1,
    color: 'white',
    weight: 2,
  }).addTo(map);
  tempPolygonMarkers.push(marker);

  // Actualizar línea temporal
  if (tempPolygonLine) map.removeLayer(tempPolygonLine);
  if (tempPolygonPoints.length > 1) {
    tempPolygonLine = L.polyline(tempPolygonPoints, {
      color: '#ff8f00',
      weight: 3,
      dashArray: '5, 5',
    }).addTo(map);
  }

  showDrawingToast(`${tempPolygonPoints.length} puntos. Doble clic para finalizar.`);
}

function onPolygonFinish(e) {
  if (drawingMode !== 'polygon') return;
  if (tempPolygonPoints.length < 3) {
    alert('Se necesitan al menos 3 puntos para crear un polígono');
    return;
  }

  map.off('click', onPolygonClick);
  map.off('dblclick', onPolygonFinish);
  drawingMode = null;
  map.getContainer().style.cursor = '';

  // Dibujar polígono temporal
  if (tempPolygonLine) map.removeLayer(tempPolygonLine);
  tempPolygonLine = L.polygon(tempPolygonPoints, {
    color: '#ff8f00',
    fillColor: '#ff8f00',
    fillOpacity: 0.15,
    weight: 3,
  }).addTo(map);

  hideDrawingToast();
  showPolygonModal();
}

function showPolygonModal() {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay show';
  modal.id = 'geofenceModal';
  modal.innerHTML = `
    <div class="modal">
      <h3>Nueva Geocerca Poligonal</h3>
      <div class="form-group">
        <label>Nombre de la geocerca</label>
        <input type="text" id="gfPolyName" placeholder="Ej: Ruta autorizada Norte">
      </div>
      <div class="form-group">
        <label>Puntos: ${tempPolygonPoints.length} vértices</label>
      </div>
      <div class="form-group">
        <label>Asignar a dispositivos</label>
        <div id="gfPolyDeviceCheckboxes" style="max-height:150px;overflow-y:auto;background:var(--bg-dark);border-radius:8px;padding:8px;">
          ${devices.map(d => `
            <label style="display:flex;align-items:center;gap:8px;padding:4px 8px;font-size:13px;color:var(--text-secondary);cursor:pointer;">
              <input type="checkbox" value="${d.id}" style="accent-color:var(--accent);"> ${d.name} (${d.vehicle_plate || d.imei})
            </label>
          `).join('')}
          ${devices.length === 0 ? '<p style="color:var(--text-secondary);font-size:12px;padding:8px;">No hay dispositivos</p>' : ''}
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-cancel" onclick="cancelGeofenceCreate()">Cancelar</button>
        <button class="btn btn-primary" onclick="savePolygonGeofence()">Guardar</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

async function savePolygonGeofence() {
  const name = document.getElementById('gfPolyName').value.trim();
  if (!name) { alert('Ingresa un nombre para la geocerca'); return; }

  const checkboxes = document.querySelectorAll('#gfPolyDeviceCheckboxes input[type="checkbox"]:checked');
  const device_ids = Array.from(checkboxes).map(cb => parseInt(cb.value));

  try {
    await apiPost('/geofences', {
      name,
      type: 'polygon',
      polygon_points: tempPolygonPoints,
      device_ids,
    });

    cancelGeofenceCreate();
    loadGeofences();
  } catch (err) {
    alert(err.message || 'Error al crear geocerca');
  }
}

// ==================== UTILIDADES ====================

function cancelDrawing() {
  drawingMode = null;
  map.getContainer().style.cursor = '';
  map.off('click', onPolygonClick);
  map.off('dblclick', onPolygonFinish);
  hideDrawingToast();
}

function cancelGeofenceCreate() {
  // Limpiar temporales
  if (tempCircle) { map.removeLayer(tempCircle); tempCircle = null; }
  if (tempPolygonLine) { map.removeLayer(tempPolygonLine); tempPolygonLine = null; }
  tempPolygonMarkers.forEach(m => map.removeLayer(m));
  tempPolygonMarkers = [];
  tempPolygonPoints = [];
  
  cancelDrawing();
  closeModal('geofenceModal');
}

function showDrawingToast(message) {
  let toast = document.getElementById('drawingToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'drawingToast';
    toast.style.cssText = `
      position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%);
      background: var(--bg-card); border: 1px solid var(--accent);
      color: var(--text-primary); padding: 12px 24px; border-radius: 8px;
      font-size: 13px; z-index: 9999; box-shadow: var(--shadow);
    `;
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.style.display = 'block';
}

function hideDrawingToast() {
  const toast = document.getElementById('drawingToast');
  if (toast) toast.style.display = 'none';
}
