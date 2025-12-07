/**
 * 实时监控终端界面
 * 提供终端内实时刷新的系统状态展示
 */

import * as http from 'http';

const API_HOST = process.env.API_HOST || 'localhost';
const API_PORT = parseInt(process.env.API_PORT || '8080');
const REFRESH_INTERVAL = parseInt(process.env.REFRESH_INTERVAL || '2000');

interface Stats {
  startTime: string;
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
    memory: {
      heapUsed: number;
      heapTotal: number;
      rss: number;
    };
  };
}

interface MinerStats {
  id: string;
  address: string;
  worker: string;
  sharesSubmitted: number;
  sharesAccepted: number;
  difficulty: number;
  pool: string;
}

interface PoolStats {
  name: string;
  host: string;
  port: number;
  connected: boolean;
}

// ANSI 颜色码
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgBlue: '\x1b[44m',
  bgGreen: '\x1b[42m',
  bgRed: '\x1b[41m',
};

// 清屏
function clearScreen(): void {
  process.stdout.write('\x1b[2J\x1b[H');
}

// 格式化时间
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  const parts = [];
  if (days > 0) parts.push(`${days}天`);
  if (hours > 0) parts.push(`${hours}小时`);
  if (minutes > 0) parts.push(`${minutes}分`);
  parts.push(`${secs}秒`);
  
  return parts.join(' ');
}

// 格式化内存
function formatMemory(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  return `${mb.toFixed(1)} MB`;
}

// 格式化数字（千分位）
function formatNumber(num: number): string {
  return num.toLocaleString();
}

// 创建进度条
function progressBar(current: number, total: number, width: number = 20): string {
  if (total === 0) return '░'.repeat(width);
  const percent = Math.min(current / total, 1);
  const filled = Math.round(percent * width);
  const empty = width - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

// 获取状态颜色
function getStatusColor(rate: string): string {
  const percent = parseFloat(rate);
  if (percent >= 99) return colors.green;
  if (percent >= 95) return colors.yellow;
  return colors.red;
}

// 获取统计数据
function fetchStats(): Promise<Stats | null> {
  return new Promise((resolve) => {
    const req = http.get(`http://${API_HOST}:${API_PORT}/stats`, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(null);
        }
      });
    });
    
    req.on('error', () => resolve(null));
    req.setTimeout(3000, () => {
      req.destroy();
      resolve(null);
    });
  });
}

// 渲染监控界面
function render(stats: Stats): void {
  clearScreen();
  
  const now = new Date().toLocaleString('zh-CN');
  const width = process.stdout.columns || 80;
  const line = '═'.repeat(width - 2);
  
  // 标题
  console.log(`${colors.cyan}╔${line}╗${colors.reset}`);
  console.log(`${colors.cyan}║${colors.bright}${colors.white}  矿池中转代理系统 - 实时监控  ${colors.reset}${' '.repeat(width - 36)}${colors.cyan}║${colors.reset}`);
  console.log(`${colors.cyan}╠${line}╣${colors.reset}`);
  
  // 基本信息
  console.log(`${colors.cyan}║${colors.reset} ${colors.bright}系统状态${colors.reset}                                                    ${colors.dim}${now}${colors.reset}`);
  console.log(`${colors.cyan}║${colors.reset}`);
  console.log(`${colors.cyan}║${colors.reset}   ${colors.green}●${colors.reset} 运行时间: ${colors.bright}${formatUptime(stats.uptime)}${colors.reset}`);
  console.log(`${colors.cyan}║${colors.reset}   ${colors.blue}●${colors.reset} 内存使用: ${formatMemory(stats.system.memory.heapUsed)} / ${formatMemory(stats.system.memory.heapTotal)}`);
  console.log(`${colors.cyan}║${colors.reset}`);
  
  // 矿工统计
  console.log(`${colors.cyan}╠${line}╣${colors.reset}`);
  console.log(`${colors.cyan}║${colors.reset} ${colors.bright}矿工统计${colors.reset}`);
  console.log(`${colors.cyan}║${colors.reset}`);
  console.log(`${colors.cyan}║${colors.reset}   总连接数: ${colors.bright}${colors.yellow}${formatNumber(stats.miners.total)}${colors.reset}    活跃矿工: ${colors.bright}${colors.green}${formatNumber(stats.miners.active)}${colors.reset}`);
  console.log(`${colors.cyan}║${colors.reset}`);
  
  // 份额统计
  const acceptRate = stats.shares.total > 0 
    ? ((stats.shares.accepted / stats.shares.total) * 100).toFixed(2)
    : '0.00';
  const rateColor = getStatusColor(acceptRate);
  
  console.log(`${colors.cyan}╠${line}╣${colors.reset}`);
  console.log(`${colors.cyan}║${colors.reset} ${colors.bright}份额统计${colors.reset}`);
  console.log(`${colors.cyan}║${colors.reset}`);
  console.log(`${colors.cyan}║${colors.reset}   总提交: ${colors.bright}${formatNumber(stats.shares.total)}${colors.reset}`);
  console.log(`${colors.cyan}║${colors.reset}   已接受: ${colors.green}${formatNumber(stats.shares.accepted)}${colors.reset}    已拒绝: ${colors.red}${formatNumber(stats.shares.rejected)}${colors.reset}`);
  console.log(`${colors.cyan}║${colors.reset}`);
  console.log(`${colors.cyan}║${colors.reset}   接受率: ${rateColor}${progressBar(stats.shares.accepted, stats.shares.total, 30)} ${acceptRate}%${colors.reset}`);
  console.log(`${colors.cyan}║${colors.reset}`);
  
  // 矿池状态
  console.log(`${colors.cyan}╠${line}╣${colors.reset}`);
  console.log(`${colors.cyan}║${colors.reset} ${colors.bright}矿池状态${colors.reset}`);
  console.log(`${colors.cyan}║${colors.reset}`);
  
  for (const pool of stats.pools) {
    const status = pool.connected 
      ? `${colors.green}● 在线${colors.reset}`
      : `${colors.red}● 离线${colors.reset}`;
    console.log(`${colors.cyan}║${colors.reset}   ${status}  ${pool.name} (${pool.host}:${pool.port})`);
  }
  console.log(`${colors.cyan}║${colors.reset}`);
  
  // 矿工列表（最多显示10个）
  if (stats.miners.list.length > 0) {
    console.log(`${colors.cyan}╠${line}╣${colors.reset}`);
    console.log(`${colors.cyan}║${colors.reset} ${colors.bright}活跃矿工${colors.reset} (最近10个)`);
    console.log(`${colors.cyan}║${colors.reset}`);
    console.log(`${colors.cyan}║${colors.reset}   ${colors.dim}ID${' '.repeat(12)}钱包地址${' '.repeat(20)}矿工名${' '.repeat(10)}份额${colors.reset}`);
    console.log(`${colors.cyan}║${colors.reset}   ${colors.dim}${'─'.repeat(60)}${colors.reset}`);
    
    const displayMiners = stats.miners.list.slice(0, 10);
    for (const miner of displayMiners) {
      const addr = miner.address.length > 20 
        ? miner.address.substring(0, 8) + '...' + miner.address.slice(-8)
        : miner.address.padEnd(20);
      const worker = miner.worker.substring(0, 12).padEnd(12);
      console.log(`${colors.cyan}║${colors.reset}   ${miner.id.padEnd(14)} ${addr} ${worker} ${colors.green}${miner.sharesAccepted}${colors.reset}/${miner.sharesSubmitted}`);
    }
    
    if (stats.miners.list.length > 10) {
      console.log(`${colors.cyan}║${colors.reset}   ${colors.dim}... 还有 ${stats.miners.list.length - 10} 个矿工${colors.reset}`);
    }
    console.log(`${colors.cyan}║${colors.reset}`);
  }
  
  // 底部
  console.log(`${colors.cyan}╠${line}╣${colors.reset}`);
  console.log(`${colors.cyan}║${colors.reset} ${colors.dim}按 Ctrl+C 退出监控${colors.reset}${' '.repeat(width - 23)}${colors.cyan}║${colors.reset}`);
  console.log(`${colors.cyan}╚${line}╝${colors.reset}`);
}

// 渲染错误界面
function renderError(): void {
  clearScreen();
  console.log(`${colors.red}╔════════════════════════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.red}║                                                            ║${colors.reset}`);
  console.log(`${colors.red}║   ⚠️  无法连接到代理服务器                                  ║${colors.reset}`);
  console.log(`${colors.red}║                                                            ║${colors.reset}`);
  console.log(`${colors.red}║   请确保代理服务正在运行:                                  ║${colors.reset}`);
  console.log(`${colors.red}║   npm start                                                ║${colors.reset}`);
  console.log(`${colors.red}║                                                            ║${colors.reset}`);
  console.log(`${colors.red}║   API 地址: http://${API_HOST}:${API_PORT}                           ║${colors.reset}`);
  console.log(`${colors.red}║                                                            ║${colors.reset}`);
  console.log(`${colors.red}╚════════════════════════════════════════════════════════════╝${colors.reset}`);
  console.log(`\n${colors.dim}正在重试连接...${colors.reset}`);
}

// 主循环
async function main(): Promise<void> {
  console.log(`${colors.cyan}正在连接到 http://${API_HOST}:${API_PORT}...${colors.reset}`);
  
  const update = async () => {
    const stats = await fetchStats();
    if (stats) {
      render(stats);
    } else {
      renderError();
    }
  };
  
  // 立即执行一次
  await update();
  
  // 定时刷新
  setInterval(update, REFRESH_INTERVAL);
  
  // 处理退出
  process.on('SIGINT', () => {
    clearScreen();
    console.log(`${colors.green}监控已停止${colors.reset}`);
    process.exit(0);
  });
}

main().catch(console.error);

