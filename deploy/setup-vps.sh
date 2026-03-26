#!/bin/bash
# ===========================================
# Pixel Support Office - VPS Setup Script
# Run as root on Ubuntu 22.04 LTS
# ===========================================

set -e

echo "=============================="
echo "  Pixel Support Office Setup"
echo "=============================="

# 1. Update system
echo "[1/7] Updating system..."
apt update && apt upgrade -y

# 2. Install Node.js 20 LTS
echo "[2/7] Installing Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs git

# 3. Install PM2 (process manager)
echo "[3/7] Installing PM2..."
npm install -g pm2

# 4. Install Nginx
echo "[4/7] Installing Nginx..."
apt install -y nginx
systemctl enable nginx

# 5. Clone project
echo "[5/7] Cloning project..."
cd /opt
if [ -d "pixel-support-office" ]; then
  cd pixel-support-office && git pull
else
  git clone https://github.com/kiingor/pixel-support-office.git
  cd pixel-support-office
fi

# 6. Install dependencies
echo "[6/7] Installing dependencies..."
npm install
npm install -w server
npm install -w client

# 7. Create .env file
echo "[7/7] Creating .env..."
if [ ! -f .env ]; then
cat > .env << 'ENVEOF'
# Fill in your credentials below
SUPABASE_URL=YOUR_SUPABASE_URL
SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
ANTHROPIC_API_KEY=YOUR_ANTHROPIC_API_KEY
DISCORD_BOT_TOKEN=YOUR_DISCORD_BOT_TOKEN
DISCORD_PUBLIC_KEY=YOUR_DISCORD_PUBLIC_KEY
PORT=3001
CLIENT_URL=http://147.93.67.238
ENVEOF
echo ".env created - EDIT IT with your real credentials: nano /opt/pixel-support-office/.env"
else
echo ".env already exists"
fi

# Clone project code for analysis
echo "Cloning SoftcomHub for code analysis..."
cd /opt/pixel-support-office
if [ ! -d "_project-code" ]; then
  git clone https://github.com/kiingor/SoftcomHub.git _project-code
fi

# Build client (static files served by nginx)
echo "Building client..."
npm run build -w client

# Configure Nginx
echo "Configuring Nginx..."
cat > /etc/nginx/sites-available/pixel-office << 'NGINXEOF'
server {
    listen 80;
    server_name _;

    # Frontend (static files)
    location / {
        root /opt/pixel-support-office/client/dist;
        try_files $uri $uri/ /index.html;
    }

    # Backend API proxy
    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }

    # WebSocket proxy
    location /socket.io/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
NGINXEOF

ln -sf /etc/nginx/sites-available/pixel-office /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx

# Start backend with PM2
echo "Starting backend with PM2..."
cd /opt/pixel-support-office
pm2 delete pixel-office 2>/dev/null || true
pm2 start "npx -w server tsx src/index.ts" --name pixel-office --cwd /opt/pixel-support-office
pm2 save
pm2 startup

echo ""
echo "=============================="
echo "  SETUP COMPLETE!"
echo "=============================="
echo ""
echo "  Frontend: http://147.93.67.238"
echo "  Backend:  http://147.93.67.238/api/health"
echo "  WebSocket: ws://147.93.67.238/socket.io/"
echo ""
echo "  PM2 status: pm2 status"
echo "  PM2 logs:   pm2 logs pixel-office"
echo "  Restart:    pm2 restart pixel-office"
echo "  Update:     cd /opt/pixel-support-office && git pull && npm install && npm run build -w client && pm2 restart pixel-office"
echo ""
