# DIROM SATELITAL - Guía de Deploy a Producción

## 1. Contratar VPS

Recomendado: **Vultr** (datacenter en Ciudad de México)
- URL: https://www.vultr.com
- Plan: Cloud Compute - $5 USD/mes
- OS: Ubuntu 22.04
- Location: Mexico City

Te darán una IP pública (ej: 207.148.45.123)

---

## 2. Conectarse al servidor

Desde PowerShell en tu PC:
```
ssh root@TU_IP
```
(La contraseña te la dan por email o en el panel de Vultr)

---

## 3. Preparar el servidor

Copiar y pegar en el servidor:
```bash
apt update && apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs nginx
npm install -g pm2
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 5023/tcp && ufw --force enable
mkdir -p /opt/dirom-satelital
```

---

## 4. Subir el código

Desde tu PC (PowerShell), en la carpeta del proyecto:
```powershell
scp -r * root@TU_IP:/opt/dirom-satelital/
```

O si prefieres Git:
```bash
# En el servidor:
cd /opt/dirom-satelital
git clone TU_REPO .
```

---

## 5. Instalar dependencias

En el servidor:
```bash
cd /opt/dirom-satelital
npm install --production
```

---

## 6. Configurar variables de entorno

```bash
cp .env.production .env
nano .env
```
Cambiar:
- `JWT_SECRET` por algo aleatorio largo
- `WHATSAPP_TOKEN` y `WHATSAPP_PHONE_ID` si ya los tienes

---

## 7. Arrancar con PM2

```bash
pm2 start index.js --name dirom-satelital
pm2 save
pm2 startup
```

PM2 se encarga de:
- Reiniciar si se cae
- Arrancar automático al reiniciar servidor
- Logs: `pm2 logs dirom-satelital`

---

## 8. Configurar Nginx

```bash
cp nginx.conf /etc/nginx/sites-available/dirom-satelital
ln -s /etc/nginx/sites-available/dirom-satelital /etc/nginx/sites-enabled/
rm /etc/nginx/sites-enabled/default
nano /etc/nginx/sites-available/dirom-satelital
```
Cambiar `TU_DOMINIO.com` por tu dominio o IP.

```bash
nginx -t
systemctl reload nginx
```

---

## 9. SSL Gratis (opcional pero recomendado)

Si tienes dominio:
```bash
apt install certbot python3-certbot-nginx
certbot --nginx -d tu-dominio.com
```

---

## 10. Configurar GPS

En el dispositivo GPS, configurar:
- **IP/Host**: TU_IP o tu-dominio.com
- **Puerto**: 5023
- **Protocolo**: GT06 (iStartek) o EELINK (TK419)

---

## Comandos útiles

```bash
pm2 status                    # Ver estado
pm2 logs dirom-satelital      # Ver logs
pm2 restart dirom-satelital   # Reiniciar
pm2 stop dirom-satelital      # Detener
```

---

## Acceso

- Web: http://TU_IP (o https://tu-dominio.com)
- GPS: TU_IP:5023
- Login: admin / admin123 (¡CAMBIAR EN PRODUCCIÓN!)
