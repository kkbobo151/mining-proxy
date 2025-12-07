#!/bin/bash

#############################################
# 矿池中转代理系统 - CentOS 安装脚本
# 支持 CentOS 7/8/Stream
#############################################

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 配置变量
INSTALL_DIR="/opt/mining-proxy"
SERVICE_NAME="mining-proxy"
NODE_VERSION="18"
LOG_DIR="/var/log/mining-proxy"
USER="mining-proxy"
GROUP="mining-proxy"

# 打印带颜色的消息
print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 检查是否为root用户
check_root() {
    if [ "$EUID" -ne 0 ]; then
        print_error "请使用root用户运行此脚本"
        exit 1
    fi
}

# 检查操作系统
check_os() {
    if [ -f /etc/centos-release ]; then
        OS="centos"
        VERSION=$(cat /etc/centos-release | grep -oE '[0-9]+' | head -1)
        print_info "检测到 CentOS ${VERSION}"
    elif [ -f /etc/redhat-release ]; then
        OS="rhel"
        VERSION=$(cat /etc/redhat-release | grep -oE '[0-9]+' | head -1)
        print_info "检测到 RHEL ${VERSION}"
    else
        print_error "此脚本仅支持 CentOS/RHEL 系统"
        exit 1
    fi
}

# 安装依赖
install_dependencies() {
    print_info "安装系统依赖..."
    
    # 更新系统
    yum update -y
    
    # 安装基础工具
    yum install -y curl wget git gcc gcc-c++ make
    
    print_success "系统依赖安装完成"
}

# 安装 Node.js
install_nodejs() {
    print_info "安装 Node.js ${NODE_VERSION}..."
    
    # 检查是否已安装
    if command -v node &> /dev/null; then
        CURRENT_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
        if [ "$CURRENT_VERSION" -ge "$NODE_VERSION" ]; then
            print_info "Node.js 已安装 ($(node -v))"
            return
        fi
    fi
    
    # 使用 NodeSource 仓库安装
    curl -fsSL https://rpm.nodesource.com/setup_${NODE_VERSION}.x | bash -
    yum install -y nodejs
    
    print_success "Node.js 安装完成 ($(node -v))"
}

# 创建系统用户
create_user() {
    print_info "创建系统用户 ${USER}..."
    
    if id "$USER" &>/dev/null; then
        print_info "用户 ${USER} 已存在"
    else
        groupadd -r ${GROUP} 2>/dev/null || true
        useradd -r -g ${GROUP} -d ${INSTALL_DIR} -s /sbin/nologin ${USER}
        print_success "用户 ${USER} 创建成功"
    fi
}

# 创建目录结构
create_directories() {
    print_info "创建目录结构..."
    
    mkdir -p ${INSTALL_DIR}
    mkdir -p ${LOG_DIR}
    mkdir -p ${INSTALL_DIR}/logs
    
    print_success "目录创建完成"
}

# 复制程序文件
copy_files() {
    print_info "复制程序文件..."
    
    # 获取脚本所在目录的父目录（项目根目录）
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
    
    # 复制文件
    cp -r ${PROJECT_DIR}/dist ${INSTALL_DIR}/
    cp ${PROJECT_DIR}/package.json ${INSTALL_DIR}/
    cp ${PROJECT_DIR}/package-lock.json ${INSTALL_DIR}/ 2>/dev/null || true
    
    # 复制配置文件（如果不存在）
    if [ ! -f ${INSTALL_DIR}/config.json ]; then
        cp ${PROJECT_DIR}/config.json ${INSTALL_DIR}/
        print_warning "请修改配置文件: ${INSTALL_DIR}/config.json"
    else
        print_info "配置文件已存在，保留现有配置"
    fi
    
    print_success "文件复制完成"
}

# 安装 npm 依赖
install_npm_deps() {
    print_info "安装 npm 依赖..."
    
    cd ${INSTALL_DIR}
    npm install --production
    
    print_success "npm 依赖安装完成"
}

# 设置权限
set_permissions() {
    print_info "设置文件权限..."
    
    chown -R ${USER}:${GROUP} ${INSTALL_DIR}
    chown -R ${USER}:${GROUP} ${LOG_DIR}
    chmod 750 ${INSTALL_DIR}
    chmod 640 ${INSTALL_DIR}/config.json
    
    print_success "权限设置完成"
}

# 创建 systemd 服务
create_systemd_service() {
    print_info "创建 systemd 服务..."
    
    cat > /etc/systemd/system/${SERVICE_NAME}.service << EOF
[Unit]
Description=Mining Pool Proxy System
Documentation=https://github.com/your-repo/mining-proxy
After=network.target

[Service]
Type=simple
User=${USER}
Group=${GROUP}
WorkingDirectory=${INSTALL_DIR}
ExecStart=/usr/bin/node ${INSTALL_DIR}/dist/index.js
Restart=always
RestartSec=10
StandardOutput=append:${LOG_DIR}/output.log
StandardError=append:${LOG_DIR}/error.log

# 安全设置
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=${INSTALL_DIR} ${LOG_DIR}
PrivateTmp=true

# 资源限制
LimitNOFILE=65535
LimitNPROC=4096

# 环境变量
Environment=NODE_ENV=production
Environment=NODE_OPTIONS=--max-old-space-size=512

[Install]
WantedBy=multi-user.target
EOF

    # 重载 systemd
    systemctl daemon-reload
    
    print_success "systemd 服务创建完成"
}

# 配置防火墙
configure_firewall() {
    print_info "配置防火墙..."
    
    # 检查 firewalld 是否运行
    if systemctl is-active --quiet firewalld; then
        # 获取配置的端口
        PROXY_PORT=$(grep -oP '"port"\s*:\s*\K\d+' ${INSTALL_DIR}/config.json | head -1)
        API_PORT=$(grep -oP '"apiPort"\s*:\s*\K\d+' ${INSTALL_DIR}/config.json | head -1)
        
        PROXY_PORT=${PROXY_PORT:-3333}
        API_PORT=${API_PORT:-8080}
        
        firewall-cmd --permanent --add-port=${PROXY_PORT}/tcp
        firewall-cmd --permanent --add-port=${API_PORT}/tcp
        firewall-cmd --reload
        
        print_success "防火墙规则已添加 (端口: ${PROXY_PORT}, ${API_PORT})"
    else
        print_warning "firewalld 未运行，跳过防火墙配置"
    fi
}

# 创建日志轮转配置
create_logrotate() {
    print_info "配置日志轮转..."
    
    cat > /etc/logrotate.d/${SERVICE_NAME} << EOF
${LOG_DIR}/*.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    create 0640 ${USER} ${GROUP}
    postrotate
        systemctl reload ${SERVICE_NAME} > /dev/null 2>&1 || true
    endscript
}
EOF

    print_success "日志轮转配置完成"
}

# 启动服务
start_service() {
    print_info "启动服务..."
    
    systemctl enable ${SERVICE_NAME}
    systemctl start ${SERVICE_NAME}
    
    sleep 2
    
    if systemctl is-active --quiet ${SERVICE_NAME}; then
        print_success "服务启动成功"
    else
        print_error "服务启动失败，请检查日志: journalctl -u ${SERVICE_NAME}"
        exit 1
    fi
}

# 打印安装完成信息
print_completion() {
    echo ""
    echo "============================================"
    print_success "矿池中转代理系统安装完成！"
    echo "============================================"
    echo ""
    echo "安装目录: ${INSTALL_DIR}"
    echo "配置文件: ${INSTALL_DIR}/config.json"
    echo "日志目录: ${LOG_DIR}"
    echo ""
    echo "常用命令:"
    echo "  启动服务: systemctl start ${SERVICE_NAME}"
    echo "  停止服务: systemctl stop ${SERVICE_NAME}"
    echo "  重启服务: systemctl restart ${SERVICE_NAME}"
    echo "  查看状态: systemctl status ${SERVICE_NAME}"
    echo "  查看日志: journalctl -u ${SERVICE_NAME} -f"
    echo ""
    print_warning "请确保修改配置文件中的矿池地址和钱包地址！"
    echo ""
}

# 主函数
main() {
    echo ""
    echo "============================================"
    echo "  矿池中转代理系统 - CentOS 安装脚本"
    echo "============================================"
    echo ""
    
    check_root
    check_os
    install_dependencies
    install_nodejs
    create_user
    create_directories
    copy_files
    install_npm_deps
    set_permissions
    create_systemd_service
    configure_firewall
    create_logrotate
    start_service
    print_completion
}

# 运行主函数
main "$@"

