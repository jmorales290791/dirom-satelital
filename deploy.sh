#!/bin/bash
# ============================================
# DIROM SATELITAL - Script de Deploy
# Ejecutar en un VPS Ubuntu 22.04 limpio
# ============================================

echo "╔══════════════════════════════════════════╗"
echo "║   DIROM SATELITAL - Deploy Script        ║"
echo "╚══════════════════════════════════════════╝"

# 1. Actualizar sistema
echo "[1/7] Actualizando sistema..."
apt update && apt upgrade -y

# 2. Instalar Node.js 20 LTS
echo "[2/7] Instalando Node.js..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# 3. Instalar PM2 (process manager)
echo "[3/7] Instalando PM2..."
npm install -g pm2

# 4. Instalar Nginx (reverse proxy)
echo "[4/7] Instalando Nginx..."
apt install -y nginx

# 5. Configurar Firewall
echo "[5/7] Configurando Firewall..."
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS
ufw allow 3000/tcp  # App (temporal, luego se quita)
ufw allow 5023/tcp  # GPS TCP Server
ufw --force enable

# 6. Crear directorio del proyecto
echo "[6/7] Creando directorio..."
mkdir -p /opt/dirom-satelital
cd /opt/dirom-satelital

echo "[7/7] ¡Listo! Ahora sube tu código con:"
echo ""
echo "  Desde tu PC Windows (PowerShell):"
echo "  scp -r ./* root@TU_IP:/opt/dirom-satelital/"
echo ""
echo "  Luego en el servidor:"
echo "  cd /opt/dirom-satelital"
echo "  npm install"
echo "  cp .env.production .env"
echo "  pm2 start index.js --name dirom-satelital"
echo "  pm2 save"
echo "  pm2 startup"
echo ""
echo "¡Deploy completado!"
