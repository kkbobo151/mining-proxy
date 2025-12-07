/**
 * 矿池健康检查模块
 * 定期检测矿池的真实连接状态
 */

import * as net from 'net';
import { EventEmitter } from 'events';
import { PoolConfig, configManager } from './config';
import { StratumParser } from './stratum';
import logger from './logger';

export interface PoolStatus {
  name: string;
  host: string;
  port: number;
  enabled: boolean;
  connected: boolean;
  lastCheck: Date | null;
  lastSuccess: Date | null;
  latency: number;
  error: string | null;
  checkCount: number;
  successCount: number;
  failCount: number;
}

export class PoolChecker extends EventEmitter {
  private poolStatus: Map<string, PoolStatus> = new Map();
  private checkInterval: NodeJS.Timeout | null = null;
  private config = configManager.get();
  private checkIntervalMs: number = 30000; // 30秒检查一次
  private connectionTimeout: number = 10000; // 10秒超时

  constructor() {
    super();
    this.initializeStatus();
  }

  /**
   * 初始化矿池状态
   */
  private initializeStatus(): void {
    for (const pool of this.config.pools) {
      const key = `${pool.host}:${pool.port}`;
      this.poolStatus.set(key, {
        name: pool.name,
        host: pool.host,
        port: pool.port,
        enabled: pool.enabled,
        connected: false,
        lastCheck: null,
        lastSuccess: null,
        latency: 0,
        error: null,
        checkCount: 0,
        successCount: 0,
        failCount: 0
      });
    }
  }

  /**
   * 启动定期检查
   */
  public start(): void {
    logger.info('矿池健康检查服务启动');
    
    // 立即执行一次检查
    this.checkAllPools();
    
    // 定期检查
    this.checkInterval = setInterval(() => {
      this.checkAllPools();
    }, this.checkIntervalMs);
  }

  /**
   * 停止检查
   */
  public stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    logger.info('矿池健康检查服务停止');
  }

  /**
   * 检查所有矿池
   */
  public async checkAllPools(): Promise<void> {
    const pools = this.config.pools.filter(p => p.enabled);
    
    for (const pool of pools) {
      await this.checkPool(pool);
    }
  }

  /**
   * 检查单个矿池
   */
  public checkPool(pool: PoolConfig): Promise<boolean> {
    return new Promise((resolve) => {
      const key = `${pool.host}:${pool.port}`;
      const status = this.poolStatus.get(key);
      
      if (!status) {
        resolve(false);
        return;
      }

      const startTime = Date.now();
      status.checkCount++;
      status.lastCheck = new Date();

      logger.debug(`检查矿池: ${pool.name} (${pool.host}:${pool.port})`);

      const socket = new net.Socket();
      let resolved = false;

      const cleanup = () => {
        if (!resolved) {
          resolved = true;
          socket.destroy();
        }
      };

      // 设置超时
      socket.setTimeout(this.connectionTimeout);

      socket.on('connect', () => {
        const latency = Date.now() - startTime;
        const isAleo = pool.protocol === 'aleo' || pool.coin === 'aleo';
        
        // Aleo 矿池也使用 Stratum 协议 (stratum+tcp://aleo.f2pool.com:4400)
        // 所以统一使用 Stratum 协议进行检测
        const subscribeMsg = StratumParser.createSubscribe('pool-checker/1.0');
        socket.write(StratumParser.serialize(subscribeMsg));

        // 等待响应
        socket.once('data', (data) => {
          try {
            const parser = new StratumParser();
            const messages = parser.parse(data);
            
            if (messages.length > 0) {
              // 收到有效响应
              status.connected = true;
              status.latency = latency;
              status.error = null;
              status.successCount++;
              status.lastSuccess = new Date();
              
              const coinName = isAleo ? 'Aleo' : (pool.coin || 'Stratum');
              logger.info(`矿池 ${pool.name} [${coinName}] 在线 - 延迟: ${latency}ms`);
              this.emit('poolOnline', pool, latency);
              
              cleanup();
              resolve(true);
            } else {
              throw new Error('无效的响应');
            }
          } catch (e) {
            // 收到数据但不是有效的 Stratum 响应
            // 可能是其他服务，但至少端口是开放的
            status.connected = true;
            status.latency = latency;
            status.error = '端口开放但响应异常';
            status.successCount++;
            status.lastSuccess = new Date();
            
            logger.warn(`矿池 ${pool.name} 端口开放但响应异常`);
            cleanup();
            resolve(true);
          }
        });
      });

      socket.on('timeout', () => {
        status.connected = false;
        status.latency = 0;
        status.error = '连接超时';
        status.failCount++;
        
        logger.warn(`矿池 ${pool.name} 连接超时`);
        this.emit('poolOffline', pool, '连接超时');
        
        cleanup();
        resolve(false);
      });

      socket.on('error', (err) => {
        status.connected = false;
        status.latency = 0;
        status.error = err.message;
        status.failCount++;
        
        logger.warn(`矿池 ${pool.name} 连接失败: ${err.message}`);
        this.emit('poolOffline', pool, err.message);
        
        cleanup();
        resolve(false);
      });

      socket.on('close', () => {
        if (!resolved) {
          cleanup();
          resolve(status.connected);
        }
      });

      // 开始连接
      try {
        socket.connect(pool.port, pool.host);
      } catch (err: any) {
        status.connected = false;
        status.error = err.message;
        status.failCount++;
        cleanup();
        resolve(false);
      }
    });
  }

  /**
   * 获取所有矿池状态
   */
  public getAllStatus(): PoolStatus[] {
    return Array.from(this.poolStatus.values());
  }

  /**
   * 获取指定矿池状态
   */
  public getStatus(host: string, port: number): PoolStatus | undefined {
    return this.poolStatus.get(`${host}:${port}`);
  }

  /**
   * 更新矿池连接状态（由 proxy 模块调用）
   */
  public updatePoolStatus(host: string, port: number, connected: boolean, latency?: number): void {
    const key = `${host}:${port}`;
    const status = this.poolStatus.get(key);
    
    if (status) {
      status.connected = connected;
      if (connected) {
        status.lastSuccess = new Date();
        if (latency !== undefined) {
          status.latency = latency;
        }
      }
    }
  }

  /**
   * 设置检查间隔
   */
  public setCheckInterval(ms: number): void {
    this.checkIntervalMs = ms;
    if (this.checkInterval) {
      this.stop();
      this.start();
    }
  }
}

// 单例
export const poolChecker = new PoolChecker();
export default poolChecker;

