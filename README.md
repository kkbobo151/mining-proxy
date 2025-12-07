# 矿池中转代理系统

一个高性能的矿池中转代理系统，支持 Stratum V1 协议，可在 CentOS 上稳定运行。

## 功能特性

- ✅ **Stratum V1 协议支持** - 兼容主流矿机和矿池
- ✅ **多矿池负载均衡** - 按权重分配，自动故障转移
- ✅ **可选抽水功能** - 灵活配置抽水比例
- ✅ **实时统计 API** - RESTful 接口获取运行状态
- ✅ **日志记录** - 详细的运行日志，支持日志轮转
- ✅ **高并发支持** - 可处理大量矿机连接
- ✅ **优雅关闭** - 安全停止服务，不丢失数据
- ✅ **Systemd 集成** - 开机自启，自动重启

## 系统要求

- CentOS 7/8/Stream 或 RHEL 7/8
- Node.js 18.x 或更高版本
- 至少 512MB 内存
- 至少 1GB 磁盘空间

## 快速开始

### 1. 开发环境运行

```bash
# 克隆/进入项目目录
cd mining-proxy

# 安装依赖
npm install

# 修改配置文件
cp config.json config.local.json
vim config.json

# 编译 TypeScript
npm run build

# 启动开发模式
npm run dev

# 或启动生产模式
npm start
```

### 2. CentOS 生产环境部署

```bash
# 编译项目
npm run build

# 以 root 用户运行安装脚本
sudo bash scripts/install.sh
```

安装脚本会自动：
- 安装 Node.js
- 创建系统用户
- 复制程序文件
- 配置 systemd 服务
- 配置防火墙规则
- 设置日志轮转

## 配置说明

配置文件 `config.json`:

```json
{
  "proxy": {
    "host": "0.0.0.0",        // 监听地址
    "port": 3333,             // 监听端口
    "maxConnections": 10000   // 最大连接数
  },
  "pools": [
    {
      "name": "主矿池",
      "host": "stratum.pool.com",
      "port": 3333,
      "weight": 1,            // 权重（负载均衡用）
      "enabled": true
    }
  ],
  "wallet": {
    "address": "YOUR_WALLET_ADDRESS",
    "workerPrefix": "proxy"
  },
  "fees": {
    "enabled": false,         // 是否启用抽水
    "percent": 1.0,           // 抽水比例 (%)
    "wallet": "FEE_WALLET"    // 抽水钱包地址
  },
  "logging": {
    "level": "info",          // 日志级别: debug, info, warn, error
    "file": "logs/proxy.log",
    "maxSize": "10m",
    "maxFiles": 5
  },
  "stats": {
    "enabled": true,
    "interval": 60,           // 统计间隔（秒）
    "apiPort": 8080           // API 端口
  }
}
```

## 服务管理

### 使用控制脚本

```bash
# 安装后会创建控制脚本
/opt/mining-proxy/scripts/control.sh start    # 启动
/opt/mining-proxy/scripts/control.sh stop     # 停止
/opt/mining-proxy/scripts/control.sh restart  # 重启
/opt/mining-proxy/scripts/control.sh status   # 状态
/opt/mining-proxy/scripts/control.sh log      # 实时日志
/opt/mining-proxy/scripts/control.sh stats    # 统计信息
/opt/mining-proxy/scripts/control.sh miners   # 矿工列表
/opt/mining-proxy/scripts/control.sh config   # 编辑配置
```

### 使用 systemctl

```bash
systemctl start mining-proxy     # 启动
systemctl stop mining-proxy      # 停止
systemctl restart mining-proxy   # 重启
systemctl status mining-proxy    # 状态
systemctl enable mining-proxy    # 开机自启
systemctl disable mining-proxy   # 禁止自启
```

### 查看日志

```bash
# 使用 journalctl
journalctl -u mining-proxy -f

# 查看日志文件
tail -f /var/log/mining-proxy/output.log
tail -f /opt/mining-proxy/logs/proxy.log
```

## API 接口

启动后可通过 HTTP API 获取统计信息：

### 获取统计信息
```bash
curl http://localhost:8080/stats
```

响应示例：
```json
{
  "startTime": "2024-01-01T00:00:00.000Z",
  "uptime": 3600,
  "miners": {
    "total": 100,
    "active": 95,
    "list": [...]
  },
  "shares": {
    "total": 10000,
    "accepted": 9900,
    "rejected": 100,
    "rate": "99.00%"
  }
}
```

### 其他接口

| 接口 | 说明 |
|------|------|
| `GET /stats` | 完整统计信息 |
| `GET /miners` | 矿工列表 |
| `GET /pools` | 矿池状态 |
| `GET /health` | 健康检查 |
| `GET /history` | 历史统计 |
| `GET /config` | 配置信息 |

## 矿机配置

在矿机上配置代理地址：

```
矿池地址: stratum+tcp://你的服务器IP:3333
钱包地址: 你的钱包地址.矿机名
密码: x
```

## 目录结构

```
mining-proxy/
├── src/                    # 源代码
│   ├── index.ts           # 主入口
│   ├── proxy.ts           # 代理服务器
│   ├── connection.ts      # 连接管理
│   ├── stratum.ts         # Stratum 协议
│   ├── stats.ts           # 统计 API
│   ├── config.ts          # 配置管理
│   └── logger.ts          # 日志模块
├── scripts/               # 部署脚本
│   ├── install.sh         # 安装脚本
│   ├── uninstall.sh       # 卸载脚本
│   └── control.sh         # 控制脚本
├── config.json            # 配置文件
├── package.json           # npm 配置
├── tsconfig.json          # TypeScript 配置
└── README.md              # 文档
```

## 卸载

```bash
sudo bash /opt/mining-proxy/scripts/uninstall.sh
```

## 故障排查

### 服务无法启动

1. 检查配置文件格式：
```bash
cat /opt/mining-proxy/config.json | python3 -m json.tool
```

2. 检查端口占用：
```bash
netstat -tlnp | grep 3333
```

3. 检查日志：
```bash
journalctl -u mining-proxy -n 100
```

### 矿机无法连接

1. 检查防火墙：
```bash
firewall-cmd --list-all
```

2. 检查服务状态：
```bash
systemctl status mining-proxy
```

3. 测试端口连通性：
```bash
telnet 服务器IP 3333
```

### 连接矿池失败

1. 检查矿池地址是否正确
2. 检查网络连通性：
```bash
telnet 矿池地址 矿池端口
```

## 性能优化

### 系统优化

编辑 `/etc/sysctl.conf`：
```bash
# 增加文件描述符限制
fs.file-max = 1000000

# TCP 优化
net.core.somaxconn = 65535
net.ipv4.tcp_max_syn_backlog = 65535
net.ipv4.tcp_fin_timeout = 30
net.ipv4.tcp_keepalive_time = 1200
net.ipv4.tcp_max_tw_buckets = 5000
net.ipv4.tcp_tw_reuse = 1
```

应用配置：
```bash
sysctl -p
```

### 增加文件描述符限制

编辑 `/etc/security/limits.conf`：
```bash
mining-proxy soft nofile 65535
mining-proxy hard nofile 65535
```

## 许可证

MIT License

## 免责声明

本软件仅供学习和研究使用。使用者需自行承担使用风险，开发者不对任何直接或间接损失负责。

