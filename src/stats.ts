/**
 * 统计信息和HTTP API模块
 * 提供实时统计数据和REST API接口
 */

import * as http from 'http';
import { EventEmitter } from 'events';
import { configManager } from './config';
import logger from './logger';
import { MinerConnection } from './proxy';
import { poolChecker } from './poolChecker';

export interface Stats {
  startTime: Date;
  uptime: number;
  miners: {
    total: number;
    active: number;
    list: MinerStats[];
  };
  shares: {
    total: number;
    accepted: number;
    rejected: number;
    rate: string;
  };
  pools: PoolStats[];
  system: {
    memory: NodeJS.MemoryUsage;
    cpu: NodeJS.CpuUsage;
    platform: string;
    nodeVersion: string;
  };
}

export interface MinerStats {
  id: string;
  address: string;
  worker: string;
  connectedAt: string;
  lastActivity: string;
  sharesSubmitted: number;
  sharesAccepted: number;
  sharesRejected: number;
  difficulty: number;
  pool: string;
}

export interface PoolStats {
  name: string;
  host: string;
  port: number;
  connected: boolean;
  latency: number;
  enabled?: boolean;
  lastCheck?: string | null;
  error?: string | null;
  protocol?: string;
  coin?: string;
}

export class StatsServer extends EventEmitter {
  private server: http.Server | null = null;
  private config = configManager.get();
  private startTime: Date = new Date();
  private getMinersFn: (() => MinerConnection[]) | null = null;
  private statsHistory: Stats[] = [];
  private maxHistoryLength: number = 60; // 保留60条历史记录

  constructor() {
    super();
  }

  /**
   * 设置获取矿工列表的函数
   */
  public setGetMinersFunction(fn: () => MinerConnection[]): void {
    this.getMinersFn = fn;
  }

  /**
   * 启动统计服务器
   */
  public start(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.config.stats.enabled) {
        logger.info('统计API未启用');
        resolve();
        return;
      }

      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.listen(this.config.stats.apiPort, () => {
        logger.info(`统计API服务器已启动 - 端口 ${this.config.stats.apiPort}`);
        resolve();
      });

      this.server.on('error', (err) => {
        logger.error('统计API服务器错误:', err);
        reject(err);
      });

      // 定时收集统计信息
      setInterval(() => this.collectStats(), this.config.stats.interval * 1000);
    });
  }

  /**
   * 停止统计服务器
   */
  public stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          logger.info('统计API服务器已停止');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * 处理HTTP请求
   */
  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    // CORS头
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://localhost`);
    const path = url.pathname;

    try {
      switch (path) {
        case '/':
        case '/stats':
          this.handleStats(res);
          break;

        case '/miners':
          this.handleMiners(res);
          break;

        case '/pools':
          this.handlePools(res);
          break;

        case '/history':
          this.handleHistory(res);
          break;

        case '/health':
          this.handleHealth(res);
          break;

        case '/config':
          this.handleConfig(res);
          break;

        case '/dashboard':
        case '/monitor':
          this.handleDashboard(res);
          break;

        default:
          res.writeHead(404);
          res.end(JSON.stringify({ error: '未找到' }));
      }
    } catch (err) {
      logger.error('API请求处理错误:', err);
      res.writeHead(500);
      res.end(JSON.stringify({ error: '服务器内部错误' }));
    }
  }

  /**
   * 获取统计信息
   */
  private handleStats(res: http.ServerResponse): void {
    const stats = this.getStats();
    res.writeHead(200);
    res.end(JSON.stringify(stats, null, 2));
  }

  /**
   * 获取矿工列表
   */
  private handleMiners(res: http.ServerResponse): void {
    const miners = this.getMinersFn ? this.getMinersFn() : [];
    const minersList = miners.map(m => ({
      id: m.id,
      address: m.minerInfo?.address || 'unknown',
      worker: m.minerInfo?.worker || 'unknown',
      connectedAt: m.connectedAt.toISOString(),
      lastActivity: m.lastActivity.toISOString(),
      sharesSubmitted: m.sharesSubmitted,
      sharesAccepted: m.sharesAccepted,
      sharesRejected: m.sharesRejected,
      difficulty: m.difficulty,
      pool: m.pool?.name || 'unknown',
      isAuthorized: m.isAuthorized,
      isSubscribed: m.isSubscribed
    }));

    res.writeHead(200);
    res.end(JSON.stringify({
      total: miners.length,
      miners: minersList
    }, null, 2));
  }

  /**
   * 获取矿池状态
   */
  private handlePools(res: http.ServerResponse): void {
    const pools = this.config.pools.map(p => ({
      name: p.name,
      host: p.host,
      port: p.port,
      weight: p.weight,
      enabled: p.enabled
    }));

    res.writeHead(200);
    res.end(JSON.stringify({
      total: pools.length,
      pools
    }, null, 2));
  }

  /**
   * 获取历史统计
   */
  private handleHistory(res: http.ServerResponse): void {
    res.writeHead(200);
    res.end(JSON.stringify({
      interval: this.config.stats.interval,
      history: this.statsHistory
    }, null, 2));
  }

  /**
   * 健康检查
   */
  private handleHealth(res: http.ServerResponse): void {
    res.writeHead(200);
    res.end(JSON.stringify({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    }));
  }

  /**
   * 获取配置信息（不包含敏感信息）
   */
  private handleConfig(res: http.ServerResponse): void {
    res.writeHead(200);
    res.end(JSON.stringify({
      proxy: {
        host: this.config.proxy.host,
        port: this.config.proxy.port,
        maxConnections: this.config.proxy.maxConnections
      },
      pools: this.config.pools.map(p => ({
        name: p.name,
        host: p.host,
        port: p.port,
        enabled: p.enabled
      })),
      fees: {
        enabled: this.config.fees.enabled,
        percent: this.config.fees.percent
      },
      stats: {
        enabled: this.config.stats.enabled,
        interval: this.config.stats.interval
      }
    }, null, 2));
  }

  /**
   * Web 监控面板
   */
  private handleDashboard(res: http.ServerResponse): void {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.writeHead(200);
    res.end(this.getDashboardHtml());
  }

  /**
   * 生成监控面板 HTML
   */
  private getDashboardHtml(): string {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>矿池中转代理 - 实时监控</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'SF Mono', 'Menlo', 'Monaco', 'Courier New', monospace;
      background: linear-gradient(135deg, #0c0c0c 0%, #1a1a2e 50%, #16213e 100%);
      color: #e0e0e0;
      min-height: 100vh;
      padding: 20px;
    }
    .container { max-width: 1400px; margin: 0 auto; }
    
    header {
      text-align: center;
      padding: 30px 0;
      border-bottom: 1px solid #333;
      margin-bottom: 30px;
    }
    h1 {
      font-size: 2rem;
      background: linear-gradient(90deg, #00d4ff, #7b2cbf);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 10px;
    }
    .status-badge {
      display: inline-block;
      padding: 5px 15px;
      border-radius: 20px;
      font-size: 0.85rem;
      animation: pulse 2s infinite;
    }
    .status-online { background: rgba(0, 255, 136, 0.2); color: #00ff88; border: 1px solid #00ff88; }
    .status-offline { background: rgba(255, 68, 68, 0.2); color: #ff4444; border: 1px solid #ff4444; }
    
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.7; }
    }
    
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }
    
    .card {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      padding: 20px;
      backdrop-filter: blur(10px);
    }
    .card-title {
      font-size: 0.9rem;
      color: #888;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 15px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .card-title::before {
      content: '';
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #00d4ff;
    }
    .card-value {
      font-size: 2.5rem;
      font-weight: bold;
      color: #fff;
    }
    .card-value.green { color: #00ff88; }
    .card-value.yellow { color: #ffdd00; }
    .card-value.red { color: #ff4444; }
    .card-sub { font-size: 0.85rem; color: #666; margin-top: 5px; }
    
    .progress-container {
      margin-top: 15px;
    }
    .progress-bar {
      height: 8px;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 4px;
      overflow: hidden;
    }
    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #00ff88, #00d4ff);
      border-radius: 4px;
      transition: width 0.5s ease;
    }
    .progress-label {
      display: flex;
      justify-content: space-between;
      font-size: 0.8rem;
      color: #888;
      margin-top: 5px;
    }
    
    .table-container {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      overflow: hidden;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th {
      background: rgba(0, 212, 255, 0.1);
      padding: 15px;
      text-align: left;
      font-size: 0.85rem;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #00d4ff;
    }
    td {
      padding: 12px 15px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
      font-size: 0.9rem;
    }
    tr:hover { background: rgba(255, 255, 255, 0.03); }
    .pool-status {
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      margin-right: 8px;
    }
    .pool-online { background: #00ff88; box-shadow: 0 0 10px #00ff88; }
    .pool-offline { background: #ff4444; }
    
    .footer {
      text-align: center;
      padding: 20px;
      color: #555;
      font-size: 0.85rem;
    }
    
    .refresh-info {
      text-align: right;
      color: #555;
      font-size: 0.8rem;
      margin-bottom: 10px;
    }
    
    .miner-address {
      font-family: monospace;
      font-size: 0.85rem;
      color: #00d4ff;
    }
    
    @media (max-width: 768px) {
      .card-value { font-size: 1.8rem; }
      h1 { font-size: 1.5rem; }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>⛏️ 矿池中转代理系统</h1>
      <span id="status" class="status-badge status-online">● 运行中</span>
    </header>
    
    <div class="refresh-info">
      自动刷新: <span id="countdown">2</span>秒 | 最后更新: <span id="lastUpdate">--</span>
    </div>
    
    <div class="grid">
      <div class="card">
        <div class="card-title">运行时间</div>
        <div class="card-value" id="uptime">--</div>
        <div class="card-sub">启动时间: <span id="startTime">--</span></div>
      </div>
      
      <div class="card">
        <div class="card-title">连接矿工</div>
        <div class="card-value yellow" id="totalMiners">0</div>
        <div class="card-sub">活跃: <span id="activeMiners">0</span></div>
      </div>
      
      <div class="card">
        <div class="card-title">已接受份额</div>
        <div class="card-value green" id="acceptedShares">0</div>
        <div class="card-sub">总计: <span id="totalShares">0</span> | 拒绝: <span id="rejectedShares">0</span></div>
      </div>
      
      <div class="card">
        <div class="card-title">接受率</div>
        <div class="card-value" id="acceptRate">0%</div>
        <div class="progress-container">
          <div class="progress-bar">
            <div class="progress-fill" id="acceptRateBar" style="width: 0%"></div>
          </div>
          <div class="progress-label">
            <span>0%</span>
            <span>100%</span>
          </div>
        </div>
      </div>
      
      <div class="card">
        <div class="card-title">内存使用</div>
        <div class="card-value" id="memoryUsage">-- MB</div>
        <div class="card-sub">Heap: <span id="heapUsage">--</span></div>
      </div>
      
      <div class="card">
        <div class="card-title">系统信息</div>
        <div class="card-value" style="font-size: 1.2rem;" id="platform">--</div>
        <div class="card-sub">Node.js: <span id="nodeVersion">--</span></div>
      </div>
    </div>
    
    <h2 style="margin-bottom: 15px; color: #888; font-size: 1rem;">矿池状态</h2>
    <div class="table-container" style="margin-bottom: 30px;">
      <table>
        <thead>
          <tr>
            <th>状态</th>
            <th>协议</th>
            <th>币种</th>
            <th>名称</th>
            <th>地址</th>
            <th>延迟</th>
          </tr>
        </thead>
        <tbody id="poolsTable">
          <tr><td colspan="6" style="text-align: center; color: #555;">加载中...</td></tr>
        </tbody>
      </table>
    </div>
    
    <h2 style="margin-bottom: 15px; color: #888; font-size: 1rem;">活跃矿工</h2>
    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>钱包地址</th>
            <th>矿工名</th>
            <th>份额 (接受/总计)</th>
            <th>难度</th>
            <th>矿池</th>
          </tr>
        </thead>
        <tbody id="minersTable">
          <tr><td colspan="6" style="text-align: center; color: #555;">暂无矿工连接</td></tr>
        </tbody>
      </table>
    </div>
    
    <div class="footer">
      Mining Pool Proxy System v1.0.0
    </div>
  </div>
  
  <script>
    const REFRESH_INTERVAL = 2000;
    let countdown = 2;
    
    function formatUptime(seconds) {
      const days = Math.floor(seconds / 86400);
      const hours = Math.floor((seconds % 86400) / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      const secs = Math.floor(seconds % 60);
      
      if (days > 0) return days + '天 ' + hours + '时';
      if (hours > 0) return hours + '时 ' + minutes + '分';
      if (minutes > 0) return minutes + '分 ' + secs + '秒';
      return secs + '秒';
    }
    
    function formatMemory(bytes) {
      return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    }
    
    function formatNumber(num) {
      return num.toLocaleString();
    }
    
    function shortenAddress(addr) {
      if (addr.length <= 20) return addr;
      return addr.substring(0, 8) + '...' + addr.slice(-8);
    }
    
    async function fetchStats() {
      try {
        const res = await fetch('/stats');
        const data = await res.json();
        updateUI(data);
        document.getElementById('status').className = 'status-badge status-online';
        document.getElementById('status').textContent = '● 运行中';
      } catch (e) {
        document.getElementById('status').className = 'status-badge status-offline';
        document.getElementById('status').textContent = '● 连接失败';
      }
    }
    
    function updateUI(stats) {
      // 基本信息
      document.getElementById('uptime').textContent = formatUptime(stats.uptime);
      document.getElementById('startTime').textContent = new Date(stats.startTime).toLocaleString('zh-CN');
      document.getElementById('lastUpdate').textContent = new Date().toLocaleString('zh-CN');
      
      // 矿工
      document.getElementById('totalMiners').textContent = formatNumber(stats.miners.total);
      document.getElementById('activeMiners').textContent = formatNumber(stats.miners.active);
      
      // 份额
      document.getElementById('acceptedShares').textContent = formatNumber(stats.shares.accepted);
      document.getElementById('totalShares').textContent = formatNumber(stats.shares.total);
      document.getElementById('rejectedShares').textContent = formatNumber(stats.shares.rejected);
      
      // 接受率
      const rate = parseFloat(stats.shares.rate) || 0;
      document.getElementById('acceptRate').textContent = stats.shares.rate;
      document.getElementById('acceptRateBar').style.width = rate + '%';
      
      const rateEl = document.getElementById('acceptRate');
      rateEl.className = 'card-value ' + (rate >= 99 ? 'green' : rate >= 95 ? 'yellow' : 'red');
      
      // 系统
      document.getElementById('memoryUsage').textContent = formatMemory(stats.system.memory.rss);
      document.getElementById('heapUsage').textContent = formatMemory(stats.system.memory.heapUsed) + ' / ' + formatMemory(stats.system.memory.heapTotal);
      document.getElementById('platform').textContent = stats.system.platform;
      document.getElementById('nodeVersion').textContent = stats.system.nodeVersion;
      
      // 矿池表格
      const poolsHtml = stats.pools.map(p => {
        const statusText = p.connected ? '在线' : (p.error ? '错误' : '离线');
        const statusClass = p.connected ? 'pool-online' : 'pool-offline';
        const latencyText = p.connected ? p.latency + 'ms' : '-';
        const protocol = (p.protocol || 'stratum').toUpperCase();
        const protocolColor = protocol === 'ALEO' ? '#00d4ff' : '#00ff88';
        const coin = (p.coin || 'other').toUpperCase();
        const coinColor = coin === 'ALEO' ? '#00d4ff' : (coin === 'ETH' ? '#627eea' : '#888');
        return \`
          <tr>
            <td><span class="pool-status \${statusClass}"></span>\${statusText}</td>
            <td><span style="color: \${protocolColor}; font-size: 0.85rem;">\${protocol}</span></td>
            <td><span style="color: \${coinColor}; font-weight: bold;">\${coin}</span></td>
            <td>\${p.name}</td>
            <td>\${p.host}:\${p.port}</td>
            <td>\${latencyText}</td>
          </tr>
        \`;
      }).join('');
      document.getElementById('poolsTable').innerHTML = poolsHtml || '<tr><td colspan="6" style="text-align: center; color: #555;">无矿池配置</td></tr>';
      
      // 矿工表格
      const minersHtml = stats.miners.list.slice(0, 20).map(m => \`
        <tr>
          <td>\${m.id}</td>
          <td class="miner-address">\${shortenAddress(m.address)}</td>
          <td>\${m.worker}</td>
          <td><span style="color: #00ff88">\${m.sharesAccepted}</span> / \${m.sharesSubmitted}</td>
          <td>\${m.difficulty}</td>
          <td>\${m.pool}</td>
        </tr>
      \`).join('');
      document.getElementById('minersTable').innerHTML = minersHtml || '<tr><td colspan="6" style="text-align: center; color: #555;">暂无矿工连接</td></tr>';
    }
    
    // 定时刷新
    fetchStats();
    setInterval(fetchStats, REFRESH_INTERVAL);
    
    // 倒计时
    setInterval(() => {
      countdown--;
      if (countdown <= 0) countdown = 2;
      document.getElementById('countdown').textContent = countdown;
    }, 1000);
  </script>
</body>
</html>`;
  }

  /**
   * 获取当前统计数据
   */
  public getStats(): Stats {
    const miners = this.getMinersFn ? this.getMinersFn() : [];
    
    let totalShares = 0;
    let acceptedShares = 0;
    let rejectedShares = 0;

    const minersList: MinerStats[] = miners.map(m => {
      totalShares += m.sharesSubmitted;
      acceptedShares += m.sharesAccepted;
      rejectedShares += m.sharesRejected;

      return {
        id: m.id,
        address: m.minerInfo?.address || 'unknown',
        worker: m.minerInfo?.worker || 'unknown',
        connectedAt: m.connectedAt.toISOString(),
        lastActivity: m.lastActivity.toISOString(),
        sharesSubmitted: m.sharesSubmitted,
        sharesAccepted: m.sharesAccepted,
        sharesRejected: m.sharesRejected,
        difficulty: m.difficulty,
        pool: m.pool?.name || 'unknown'
      };
    });

    // 使用真实的矿池连接状态
    const poolStats: PoolStats[] = this.config.pools.map(p => {
      const realStatus = poolChecker.getStatus(p.host, p.port);
      return {
        name: p.name,
        host: p.host,
        port: p.port,
        connected: realStatus?.connected ?? false,
        latency: realStatus?.latency ?? 0,
        enabled: p.enabled,
        lastCheck: realStatus?.lastCheck?.toISOString() ?? null,
        error: realStatus?.error ?? null,
        protocol: p.protocol || 'stratum',
        coin: p.coin || 'other'
      };
    });

    return {
      startTime: this.startTime,
      uptime: process.uptime(),
      miners: {
        total: miners.length,
        active: miners.filter(m => m.isAuthorized).length,
        list: minersList
      },
      shares: {
        total: totalShares,
        accepted: acceptedShares,
        rejected: rejectedShares,
        rate: totalShares > 0 ? ((acceptedShares / totalShares) * 100).toFixed(2) + '%' : '0%'
      },
      pools: poolStats,
      system: {
        memory: process.memoryUsage(),
        cpu: process.cpuUsage(),
        platform: process.platform,
        nodeVersion: process.version
      }
    };
  }

  /**
   * 收集并存储统计数据
   */
  private collectStats(): void {
    const stats = this.getStats();
    this.statsHistory.push(stats);

    // 保持历史记录不超过最大长度
    if (this.statsHistory.length > this.maxHistoryLength) {
      this.statsHistory.shift();
    }

    this.emit('stats', stats);
    
    logger.info(`统计信息 - 矿工: ${stats.miners.total}, 份额: ${stats.shares.accepted}/${stats.shares.total} (${stats.shares.rate})`);
  }
}

export default StatsServer;

