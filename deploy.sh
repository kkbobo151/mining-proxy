#!/bin/bash

#############################################
# 矿池中转代理系统 - 一键部署脚本
# 适用于 CentOS 7/8/Stream
# 
# 使用方法:
#   curl -sSL https://你的服务器/deploy.sh | bash
#   或
#   bash deploy.sh
#############################################

set -e

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

INSTALL_DIR="/opt/mining-proxy"
SERVICE_NAME="mining-proxy"
NODE_VERSION="18"

echo -e "${BLUE}"
echo "╔════════════════════════════════════════════════════════════╗"
echo "║                                                            ║"
echo "║       矿池中转代理系统 - 一键部署                          ║"
echo "║       支持: Stratum (ETH/BTC) + Aleo                       ║"
echo "║                                                            ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# 检查 root
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}错误: 请使用 root 用户运行此脚本${NC}"
    echo "使用: sudo bash deploy.sh"
    exit 1
fi

# 检查系统
if [ ! -f /etc/redhat-release ]; then
    echo -e "${RED}错误: 此脚本仅支持 CentOS/RHEL 系统${NC}"
    exit 1
fi

echo -e "${GREEN}[1/6]${NC} 安装系统依赖..."
yum install -y curl wget git gcc gcc-c++ make >/dev/null 2>&1

echo -e "${GREEN}[2/6]${NC} 安装 Node.js ${NODE_VERSION}..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://rpm.nodesource.com/setup_${NODE_VERSION}.x | bash - >/dev/null 2>&1
    yum install -y nodejs >/dev/null 2>&1
fi
echo "  Node.js 版本: $(node -v)"

echo -e "${GREEN}[3/6]${NC} 创建安装目录..."
mkdir -p ${INSTALL_DIR}
mkdir -p ${INSTALL_DIR}/logs
cd ${INSTALL_DIR}

echo -e "${GREEN}[4/6]${NC} 下载程序文件..."
# 如果是本地部署，复制文件
if [ -f "$(dirname $0)/package.json" ]; then
    cp -r "$(dirname $0)"/{dist,package.json,config.json} ${INSTALL_DIR}/ 2>/dev/null || true
fi

# 创建 package.json (如果不存在)
if [ ! -f package.json ]; then
cat > package.json << 'EOF'
{
  "name": "mining-pool-proxy",
  "version": "1.0.0",
  "main": "dist/index.js",
  "scripts": {
    "start": "node dist/index.js"
  },
  "dependencies": {
    "winston": "^3.11.0"
  }
}
EOF
fi

# 创建默认配置 (如果不存在)
if [ ! -f config.json ]; then
cat > config.json << 'EOF'
{
  "proxy": {
    "host": "0.0.0.0",
    "port": 3333,
    "maxConnections": 10000
  },
  "pools": [
    {
      "name": "Aleo-F2Pool",
      "host": "aleo.f2pool.com",
      "port": 4400,
      "weight": 1,
      "enabled": true,
      "protocol": "stratum",
      "coin": "aleo"
    }
  ],
  "wallet": {
    "address": "YOUR_WALLET_ADDRESS",
    "workerPrefix": "proxy"
  },
  "fees": {
    "enabled": false,
    "percent": 1.0,
    "wallet": "FEE_WALLET_ADDRESS"
  },
  "logging": {
    "level": "info",
    "file": "logs/proxy.log",
    "maxSize": "10m",
    "maxFiles": 5
  },
  "stats": {
    "enabled": true,
    "interval": 60,
    "apiPort": 8080
  }
}
EOF
echo -e "${YELLOW}  请稍后修改配置文件: ${INSTALL_DIR}/config.json${NC}"
fi

echo -e "${GREEN}[5/6]${NC} 安装依赖..."
npm install --production >/dev/null 2>&1

echo -e "${GREEN}[6/6]${NC} 配置系统服务..."
cat > /etc/systemd/system/${SERVICE_NAME}.service << EOF
[Unit]
Description=Mining Pool Proxy System
After=network.target

[Service]
Type=simple
WorkingDirectory=${INSTALL_DIR}
ExecStart=/usr/bin/node ${INSTALL_DIR}/dist/index.js
Restart=always
RestartSec=10
StandardOutput=append:${INSTALL_DIR}/logs/output.log
StandardError=append:${INSTALL_DIR}/logs/error.log
LimitNOFILE=65535
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable ${SERVICE_NAME} >/dev/null 2>&1

# 配置防火墙
if systemctl is-active --quiet firewalld; then
    firewall-cmd --permanent --add-port=3333/tcp >/dev/null 2>&1
    firewall-cmd --permanent --add-port=8080/tcp >/dev/null 2>&1
    firewall-cmd --reload >/dev/null 2>&1
    echo -e "${GREEN}  防火墙已配置${NC}"
fi

echo ""
echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✅ 部署完成！${NC}"
echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  安装目录: ${BLUE}${INSTALL_DIR}${NC}"
echo -e "  配置文件: ${BLUE}${INSTALL_DIR}/config.json${NC}"
echo ""
echo -e "  ${YELLOW}常用命令:${NC}"
echo -e "    启动服务: ${GREEN}systemctl start ${SERVICE_NAME}${NC}"
echo -e "    停止服务: ${GREEN}systemctl stop ${SERVICE_NAME}${NC}"
echo -e "    查看状态: ${GREEN}systemctl status ${SERVICE_NAME}${NC}"
echo -e "    查看日志: ${GREEN}journalctl -u ${SERVICE_NAME} -f${NC}"
echo ""
echo -e "  ${YELLOW}矿机配置:${NC}"
echo -e "    矿池地址: ${GREEN}stratum+tcp://服务器IP:3333${NC}"
echo -e "    监控面板: ${GREEN}http://服务器IP:8080/dashboard${NC}"
echo ""
echo -e "${YELLOW}  ⚠️  请先修改配置文件，然后启动服务！${NC}"
echo -e "    vim ${INSTALL_DIR}/config.json"
echo ""

