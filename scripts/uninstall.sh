#!/bin/bash

#############################################
# 矿池中转代理系统 - 卸载脚本
#############################################

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# 配置变量
INSTALL_DIR="/opt/mining-proxy"
SERVICE_NAME="mining-proxy"
LOG_DIR="/var/log/mining-proxy"
USER="mining-proxy"
GROUP="mining-proxy"

print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# 检查是否为root用户
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}[ERROR]${NC} 请使用root用户运行此脚本"
    exit 1
fi

echo ""
echo "============================================"
echo "  矿池中转代理系统 - 卸载脚本"
echo "============================================"
echo ""

# 确认卸载
read -p "确定要卸载矿池中转代理系统吗？(y/N): " confirm
if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
    echo "取消卸载"
    exit 0
fi

# 停止并禁用服务
print_info "停止服务..."
systemctl stop ${SERVICE_NAME} 2>/dev/null || true
systemctl disable ${SERVICE_NAME} 2>/dev/null || true

# 删除 systemd 服务文件
print_info "删除 systemd 服务..."
rm -f /etc/systemd/system/${SERVICE_NAME}.service
systemctl daemon-reload

# 询问是否保留配置和日志
read -p "是否保留配置文件和日志？(y/N): " keep_data
if [ "$keep_data" != "y" ] && [ "$keep_data" != "Y" ]; then
    print_info "删除程序目录..."
    rm -rf ${INSTALL_DIR}
    
    print_info "删除日志目录..."
    rm -rf ${LOG_DIR}
    
    # 删除日志轮转配置
    rm -f /etc/logrotate.d/${SERVICE_NAME}
else
    print_warning "保留配置和日志文件"
    print_info "删除程序文件（保留配置）..."
    rm -rf ${INSTALL_DIR}/dist
    rm -rf ${INSTALL_DIR}/node_modules
fi

# 询问是否删除用户
read -p "是否删除系统用户 ${USER}？(y/N): " del_user
if [ "$del_user" = "y" ] || [ "$del_user" = "Y" ]; then
    print_info "删除系统用户..."
    userdel ${USER} 2>/dev/null || true
    groupdel ${GROUP} 2>/dev/null || true
fi

echo ""
print_success "卸载完成！"
echo ""

