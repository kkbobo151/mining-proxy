#!/bin/bash

#############################################
# 矿池中转代理系统 - 控制脚本
#############################################

SERVICE_NAME="mining-proxy"
INSTALL_DIR="/opt/mining-proxy"
LOG_DIR="/var/log/mining-proxy"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_status() {
    if systemctl is-active --quiet ${SERVICE_NAME}; then
        echo -e "${GREEN}●${NC} ${SERVICE_NAME} 正在运行"
    else
        echo -e "${RED}●${NC} ${SERVICE_NAME} 已停止"
    fi
}

case "$1" in
    start)
        echo "启动服务..."
        systemctl start ${SERVICE_NAME}
        print_status
        ;;
    stop)
        echo "停止服务..."
        systemctl stop ${SERVICE_NAME}
        print_status
        ;;
    restart)
        echo "重启服务..."
        systemctl restart ${SERVICE_NAME}
        print_status
        ;;
    status)
        systemctl status ${SERVICE_NAME} --no-pager
        ;;
    log)
        journalctl -u ${SERVICE_NAME} -f
        ;;
    stats)
        API_PORT=$(grep -oP '"apiPort"\s*:\s*\K\d+' ${INSTALL_DIR}/config.json 2>/dev/null || echo "8080")
        curl -s http://localhost:${API_PORT}/stats | python3 -m json.tool 2>/dev/null || \
        curl -s http://localhost:${API_PORT}/stats
        ;;
    miners)
        API_PORT=$(grep -oP '"apiPort"\s*:\s*\K\d+' ${INSTALL_DIR}/config.json 2>/dev/null || echo "8080")
        curl -s http://localhost:${API_PORT}/miners | python3 -m json.tool 2>/dev/null || \
        curl -s http://localhost:${API_PORT}/miners
        ;;
    health)
        API_PORT=$(grep -oP '"apiPort"\s*:\s*\K\d+' ${INSTALL_DIR}/config.json 2>/dev/null || echo "8080")
        curl -s http://localhost:${API_PORT}/health
        echo ""
        ;;
    config)
        ${EDITOR:-vi} ${INSTALL_DIR}/config.json
        ;;
    reload)
        echo "重载配置..."
        systemctl restart ${SERVICE_NAME}
        print_status
        ;;
    *)
        echo "矿池中转代理系统 - 控制脚本"
        echo ""
        echo "用法: $0 {start|stop|restart|status|log|stats|miners|health|config|reload}"
        echo ""
        echo "命令说明:"
        echo "  start   - 启动服务"
        echo "  stop    - 停止服务"
        echo "  restart - 重启服务"
        echo "  status  - 查看服务状态"
        echo "  log     - 查看实时日志"
        echo "  stats   - 查看统计信息"
        echo "  miners  - 查看矿工列表"
        echo "  health  - 健康检查"
        echo "  config  - 编辑配置文件"
        echo "  reload  - 重载配置（重启服务）"
        exit 1
        ;;
esac

