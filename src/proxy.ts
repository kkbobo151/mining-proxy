/**
 * 矿池代理服务器核心模块
 * 负责监听矿机连接并转发到上游矿池
 * 支持: Stratum V1 (BTC/ETH/ETC/LTC) 和 Aleo
 */

import * as net from 'net';
import { EventEmitter } from 'events';
import { StratumParser, StratumMessage, MinerInfo } from './stratum';
import { AleoStratumParser } from './protocols/aleoStratum';
import { configManager, PoolConfig, CoinType } from './config';
import { globalHashrateCalculator } from './hashrate';
import logger from './logger';

export interface MinerConnection {
  id: string;
  socket: net.Socket;
  parser: StratumParser;
  minerInfo: MinerInfo | null;
  poolSocket: net.Socket | null;
  poolParser: StratumParser | null;
  pool: PoolConfig | null;
  connectedAt: Date;
  lastActivity: Date;
  sharesSubmitted: number;
  sharesAccepted: number;
  sharesRejected: number;
  hashrate: number;
  difficulty: number;
  extranonce1: string;
  extranonce2Size: number;
  pendingRequests: Map<number, StratumMessage>;
  isAuthorized: boolean;
  isSubscribed: boolean;
  coinType: CoinType;        // 币种类型
  isAleo: boolean;           // 是否为 Aleo 挖矿
}

export class MiningProxy extends EventEmitter {
  private server: net.Server;
  private miners: Map<string, MinerConnection> = new Map();
  private connectionId: number = 0;
  private config = configManager.get();
  private feeShareCounter: number = 0;

  constructor() {
    super();
    this.server = net.createServer(this.handleMinerConnection.bind(this));
  }

  /**
   * 启动代理服务器
   */
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

      // 定时清理不活跃连接
      setInterval(() => this.cleanupInactiveConnections(), 60000);
    });
  }

  /**
   * 停止代理服务器
   */
  public stop(): Promise<void> {
    return new Promise((resolve) => {
      // 关闭所有矿工连接
      for (const [id, miner] of this.miners) {
        this.disconnectMiner(id, '服务器关闭');
      }

      this.server.close(() => {
        logger.info('代理服务器已停止');
        resolve();
      });
    });
  }

  /**
   * 处理新的矿机连接
   */
  private handleMinerConnection(socket: net.Socket): void {
    const id = `miner_${++this.connectionId}`;
    const remoteAddress = `${socket.remoteAddress}:${socket.remotePort}`;
    
    logger.info(`新矿机连接: ${id} 来自 ${remoteAddress}`);

    const miner: MinerConnection = {
      id,
      socket,
      parser: new StratumParser(),
      minerInfo: null,
      poolSocket: null,
      poolParser: null,
      pool: null,
      connectedAt: new Date(),
      lastActivity: new Date(),
      sharesSubmitted: 0,
      sharesAccepted: 0,
      sharesRejected: 0,
      hashrate: 0,
      difficulty: 0,
      extranonce1: '',
      extranonce2Size: 4,
      pendingRequests: new Map(),
      isAuthorized: false,
      isSubscribed: false,
      coinType: 'other',
      isAleo: false
    };

    this.miners.set(id, miner);
    this.emit('minerConnected', miner);

    socket.on('data', (data) => this.handleMinerData(id, data));
    socket.on('error', (err) => {
      logger.error(`矿机 ${id} 连接错误:`, err.message);
      this.disconnectMiner(id, err.message);
    });
    socket.on('close', () => {
      logger.info(`矿机 ${id} 断开连接`);
      this.disconnectMiner(id, '连接关闭');
    });
    socket.on('timeout', () => {
      logger.warn(`矿机 ${id} 超时`);
      this.disconnectMiner(id, '超时');
    });

    socket.setTimeout(300000); // 5分钟超时
  }

  /**
   * 处理矿机发送的数据
   */
  private handleMinerData(minerId: string, data: Buffer): void {
    const miner = this.miners.get(minerId);
    if (!miner) return;

    miner.lastActivity = new Date();
    const messages = miner.parser.parse(data);

    for (const message of messages) {
      this.handleMinerMessage(miner, message);
    }
  }

  /**
   * 处理矿机消息
   */
  private async handleMinerMessage(miner: MinerConnection, message: StratumMessage): Promise<void> {
    logger.debug(`矿机 ${miner.id} 消息:`, message);

    switch (message.method) {
      case 'mining.subscribe':
        await this.handleSubscribe(miner, message);
        break;

      case 'mining.authorize':
        await this.handleAuthorize(miner, message);
        break;

      case 'mining.submit':
        await this.handleSubmit(miner, message);
        break;

      case 'mining.extranonce.subscribe':
        // 扩展订阅，直接返回成功
        this.sendToMiner(miner, StratumParser.createResponse(message.id as number, true));
        break;

      default:
        // 转发其他消息到矿池
        if (miner.poolSocket && message.id) {
          miner.pendingRequests.set(message.id, message);
          this.sendToPool(miner, message);
        }
    }
  }

  /**
   * 处理矿机订阅请求
   */
  private async handleSubscribe(miner: MinerConnection, message: StratumMessage): Promise<void> {
    // 如果还没连接矿池，先连接
    if (!miner.poolSocket) {
      const connected = await this.connectToPool(miner);
      if (!connected) {
        this.sendToMiner(miner, StratumParser.createError(
          message.id as number,
          20,
          '无法连接到矿池'
        ));
        return;
      }
    }

    miner.isSubscribed = true;
    miner.pendingRequests.set(message.id as number, message);
    
    // 转发订阅请求到矿池
    const subscribeMsg = StratumParser.createSubscribe('mining-proxy/1.0');
    subscribeMsg.id = message.id;
    this.sendToPool(miner, subscribeMsg);
  }

  /**
   * 处理矿机授权请求
   */
  private async handleAuthorize(miner: MinerConnection, message: StratumMessage): Promise<void> {
    const minerInfo = StratumParser.parseAuthorize(message);
    if (!minerInfo) {
      this.sendToMiner(miner, StratumParser.createError(
        message.id as number,
        24,
        '无效的授权格式'
      ));
      return;
    }

    miner.minerInfo = minerInfo;
    miner.minerInfo.extranonce1 = miner.extranonce1;
    miner.minerInfo.extranonce2Size = miner.extranonce2Size;

    // 检测是否为 Aleo 地址 (aleo1 开头)
    if (AleoStratumParser.isValidAleoAddress(minerInfo.address)) {
      miner.isAleo = true;
      miner.coinType = 'aleo';
      logger.info(`矿机 ${miner.id} 检测到 Aleo 地址: ${minerInfo.address}.${minerInfo.worker}`);
    } else {
      logger.info(`矿机 ${miner.id} 授权: ${minerInfo.address}.${minerInfo.worker}`);
    }

    // 确保已连接矿池
    if (!miner.poolSocket) {
      const connected = await this.connectToPool(miner);
      if (!connected) {
        this.sendToMiner(miner, StratumParser.createError(
          message.id as number,
          20,
          '无法连接到矿池'
        ));
        return;
      }
    }

    miner.pendingRequests.set(message.id as number, message);

    // 使用矿工自己的钱包地址转发授权请求
    const authorizeMsg = StratumParser.createAuthorize(
      minerInfo.address,
      minerInfo.worker,
      minerInfo.password
    );
    authorizeMsg.id = message.id;
    this.sendToPool(miner, authorizeMsg);
  }

  /**
   * 处理份额提交
   */
  private async handleSubmit(miner: MinerConnection, message: StratumMessage): Promise<void> {
    if (!miner.poolSocket || !miner.minerInfo) {
      this.sendToMiner(miner, StratumParser.createError(
        message.id as number,
        25,
        '未授权'
      ));
      logger.warn(`矿机 ${miner.id} 份额提交失败: 未授权或未连接矿池`);
      return;
    }

    miner.sharesSubmitted++;
    miner.lastActivity = new Date();

    // 抽水逻辑
    if (this.config.fees.enabled && this.shouldFeeShare()) {
      // 将这个份额提交到抽水钱包
      await this.submitFeeShare(miner, message);
    } else {
      // 正常转发到矿池
      miner.pendingRequests.set(message.id as number, message);
      this.sendToPool(miner, message);
      logger.info(`矿机 ${miner.id} 份额已转发到矿池 (ID: ${message.id})`);
    }
  }

  /**
   * 判断是否应该抽水
   */
  private shouldFeeShare(): boolean {
    if (!this.config.fees.enabled) return false;
    
    this.feeShareCounter++;
    const feeInterval = Math.floor(100 / this.config.fees.percent);
    
    if (this.feeShareCounter >= feeInterval) {
      this.feeShareCounter = 0;
      return true;
    }
    return false;
  }

  /**
   * 提交抽水份额
   */
  private async submitFeeShare(miner: MinerConnection, message: StratumMessage): Promise<void> {
    // 这里可以实现更复杂的抽水逻辑
    // 简单实现：直接修改worker名称指向抽水钱包
    const params = message.params as string[];
    const feeWorker = `${this.config.fees.wallet}.${this.config.wallet.workerPrefix}`;
    
    const feeMessage: StratumMessage = {
      id: message.id,
      method: 'mining.submit',
      params: [feeWorker, ...params.slice(1)]
    };

    miner.pendingRequests.set(message.id as number, message);
    this.sendToPool(miner, feeMessage);
    
    logger.debug(`抽水份额已提交: ${miner.id}`);
  }

  /**
   * 连接到矿池
   */
  private connectToPool(miner: MinerConnection): Promise<boolean> {
    return new Promise((resolve) => {
      let pool: PoolConfig | undefined;
      
      // 根据矿工类型选择对应的矿池
      if (miner.isAleo) {
        // 优先选择 Aleo 矿池
        const aleoPools = configManager.getAleoPools();
        if (aleoPools.length > 0) {
          // 按权重选择
          const totalWeight = aleoPools.reduce((sum, p) => sum + p.weight, 0);
          let random = Math.random() * totalWeight;
          for (const p of aleoPools) {
            random -= p.weight;
            if (random <= 0) {
              pool = p;
              break;
            }
          }
          pool = pool || aleoPools[0];
        }
      }
      
      // 如果没有找到对应币种的矿池，使用默认矿池
      if (!pool) {
        pool = configManager.getActivePool();
      }
      
      if (!pool) {
        logger.error('没有可用的矿池');
        resolve(false);
        return;
      }

      const coinInfo = miner.isAleo ? '[Aleo]' : '';
      logger.info(`矿机 ${miner.id} ${coinInfo} 连接到矿池: ${pool.name} (${pool.host}:${pool.port})`);

      const poolSocket = net.createConnection({
        host: pool.host,
        port: pool.port
      });

      poolSocket.on('connect', () => {
        logger.info(`矿机 ${miner.id} 成功连接到矿池 ${pool.name}`);
        miner.poolSocket = poolSocket;
        miner.poolParser = new StratumParser();
        miner.pool = pool;
        resolve(true);
      });

      poolSocket.on('data', (data) => this.handlePoolData(miner, data));

      poolSocket.on('error', (err) => {
        logger.error(`矿机 ${miner.id} 矿池连接错误:`, err.message);
        this.handlePoolDisconnect(miner);
        resolve(false);
      });

      poolSocket.on('close', () => {
        logger.warn(`矿机 ${miner.id} 矿池连接关闭`);
        this.handlePoolDisconnect(miner);
      });

      poolSocket.setTimeout(60000);
    });
  }

  /**
   * 处理矿池发送的数据
   */
  private handlePoolData(miner: MinerConnection, data: Buffer): void {
    if (!miner.poolParser) return;

    const messages = miner.poolParser.parse(data);
    for (const message of messages) {
      this.handlePoolMessage(miner, message);
    }
  }

  /**
   * 处理矿池消息
   */
  private handlePoolMessage(miner: MinerConnection, message: StratumMessage): void {
    // 记录矿池发送的方法消息用于调试
    if (message.method) {
      logger.debug(`矿池消息 (${miner.id}): ${message.method} - ${JSON.stringify(message.params)}`);
    }

    // 处理响应消息
    if (message.id !== null && message.id !== undefined) {
      const pendingRequest = miner.pendingRequests.get(message.id);
      
      if (pendingRequest) {
        miner.pendingRequests.delete(message.id);

        // 处理订阅响应
        if (pendingRequest.method === 'mining.subscribe') {
          const subscribeResult = StratumParser.parseSubscribeResponse(message);
          if (subscribeResult) {
            miner.extranonce1 = subscribeResult.extranonce1;
            miner.extranonce2Size = subscribeResult.extranonce2Size;
          }
        }

        // 处理授权响应
        if (pendingRequest.method === 'mining.authorize') {
          if (message.result === true) {
            miner.isAuthorized = true;
            logger.info(`矿机 ${miner.id} 授权成功`);
          } else {
            logger.warn(`矿机 ${miner.id} 授权失败`);
          }
        }

        // 处理份额提交响应
        if (pendingRequest.method === 'mining.submit') {
          // 如果没有设置难度，使用默认值 1M（Aleo 的典型难度）
          const shareDifficulty = miner.difficulty > 0 ? miner.difficulty : 1000000;
          
          if (message.result === true) {
            miner.sharesAccepted++;
            // 记录份额到算力计算器
            globalHashrateCalculator.addShare(shareDifficulty, true);
            logger.info(`矿机 ${miner.id} 份额被矿池接受 (ID: ${message.id})`);
          } else {
            miner.sharesRejected++;
            globalHashrateCalculator.addShare(shareDifficulty, false);
            const errorMsg = message.error ? JSON.stringify(message.error) : '未知原因';
            logger.warn(`矿机 ${miner.id} 份额被矿池拒绝 (ID: ${message.id}): ${errorMsg}`);
          }
        }
      }

      // 转发响应给矿机
      this.sendToMiner(miner, message);
      return;
    }

    // 处理通知消息
    switch (message.method) {
      case 'mining.set_difficulty':
        const difficulty = (message.params as number[])[0];
        miner.difficulty = difficulty;
        logger.info(`矿机 ${miner.id} 难度设置: ${difficulty}`);
        this.sendToMiner(miner, message);
        break;

      case 'mining.notify':
        // 转发任务通知给矿机
        this.sendToMiner(miner, message);
        break;

      case 'mining.set_target':
        // Aleo 可能使用 set_target 而不是 set_difficulty
        const target = message.params as any;
        if (target && target[0]) {
          // 尝试从 target 计算难度
          const targetDiff = typeof target[0] === 'number' ? target[0] : 1;
          miner.difficulty = targetDiff;
          logger.info(`矿机 ${miner.id} 目标难度设置: ${targetDiff}`);
        }
        this.sendToMiner(miner, message);
        break;

      default:
        // 记录未知消息类型用于调试
        if (message.method) {
          logger.debug(`矿机 ${miner.id} 收到矿池消息: ${message.method}`);
        }
        // 转发其他通知给矿机
        this.sendToMiner(miner, message);
    }
  }

  /**
   * 处理矿池断开连接
   */
  private handlePoolDisconnect(miner: MinerConnection): void {
    if (miner.poolSocket) {
      miner.poolSocket.destroy();
      miner.poolSocket = null;
      miner.poolParser = null;
    }

    // 尝试重连
    if (this.miners.has(miner.id)) {
      logger.info(`矿机 ${miner.id} 尝试重连矿池...`);
      setTimeout(async () => {
        if (this.miners.has(miner.id)) {
          const connected = await this.connectToPool(miner);
          if (connected && miner.minerInfo) {
            // 重新订阅和授权
            const subscribeMsg = StratumParser.createSubscribe('mining-proxy/1.0');
            this.sendToPool(miner, subscribeMsg);
          }
        }
      }, 5000);
    }
  }

  /**
   * 发送消息给矿机
   */
  private sendToMiner(miner: MinerConnection, message: StratumMessage): void {
    try {
      if (miner.socket && !miner.socket.destroyed) {
        miner.socket.write(StratumParser.serialize(message));
      }
    } catch (err) {
      logger.error(`发送消息到矿机 ${miner.id} 失败:`, err);
    }
  }

  /**
   * 发送消息给矿池
   */
  private sendToPool(miner: MinerConnection, message: StratumMessage): void {
    try {
      if (miner.poolSocket && !miner.poolSocket.destroyed) {
        miner.poolSocket.write(StratumParser.serialize(message));
      }
    } catch (err) {
      logger.error(`发送消息到矿池失败 (${miner.id}):`, err);
    }
  }

  /**
   * 断开矿机连接
   */
  private disconnectMiner(minerId: string, reason: string): void {
    const miner = this.miners.get(minerId);
    if (!miner) return;

    logger.info(`断开矿机 ${minerId}: ${reason}`);

    if (miner.poolSocket) {
      miner.poolSocket.destroy();
    }
    if (miner.socket) {
      miner.socket.destroy();
    }

    this.miners.delete(minerId);
    this.emit('minerDisconnected', miner, reason);
  }

  /**
   * 清理不活跃的连接
   */
  private cleanupInactiveConnections(): void {
    const now = Date.now();
    const timeout = 600000; // 10分钟无活动

    for (const [id, miner] of this.miners) {
      if (now - miner.lastActivity.getTime() > timeout) {
        logger.warn(`清理不活跃连接: ${id}`);
        this.disconnectMiner(id, '不活跃超时');
      }
    }
  }

  /**
   * 获取所有矿机信息
   */
  public getMiners(): MinerConnection[] {
    return Array.from(this.miners.values());
  }

  /**
   * 获取统计信息
   */
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

