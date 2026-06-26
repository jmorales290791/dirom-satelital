/**
 * DIROM SATELITAL - Módulo de Eventos y Bitácora
 */

let eventsTab = 'log'; // 'log' | 'trips'

function loadEventsView() {
  const container = document.getElementById('eventsView');
  const today = new Date().toISOString().split('T')[0];
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
      <div style="display:flex;gap:8px;">
        <button class="btn ${eventsTab === 'log' ? 'btn-primary' : 'btn-cancel'} btn-small" onclick="switchEventsTab('log')">📋 Bitácora</button>
        <button class="btn ${eventsTab === 'trips' ? 'btn-primary' : 'btn-cancel'} btn-small" onclick="switchEventsTab('trips')">🛣️ Viajes</button>
      </div>
      <button class="btn btn-success btn-small" onclick="exportEvents()">📥 Exportar CSV</button>
    </div>

    <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:end;margin-bottom:16px;padding:16px;background:var(--bg-card);border:1px solid var(--border);border-radius:12px;">
      <div class="form-group" style="margin:0;min-width:150px;">
        <label style="font-size:11px;">Unidad</label>
        <select id="evtDevice" style="width:100%;padding:8px;background:var(--bg-dark);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);font-size:12px;">
          <option value="">Todas</option>
          ${devices.map(d => `<option value="${d.imei}">${d.name} ${d.vehicle_plate ? '(' + d.vehicle_plate + ')' : ''}</option>`).join('')}
        </select>
      </div>
      <div class="form-group" style="margin:0;">
        <label style="font-size:11px;">Tipo</label>
        <select id="evtType" style="padding:8px;background:var(--bg-dark);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);font-size:12px;">
          <option value="">Todos</option>
          <option value="connect">Conexión</option>
          <option value="disconnect">Desconexión</option>
          <option value="sos">SOS</option>
          <option value="overspeed">Exceso velocidad</option>
          <option value="power_cut">Corte energía</option>
          <option value="enter_geofence">Entrada geocerca</option>
          <option value="exit_geofence">Salida geocerca</option>
          <option value="vibration">Vibración</option>
          <option value="shock">Impacto</option>
          <option value="low_battery">Batería baja</option>
          <option value="acc_on">Motor encendido</option>
          <option value="acc_off">Motor apagado</option>
        </select>
      </div>
      <div class="form-group" style="margin:0;">
        <label style="font-size:11px;">Desde</label>
        <input type="date" id="evtStart" value="${weekAgo}" style="padding:8px;background:var(--bg-dark);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);font-size:12px;">
      </div>
      <div class="form-group" style="margin:0;">
        <label style="font-size:11px;">Hasta</label>
        <input type="date" id="evtEnd" value="${today}" style="padding:8px;background:var(--bg-dark);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);font-size:12px;">
      </div>
      <button class="btn btn-primary btn-small" onclick="filterEvents()">🔍 Filtrar</button>
    </div>

    <div id="eventsContent"></div>
  `;

  filterEvents();
}

function switchEventsTab(tab) {
  eventsTab = tab;
  filterEvents();
  // Update button styles
  const buttons = document.querySelectorAll('#eventsView > div:first-child button');
  buttons[0].className = `btn ${tab === 'log' ? 'btn-primary' : 'btn-cancel'} btn-small`;
  buttons[1].className = `btn ${tab === 'trips' ? 'btn-primary' : 'btn-cancel'} btn-small`;
}

async function filterEvents() {
  if (eventsTab === 'log') {
    await loadEventLog();
  } else {
    await loadTrips();
  }
}

async function loadEventLog() {
  const container = document.getElementById('eventsContent');
  const imei = document.getElementById('evtDevice')?.value || '';
  const type = document.getElementById('evtType')?.value || '';
  const start = document.getElementById('evtStart')?.value || '';
  const end = document.getElementById('evtEnd')?.value || '';

  try {
    const params = new URLSearchParams();
    if (imei) params.set('imei', imei);
    if (type) params.set('type', type);
    if (start) params.set('start', start + 'T00:00:00');
    if (end) params.set('end', end + 'T23:59:59');
    params.set('limit', '200');

    const data = await apiGet(`/events/log?${params.toString()}`);

    if (data.events.length === 0) {
      container.innerHTML = '<p style="text-align:center;color:var(--text-secondary);padding:40px;">No hay eventos para los filtros seleccionados</p>';
      return;
    }

    const eventIcons = {
      connect: '🟢', disconnect: '🔴', sos: '🚨', overspeed: '🏎️',
      power_cut: '⚡', enter_geofence: '📍', exit_geofence: '📍',
      vibration: '📳', shock: '💥', low_battery: '🔋',
      acc_on: '🔑', acc_off: '🔑', freefall: '⬇️', disassemble: '⚠️',
    };

    container.innerHTML = `
      <p style="font-size:12px;color:var(--text-secondary);margin-bottom:8px;">Mostrando ${data.events.length} de ${data.total} eventos</p>
      <table class="data-table">
        <thead>
          <tr><th>Fecha/Hora</th><th>Unidad</th><th>Evento</th><th>Descripción</th><th>Velocidad</th><th>Ubicación</th></tr>
        </thead>
        <tbody>
          ${data.events.map(e => `
            <tr>
              <td style="white-space:nowrap;font-size:12px;">${new Date(e.created_at).toLocaleString('es-MX')}</td>
              <td>${e.device_name}${e.vehicle_plate ? '<br><small style="color:var(--text-secondary);">' + e.vehicle_plate + '</small>' : ''}</td>
              <td><span class="status-badge">${eventIcons[e.event_type] || '📌'} ${e.event_type}</span></td>
              <td style="font-size:12px;">${e.description || '-'}</td>
              <td>${e.speed ? e.speed + ' km/h' : '-'}</td>
              <td>${e.latitude ? `<a href="https://maps.google.com/?q=${e.latitude},${e.longitude}" target="_blank" style="color:var(--accent);font-size:12px;">Ver mapa</a>` : '-'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    container.innerHTML = '<p style="color:var(--danger);">Error al cargar eventos</p>';
  }
}

async function loadTrips() {
  const container = document.getElementById('eventsContent');
  const imei = document.getElementById('evtDevice')?.value || '';
  const start = document.getElementById('evtStart')?.value || '';
  const end = document.getElementById('evtEnd')?.value || '';

  try {
    const params = new URLSearchParams();
    if (imei) params.set('imei', imei);
    if (start) params.set('start', start + 'T00:00:00');
    if (end) params.set('end', end + 'T23:59:59');

    const trips = await apiGet(`/events/trips?${params.toString()}`);

    if (trips.length === 0) {
      container.innerHTML = '<p style="text-align:center;color:var(--text-secondary);padding:40px;">No hay viajes registrados para los filtros seleccionados</p>';
      return;
    }

    container.innerHTML = `
      <table class="data-table">
        <thead>
          <tr><th>Unidad</th><th>Inicio</th><th>Fin</th><th>Duración</th><th>Distancia</th><th>Vel. Máx</th><th>Vel. Prom</th><th>Puntos</th><th>Estado</th></tr>
        </thead>
        <tbody>
          ${trips.map(t => `
            <tr>
              <td>${t.device_name}${t.vehicle_plate ? '<br><small style="color:var(--text-secondary);">' + t.vehicle_plate + '</small>' : ''}</td>
              <td style="font-size:12px;">${t.start_time ? new Date(t.start_time).toLocaleString('es-MX') : '-'}</td>
              <td style="font-size:12px;">${t.end_time ? new Date(t.end_time).toLocaleString('es-MX') : '-'}</td>
              <td>${t.duration ? formatDuration(t.duration) : '-'}</td>
              <td>${t.distance ? t.distance.toFixed(2) + ' km' : '-'}</td>
              <td>${t.max_speed || 0} km/h</td>
              <td>${t.avg_speed || 0} km/h</td>
              <td>${t.positions_count || 0}</td>
              <td><span class="status-badge ${t.status === 'active' ? 'status-online' : 'status-offline'}">${t.status === 'active' ? '🟢 En curso' : '✓ Completado'}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    container.innerHTML = '<p style="color:var(--danger);">Error al cargar viajes</p>';
  }
}

function formatDuration(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hrs}h ${mins}m`;
}

async function exportEvents() {
  const imei = document.getElementById('evtDevice')?.value || '';
  const type = document.getElementById('evtType')?.value || '';
  const start = document.getElementById('evtStart')?.value || '';
  const end = document.getElementById('evtEnd')?.value || '';

  const params = new URLSearchParams();
  if (imei) params.set('imei', imei);
  if (type) params.set('type', type);
  if (start) params.set('start', start + 'T00:00:00');
  if (end) params.set('end', end + 'T23:59:59');

  try {
    const response = await fetch(`/api/events/export?${params.toString()}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!response.ok) throw new Error('Error al exportar');

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `eventos_${start || 'all'}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  } catch (err) {
    alert('Error al exportar: ' + err.message);
  }
}
