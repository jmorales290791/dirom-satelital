/**
 * DIROM SATELITAL - Módulo de Reportes y Configuración de Email
 */

// ==================== REPORTES ====================

function loadReportsView() {
  const container = document.getElementById('reportsView');
  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;">
      <h3>Reportes</h3>
      <button class="btn btn-primary btn-small" onclick="downloadFleetReport()">📊 Descargar Reporte de Flota</button>
    </div>

    <div class="stat-card" style="margin-bottom:24px;">
      <h4 style="margin-bottom:16px;">Reporte de Ruta Individual</h4>
      <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:end;">
        <div class="form-group" style="margin:0;flex:1;min-width:180px;">
          <label>Dispositivo</label>
          <select id="reportDevice" style="width:100%;padding:10px;background:var(--bg-dark);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:13px;">
            <option value="">Seleccionar unidad...</option>
            ${devices.map(d => `<option value="${d.imei}">${d.name} ${d.vehicle_plate ? '(' + d.vehicle_plate + ')' : ''}</option>`).join('')}
          </select>
        </div>
        <div class="form-group" style="margin:0;">
          <label>Desde</label>
          <input type="date" id="reportStart" style="padding:10px;background:var(--bg-dark);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:13px;">
        </div>
        <div class="form-group" style="margin:0;">
          <label>Hasta</label>
          <input type="date" id="reportEnd" style="padding:10px;background:var(--bg-dark);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:13px;">
        </div>
        <button class="btn btn-success btn-small" onclick="downloadRouteReport()">📥 Descargar PDF</button>
        <button class="btn btn-primary btn-small" onclick="previewRouteStats()">👁️ Ver Stats</button>
      </div>
    </div>

    <div id="reportStats" style="display:none;"></div>
  `;

  // Set default dates
  const today = new Date().toISOString().split('T')[0];
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  document.getElementById('reportStart').value = weekAgo;
  document.getElementById('reportEnd').value = today;
}

function downloadRouteReport() {
  const imei = document.getElementById('reportDevice').value;
  const start = document.getElementById('reportStart').value;
  const end = document.getElementById('reportEnd').value;

  if (!imei) { alert('Selecciona un dispositivo'); return; }
  if (!start || !end) { alert('Selecciona un rango de fechas'); return; }

  const url = `/api/reports/route/${imei}?start=${start}T00:00:00&end=${end}T23:59:59`;
  
  // Descargar PDF
  fetch(url, { headers: { 'Authorization': `Bearer ${token}` } })
    .then(response => {
      if (!response.ok) return response.json().then(d => { throw new Error(d.error); });
      return response.blob();
    })
    .then(blob => {
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `reporte_ruta_${imei}_${start}.pdf`;
      a.click();
      window.URL.revokeObjectURL(url);
    })
    .catch(err => alert(err.message || 'Error al descargar reporte'));
}

function downloadFleetReport() {
  fetch('/api/reports/fleet', { headers: { 'Authorization': `Bearer ${token}` } })
    .then(response => {
      if (!response.ok) return response.json().then(d => { throw new Error(d.error); });
      return response.blob();
    })
    .then(blob => {
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `reporte_flota_${new Date().toISOString().split('T')[0]}.pdf`;
      a.click();
      window.URL.revokeObjectURL(url);
    })
    .catch(err => alert(err.message || 'Error al descargar reporte'));
}

async function previewRouteStats() {
  const imei = document.getElementById('reportDevice').value;
  const start = document.getElementById('reportStart').value;
  const end = document.getElementById('reportEnd').value;

  if (!imei) { alert('Selecciona un dispositivo'); return; }
  if (!start || !end) { alert('Selecciona un rango de fechas'); return; }

  try {
    const stats = await apiGet(`/reports/stats/${imei}?start=${start}T00:00:00&end=${end}T23:59:59`);
    const container = document.getElementById('reportStats');
    container.style.display = 'block';
    container.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-icon">🛣️</div>
          <div class="stat-value">${stats.totalDistance} km</div>
          <div class="stat-label">Distancia Total</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon">🏎️</div>
          <div class="stat-value">${stats.maxSpeed} km/h</div>
          <div class="stat-label">Velocidad Máxima</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon">📊</div>
          <div class="stat-value">${stats.avgSpeed} km/h</div>
          <div class="stat-label">Velocidad Promedio</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon">⏱️</div>
          <div class="stat-value">${stats.totalTime} hrs</div>
          <div class="stat-label">Tiempo Total</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon">📍</div>
          <div class="stat-value">${stats.totalPositions}</div>
          <div class="stat-label">Posiciones</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon">🅿️</div>
          <div class="stat-value">${stats.stops.length}</div>
          <div class="stat-label">Paradas (>5 min)</div>
        </div>
      </div>
      ${stats.stops.length > 0 ? `
        <h4 style="margin: 16px 0 8px;">Paradas detectadas:</h4>
        <table class="data-table">
          <thead><tr><th>Inicio</th><th>Fin</th><th>Duración</th><th>Ubicación</th></tr></thead>
          <tbody>
            ${stats.stops.slice(0, 20).map(s => `
              <tr>
                <td>${new Date(s.start).toLocaleString()}</td>
                <td>${new Date(s.end).toLocaleString()}</td>
                <td>${s.duration} min</td>
                <td><a href="https://www.google.com/maps?q=${s.latitude},${s.longitude}" target="_blank" style="color:var(--accent);">Ver mapa</a></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      ` : ''}
    `;
  } catch (err) {
    alert(err.message || 'Error al cargar estadísticas');
  }
}

// ==================== CONFIGURACIÓN DE EMAIL ====================

async function loadEmailSettings() {
  const container = document.getElementById('adminEmailView');

  try {
    const settings = await apiGet('/notifications/settings');

    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;">
        <h3>Configuración de Notificaciones por Email</h3>
      </div>

      <div class="stat-card" style="margin-bottom:24px;">
        <h4 style="margin-bottom:16px;">Servidor SMTP</h4>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
          <div class="form-group">
            <label>Host SMTP</label>
            <input type="text" id="emailHost" value="${settings.smtp_host || ''}" placeholder="smtp.gmail.com">
          </div>
          <div class="form-group">
            <label>Puerto</label>
            <input type="number" id="emailPort" value="${settings.smtp_port || 587}" placeholder="587">
          </div>
          <div class="form-group">
            <label>Usuario SMTP</label>
            <input type="text" id="emailUser" value="${settings.smtp_user || ''}" placeholder="tu@email.com">
          </div>
          <div class="form-group">
            <label>Contraseña SMTP</label>
            <input type="password" id="emailPass" value="${settings.smtp_pass || ''}" placeholder="Contraseña o App Password">
          </div>
          <div class="form-group" style="grid-column:span 2;">
            <label>Email remitente (From)</label>
            <input type="text" id="emailFrom" value="${settings.from_email || ''}" placeholder="alertas@tuempresa.com">
          </div>
        </div>
        <button class="btn btn-primary btn-small" onclick="testSmtp()" style="margin-top:8px;">🔌 Probar Conexión</button>
        <span id="smtpTestResult" style="margin-left:12px;font-size:13px;"></span>
      </div>

      <div class="stat-card" style="margin-bottom:24px;">
        <h4 style="margin-bottom:16px;">Destinatarios</h4>
        <div class="form-group">
          <label>Emails para notificaciones (separados por coma)</label>
          <input type="text" id="emailRecipients" value="${settings.notification_emails || ''}" placeholder="jefe@empresa.com, operador@empresa.com" style="width:100%;">
        </div>
      </div>

      <div class="stat-card" style="margin-bottom:24px;">
        <h4 style="margin-bottom:16px;">Tipos de Notificación</h4>
        <div style="display:flex;flex-direction:column;gap:12px;">
          <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:14px;color:var(--text-secondary);">
            <input type="checkbox" id="notifyAlerts" ${settings.notify_alerts ? 'checked' : ''} style="accent-color:var(--accent);width:18px;height:18px;">
            🚨 Alertas (SOS, corte de energía, exceso de velocidad, etc.)
          </label>
          <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:14px;color:var(--text-secondary);">
            <input type="checkbox" id="notifyGeofence" ${settings.notify_geofence ? 'checked' : ''} style="accent-color:var(--accent);width:18px;height:18px;">
            📍 Geocercas (entrada y salida)
          </label>
          <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:14px;color:var(--text-secondary);">
            <input type="checkbox" id="notifyOffline" ${settings.notify_offline ? 'checked' : ''} style="accent-color:var(--accent);width:18px;height:18px;">
            ⚠️ Dispositivo desconectado
          </label>
        </div>
      </div>

      <button class="btn btn-success" onclick="saveEmailSettings()">💾 Guardar Configuración</button>
    `;
  } catch (err) {
    container.innerHTML = '<p style="color:var(--danger);">Error al cargar configuración</p>';
  }
}

async function testSmtp() {
  const result = document.getElementById('smtpTestResult');
  result.textContent = 'Probando...';
  result.style.color = 'var(--text-secondary)';

  try {
    const data = await apiPost('/notifications/test', {
      smtp_host: document.getElementById('emailHost').value,
      smtp_port: parseInt(document.getElementById('emailPort').value),
      smtp_user: document.getElementById('emailUser').value,
      smtp_pass: document.getElementById('emailPass').value,
    });

    if (data.success) {
      result.textContent = '✓ Conexión exitosa';
      result.style.color = 'var(--accent)';
    } else {
      result.textContent = '✗ ' + data.message;
      result.style.color = 'var(--danger)';
    }
  } catch (err) {
    result.textContent = '✗ Error: ' + (err.message || 'No se pudo conectar');
    result.style.color = 'var(--danger)';
  }
}

async function saveEmailSettings() {
  try {
    await apiPost('/notifications/settings', {
      smtp_host: document.getElementById('emailHost').value,
      smtp_port: parseInt(document.getElementById('emailPort').value) || 587,
      smtp_user: document.getElementById('emailUser').value,
      smtp_pass: document.getElementById('emailPass').value,
      from_email: document.getElementById('emailFrom').value,
      notification_emails: document.getElementById('emailRecipients').value,
      notify_alerts: document.getElementById('notifyAlerts').checked,
      notify_geofence: document.getElementById('notifyGeofence').checked,
      notify_offline: document.getElementById('notifyOffline').checked,
    });
    alert('Configuración guardada correctamente');
  } catch (err) {
    alert(err.message || 'Error al guardar');
  }
}

// ==================== WHATSAPP SETTINGS ====================

async function loadWhatsappSettings() {
  const container = document.getElementById('adminWhatsappView');

  try {
    const settings = await apiGet('/whatsapp/settings');
    const status = await apiGet('/whatsapp/status');

    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;">
        <h3>Configuración de WhatsApp</h3>
        <span class="status-badge ${status.enabled ? 'status-online' : 'status-offline'}">
          <span class="status-dot"></span> ${status.enabled ? 'API Conectada' : 'API No Configurada'}
        </span>
      </div>

      ${!status.enabled ? `
      <div class="stat-card" style="margin-bottom:24px;border-color:var(--warning);">
        <h4 style="color:var(--warning);margin-bottom:12px;">⚠️ Configuración del Servidor</h4>
        <p style="color:var(--text-secondary);font-size:13px;line-height:1.6;">
          Para activar WhatsApp necesitas configurar las credenciales en el archivo <code>.env</code> del servidor:
        </p>
        <div style="background:var(--bg-dark);border-radius:8px;padding:16px;margin-top:12px;font-family:monospace;font-size:12px;color:var(--accent);">
          WHATSAPP_TOKEN=EAAxxxxxxxx...<br>
          WHATSAPP_PHONE_ID=123456789...<br>
          WHATSAPP_VERIFY_TOKEN=dirom_satelital_webhook_2024
        </div>
        <p style="color:var(--text-secondary);font-size:12px;margin-top:12px;">
          Obtener credenciales en: <a href="https://developers.facebook.com/apps/" target="_blank" style="color:var(--accent);">developers.facebook.com</a>
        </p>
      </div>
      ` : ''}

      <div class="stat-card" style="margin-bottom:24px;">
        <h4 style="margin-bottom:16px;">📱 Números para Notificaciones</h4>
        <p style="color:var(--text-secondary);font-size:13px;margin-bottom:12px;">
          Estos números recibirán alertas automáticas y pueden consultar ubicación de unidades escribiendo al WhatsApp de DIROM.
        </p>
        <div class="form-group">
          <label>Números de WhatsApp (separados por coma, con código de país)</label>
          <input type="text" id="waNumbers" value="${settings.notify_numbers || ''}" placeholder="521234567890, 521234567891" style="width:100%;">
        </div>
        <p style="color:var(--text-secondary);font-size:11px;">Formato: código de país + número sin +, espacios ni guiones. Ej: 521234567890</p>
      </div>

      <div class="stat-card" style="margin-bottom:24px;">
        <h4 style="margin-bottom:16px;">🔔 Tipos de Notificación</h4>
        <div style="display:flex;flex-direction:column;gap:12px;">
          <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:14px;color:var(--text-secondary);">
            <input type="checkbox" id="waNotifyAlerts" ${settings.notify_alerts ? 'checked' : ''} style="accent-color:var(--accent);width:18px;height:18px;">
            🚨 Alertas (SOS, corte de energía, exceso de velocidad, vibración, etc.)
          </label>
          <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:14px;color:var(--text-secondary);">
            <input type="checkbox" id="waNotifyGeofence" ${settings.notify_geofence ? 'checked' : ''} style="accent-color:var(--accent);width:18px;height:18px;">
            📍 Geocercas (entrada y salida de zonas)
          </label>
          <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:14px;color:var(--text-secondary);">
            <input type="checkbox" id="waNotifyOffline" ${settings.notify_offline ? 'checked' : ''} style="accent-color:var(--accent);width:18px;height:18px;">
            ⚠️ Dispositivo desconectado
          </label>
        </div>
      </div>

      <div class="stat-card" style="margin-bottom:24px;">
        <h4 style="margin-bottom:16px;">💬 Comandos Disponibles para Clientes</h4>
        <p style="color:var(--text-secondary);font-size:13px;margin-bottom:12px;">
          Los números registrados pueden escribir estos comandos al WhatsApp de DIROM:
        </p>
        <table class="data-table">
          <thead><tr><th>Comando</th><th>Descripción</th></tr></thead>
          <tbody>
            <tr><td><code>ayuda</code></td><td>Ver menú de comandos</td></tr>
            <tr><td><code>ubicacion</code></td><td>Ver ubicación de todas las unidades</td></tr>
            <tr><td><code>estatus</code></td><td>Resumen de la flota (online/offline)</td></tr>
            <tr><td><code>buscar [nombre]</code></td><td>Buscar unidad por nombre, placa o IMEI</td></tr>
            <tr><td><code>alertas</code></td><td>Ver últimas 10 alertas</td></tr>
          </tbody>
        </table>
      </div>

      <div style="display:flex;gap:12px;">
        <button class="btn btn-success" onclick="saveWhatsappSettings()">💾 Guardar Configuración</button>
        ${status.enabled ? '<button class="btn btn-primary" onclick="testWhatsapp()">📤 Enviar Prueba</button>' : ''}
      </div>
      <span id="waTestResult" style="margin-left:12px;font-size:13px;"></span>
    `;
  } catch (err) {
    container.innerHTML = '<p style="color:var(--danger);">Error al cargar configuración de WhatsApp</p>';
  }
}

async function saveWhatsappSettings() {
  try {
    await apiPost('/whatsapp/settings', {
      notify_numbers: document.getElementById('waNumbers').value.trim(),
      notify_alerts: document.getElementById('waNotifyAlerts').checked,
      notify_geofence: document.getElementById('waNotifyGeofence').checked,
      notify_offline: document.getElementById('waNotifyOffline').checked,
    });
    alert('Configuración de WhatsApp guardada correctamente');
  } catch (err) {
    alert(err.message || 'Error al guardar');
  }
}

async function testWhatsapp() {
  const numbers = document.getElementById('waNumbers').value.trim();
  const firstNumber = numbers.split(',')[0].trim();

  if (!firstNumber) {
    alert('Ingresa al menos un número para enviar la prueba');
    return;
  }

  const result = document.getElementById('waTestResult');
  result.textContent = 'Enviando...';
  result.style.color = 'var(--text-secondary)';

  try {
    const data = await apiPost('/whatsapp/test', { phone: firstNumber });
    if (data.success) {
      result.textContent = '✓ Mensaje enviado correctamente';
      result.style.color = 'var(--accent)';
    } else {
      result.textContent = '✗ ' + (data.message || 'Error al enviar');
      result.style.color = 'var(--danger)';
    }
  } catch (err) {
    result.textContent = '✗ ' + (err.message || 'Error');
    result.style.color = 'var(--danger)';
  }
}
