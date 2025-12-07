/**
 * 矿池代理服务器核心模块
 * 纯透明转发模式 - 最大化兼容性和性能
 */

import * as net from 'net';
import { EventEmitter } from 'events';
import { configManager, PoolConfig } from './config';
import { globalHashrateCalculator } from './hashrate';
import logger from './logger';

export interface MinerConnection {
  id: string;
  socket: net.Socket;
  poolSocket: net.Socket | null;
  pool: PoolConfig | null;
  connectedAt: Date;
  lastActivity: Date;
  sharesSubmitted: number;
  sharesAccepted: number;
  sharesRejected: number;
  difficulty: number;
  isAuthorized: boolean;
  workerName: string;
  buffer: string;           // 矿机数据缓冲
  poolBuffer: string;       // 矿池数据缓冲
}

export class MiningProxy extends EventEmitter {
  private server: net.Server;
  private miners: Map<string, MinerConnection> = new Map();
  private connectionId: number = 0;
  private config = configManager.get();

  constructor() {
    super();
    this.server = net.createServer(this.handleMinerConnection.bind(this));
  }

  public start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const { host, port, maxConnections } = this.config.proxy;
      
      this.server.maxConnections = maxConnections;
      
      this.server.listen(port, host, () => {
        logger.info(`代理服务器已启动 - 监听 ${host}:${port}`);
        logger.info(`最大连接数: ${maxConnections}`);
        resolve();
      });

      this.server.on('error', (err) => {
        logger.error('服务器错误:', err);
        reject(err);
      });

      setInterval(() => this.cleanupInactiveConnections(), 60000);
    });
  }

  public stop(): Promise<void> {
    return new Promise((resolve) => {
      for (const [id] of this.miners) {
        this.disconnectMiner(id, '服务器关闭');
      }
      this.server.close(() => {
        logger.info('代理服务器已停止');
        resolve();
      });
    });
  }

  private handleMinerConnection(minerSocket: net.Socket): void {
    const id = `miner_${++this.connectionId}`;
    const remoteAddress = `${minerSocket.remoteAddress}:${minerSocket.remotePort}`;
    
    // 禁用 Nagle 算法
    minerSocket.setNoDelay(true);
    
    logger.info(`新矿机连接: ${id} 来自 ${remoteAddress}`);

    // 立即连接矿池
    const pool = this.config.pools.find(p => p.enabled) || this.config.pools[0];
    if (!pool) {
      logger.error('没有可用的矿池配置');
      minerSocket.destroy();
      return;
    }

    const poolSocket = net.createConnection({
      host: pool.host,
      port: pool.port
    });

    poolSocket.setNoDelay(true);

    const miner: MinerConnection = {
      id,
      socket: minerSocket,
      poolSocket,
      pool,
      connectedAt: new Date(),
      lastActivity: new Date(),
      sharesSubmitted: 0,
      sharesAccepted: 0,
      sharesRejected: 0,
      difficulty: 1000000,
      isAuthorized: false,
      workerName: '',
      buffer: '',
      poolBuffer: ''
    };

    this.miners.set(id, miner);

    // 矿池连接事件
    poolSocket.on('connect', () => {
      logger.info(`矿机 ${id} 已连接矿池: ${pool.name} (${pool.host}:${pool.port})`);
    });

    poolSocket.on('error', (err) => {
      logger.error(`矿机 ${id} 矿池连接错误: ${err.message}`);
      this.disconnectMiner(id, err.message);
    });

    poolSocket.on('close', () => {
      logger.warn(`矿机 ${id} 矿池连接关闭`);
      this.disconnectMiner(id, '矿池断开');
    });

    // 矿机 -> 矿池：解析并转发
    minerSocket.on('data', (data) => {
      miner.lastActivity = new Date();
      miner.buffer += data.toString();
      
      let newlineIndex: number;
      while ((newlineIndex = miner.buffer.indexOf('\n')) !== -1) {
        const line = miner.buffer.substring(0, newlineIndex);
        miner.buffer = miner.buffer.substring(newlineIndex + 1);
        
        if (line.trim().length > 0) {
          try {
            const msg = JSON.parse(line);
            
            // 记录授权信息
            if (msg.method === 'mining.authorize' && msg.params && msg.params[0]) {
              miner.workerName = msg.params[0];
              logger.info(`矿机 ${id} 授权: ${miner.workerName}`);
            }
            
            // 记录份额提交
            if (msg.method === 'mining.submit') {
              miner.sharesSubmitted++;
              logger.debug(`矿机 ${id} 提交份额 (ID: ${msg.id})`);
            }
            
            // 直接转发原始数据到矿池
            if (poolSocket && !poolSocket.destroyed) {
              poolSocket.write(line + '\n');
            }
          } catch (e) {
            // 无法解析，直接转发原始数据
            if (poolSocket && !poolSocket.destroyed) {
              poolSocket.write(line + '\n');
            }
          }
        }
      }
    });

    // 矿池 -> 矿机：解析并转发
    poolSocket.on('data', (data) => {
      miner.poolBuffer += data.toString();
      
      let newlineIndex: number;
      while ((newlineIndex = miner.poolBuffer.indexOf('\n')) !== -1) {
        const line = miner.poolBuffer.substring(0, newlineIndex);
        miner.poolBuffer = miner.poolBuffer.substring(newlineIndex + 1);
        
        if (line.trim().length > 0) {
          try {
            const msg = JSON.parse(line);
            
            // 处理份额响应
            if (msg.id !== null && msg.id !== undefined) {
              if (msg.result === true) {
                miner.sharesAccepted++;
                globalHashrateCalculator.addShare(miner.difficulty, true);
                logger.info(`矿机 ${id} 份额被接受 (ID: ${msg.id})`);
              } else if (msg.error) {
                miner.sharesRejected++;
                globalHashrateCalculator.addShare(miner.difficulty, false);
                logger.warn(`矿机 ${id} 份额被拒绝 (ID: ${msg.id}): ${JSON.stringify(msg.error)}`);
              }
              
              // 授权响应
              if (msg.result === true && !miner.isAuthorized) {
                miner.isAuthorized = true;
                logger.info(`矿机 ${id} 授权成功`);
              }
            }
            
            // 处理难度设置
            if (msg.method === 'mining.set_difficulty' && msg.params) {
              miner.difficulty = msg.params[0] || 1000000;
              logger.info(`矿机 ${id} 难度: ${miner.difficulty}`);
            }
            
            // 直接转发原始数据到矿机
            if (minerSocket && !minerSocket.destroyed) {
              minerSocket.write(line + '\n');
            }
          } catch (e) {
            // 无法解析，直接转发原始数据
            if (minerSocket && !minerSocket.destroyed) {
              minerSocket.write(line + '\n');
            }
          }
        }
      }
    });

    // 矿机连接事件
    minerSocket.on('error', (err) => {
      logger.error(`矿机 ${id} 连接错误: ${err.message}`);
      this.disconnectMiner(id, err.message);
    });

    minerSocket.on('close', () => {
      logger.info(`矿机 ${id} 断开连接`);
      this.disconnectMiner(id, '连接关闭');
    });

    minerSocket.setTimeout(300000);
    poolSocket.setTimeout(60000);
  }

  private disconnectMiner(minerId: string, reason: string): void {
    const miner = this.miners.get(minerId);
    if (!miner) return;

    logger.info(`断开矿机 ${minerId}: ${reason}`);

    if (miner.poolSocket && !miner.poolSocket.destroyed) {
      miner.poolSocket.destroy();
    }
    if (miner.socket && !miner.socket.destroyed) {
      miner.socket.destroy();
    }

    this.miners.delete(minerId);
    this.emit('minerDisconnected', miner, reason);
  }

  private cleanupInactiveConnections(): void {
    const now = Date.now();
    const timeout = 600000;

    for (const [id, miner] of this.miners) {
      if (now - miner.lastActivity.getTime() > timeout) {
        logger.warn(`清理不活跃连接: ${id}`);
        this.disconnectMiner(id, '不活跃超时');
      }
    }
  }

  public getMiners(): MinerConnection[] {
    return Array.from(this.miners.values());
  }

  public getStats(): object {
    const miners = this.getMiners();
    let totalShares = 0;
    let acceptedShares = 0;
    let rejectedShares = 0;

    for (const miner of miners) {
      totalShares += miner.sharesSubmitted;
      acceptedShares += miner.sharesAccepted;
      rejectedShares += miner.sharesRejected;
    }

    return {
      activeMiners: miners.length,
      totalShares,
      acceptedShares,
      rejectedShares,
      acceptRate: totalShares > 0 ? ((acceptedShares / totalShares) * 100).toFixed(2) + '%' : '0%',
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage()
    };
  }
}

export default MiningProxy;
