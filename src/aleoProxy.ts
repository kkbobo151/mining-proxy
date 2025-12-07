/**
 * Aleo 矿池代理服务器
 * 专门处理 Aleo PoSW 挖矿协议
 */

import * as net from 'net';
import { EventEmitter } from 'events';
import { AleoParser, AleoMessage, AleoMinerInfo, AleoPuzzle, AleoMethod } from './protocols/aleo';
import { configManager, PoolConfig } from './config';
import logger from './logger';

export interface AleoMinerConnection {
  id: string;
  socket: net.Socket;
  parser: AleoParser;
  minerInfo: AleoMinerInfo | null;
  poolSocket: net.Socket | null;
  poolParser: AleoParser | null;
  pool: PoolConfig | null;
  connectedAt: Date;
  lastActivity: Date;
  solutionsSubmitted: number;
  solutionsAccepted: number;
  solutionsRejected: number;
  currentDifficulty: number;
  currentPuzzle: AleoPuzzle | null;
  pendingRequests: Map<number | string, AleoMessage>;
  isAuthorized: boolean;
  isSubscribed: boolean;
}

export class AleoProxy extends EventEmitter {
  private server: net.Server;
  private miners: Map<string, AleoMinerConnection> = new Map();
  private connectionId: number = 0;
  private config = configManager.get();

  constructor() {
    super();
    this.server = net.createServer(this.handleMinerConnection.bind(this));
  }

  /**
   * 启动 Aleo 代理服务器
   */
  public start(port?: number, host?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const listenPort = port || this.config.proxy.port;
      const listenHost = host || this.config.proxy.host;
      
      this.server.maxConnections = this.config.proxy.maxConnections;
      
      this.server.listen(listenPort, listenHost, () => {
        logger.info(`Aleo 代理服务器已启动 - 监听 ${listenHost}:${listenPort}`);
        resolve();
      });

      this.server.on('error', (err) => {
        logger.error('Aleo 服务器错误:', err);
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
      for (const [id] of this.miners) {
        this.disconnectMiner(id, '服务器关闭');
      }

      this.server.close(() => {
        logger.info('Aleo 代理服务器已停止');
        resolve();
      });
    });
  }

  /**
   * 处理新的矿机连接
   */
  private handleMinerConnection(socket: net.Socket): void {
    const id = `aleo_miner_${++this.connectionId}`;
    const remoteAddress = `${socket.remoteAddress}:${socket.remotePort}`;
    
    logger.info(`Aleo 新矿机连接: ${id} 来自 ${remoteAddress}`);

    const miner: AleoMinerConnection = {
      id,
      socket,
      parser: new AleoParser(),
      minerInfo: null,
      poolSocket: null,
      poolParser: null,
      pool: null,
      connectedAt: new Date(),
      lastActivity: new Date(),
      solutionsSubmitted: 0,
      solutionsAccepted: 0,
      solutionsRejected: 0,
      currentDifficulty: 0,
      currentPuzzle: null,
      pendingRequests: new Map(),
      isAuthorized: false,
      isSubscribed: false
    };

    this.miners.set(id, miner);
    this.emit('minerConnected', miner);

    socket.on('data', (data) => this.handleMinerData(id, data));
    socket.on('error', (err) => {
      logger.error(`Aleo 矿机 ${id} 连接错误:`, err.message);
      this.disconnectMiner(id, err.message);
    });
    socket.on('close', () => {
      logger.info(`Aleo 矿机 ${id} 断开连接`);
      this.disconnectMiner(id, '连接关闭');
    });
    socket.on('timeout', () => {
      logger.warn(`Aleo 矿机 ${id} 超时`);
      this.disconnectMiner(id, '超时');
    });

    socket.setTimeout(300000);
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
  private async handleMinerMessage(miner: AleoMinerConnection, message: AleoMessage): Promise<void> {
    logger.debug(`Aleo 矿机 ${miner.id} 消息:`, message);

    switch (message.method) {
      case AleoMethod.SUBSCRIBE:
        await this.handleSubscribe(miner, message);
        break;

      case AleoMethod.AUTHORIZE:
        await this.handleAuthorize(miner, message);
        break;

      case AleoMethod.SUBMIT:
        await this.handleSubmit(miner, message);
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
  private async handleSubscribe(miner: AleoMinerConnection, message: AleoMessage): Promise<void> {
    if (!miner.poolSocket) {
      const connected = await this.connectToPool(miner);
      if (!connected) {
        this.sendToMiner(miner, AleoParser.createError(
          message.id as number,
          20,
          '无法连接到 Aleo 矿池'
        ));
        return;
      }
    }

    miner.isSubscribed = true;
    miner.pendingRequests.set(message.id as number, message);
    
    // 转发订阅请求到矿池
    const subscribeMsg = AleoParser.createSubscribe('mining-proxy/1.0');
    subscribeMsg.id = message.id;
    this.sendToPool(miner, subscribeMsg);
  }

  /**
   * 处理矿机授权请求
   */
  private async handleAuthorize(miner: AleoMinerConnection, message: AleoMessage): Promise<void> {
    const minerInfo = AleoParser.parseAuthorize(message);
    if (!minerInfo) {
      this.sendToMiner(miner, AleoParser.createError(
        message.id as number,
        24,
        '无效的授权格式'
      ));
      return;
    }

    // 验证 Aleo 地址格式
    if (!AleoParser.isValidAddress(minerInfo.address)) {
      this.sendToMiner(miner, AleoParser.createError(
        message.id as number,
        25,
        '无效的 Aleo 地址格式'
      ));
      return;
    }

    miner.minerInfo = minerInfo;
    logger.info(`Aleo 矿机 ${miner.id} 授权: ${minerInfo.address}.${minerInfo.worker}`);

    if (!miner.poolSocket) {
      const connected = await this.connectToPool(miner);
      if (!connected) {
        this.sendToMiner(miner, AleoParser.createError(
          message.id as number,
          20,
          '无法连接到 Aleo 矿池'
        ));
        return;
      }
    }

    miner.pendingRequests.set(message.id as number, message);
    
    // 转发授权请求
    const authorizeMsg = AleoParser.createAuthorize(minerInfo.address, minerInfo.worker);
    authorizeMsg.id = message.id;
    this.sendToPool(miner, authorizeMsg);
  }

  /**
   * 处理解决方案提交
   */
  private async handleSubmit(miner: AleoMinerConnection, message: AleoMessage): Promise<void> {
    if (!miner.poolSocket || !miner.minerInfo) {
      this.sendToMiner(miner, AleoParser.createError(
        message.id as number,
        25,
        '未授权'
      ));
      return;
    }

    miner.solutionsSubmitted++;
    miner.lastActivity = new Date();

    logger.debug(`Aleo 矿机 ${miner.id} 提交解决方案`);

    // 转发到矿池
    miner.pendingRequests.set(message.id as number, message);
    this.sendToPool(miner, message);
  }

  /**
   * 连接到 Aleo 矿池
   */
  private connectToPool(miner: AleoMinerConnection): Promise<boolean> {
    return new Promise((resolve) => {
      // 筛选 Aleo 矿池
      const aleoPools = this.config.pools.filter(p => 
        p.enabled && (p.name.toLowerCase().includes('aleo') || p.host.includes('aleo'))
      );
      
      const pool = aleoPools[0] || configManager.getActivePool();
      if (!pool) {
        logger.error('没有可用的 Aleo 矿池');
        resolve(false);
        return;
      }

      logger.info(`Aleo 矿机 ${miner.id} 连接到矿池: ${pool.name} (${pool.host}:${pool.port})`);

      const poolSocket = net.createConnection({
        host: pool.host,
        port: pool.port
      });

      poolSocket.on('connect', () => {
        logger.info(`Aleo 矿机 ${miner.id} 成功连接到矿池 ${pool.name}`);
        miner.poolSocket = poolSocket;
        miner.poolParser = new AleoParser();
        miner.pool = pool;
        resolve(true);
      });

      poolSocket.on('data', (data) => this.handlePoolData(miner, data));

      poolSocket.on('error', (err) => {
        logger.error(`Aleo 矿机 ${miner.id} 矿池连接错误:`, err.message);
        this.handlePoolDisconnect(miner);
        resolve(false);
      });

      poolSocket.on('close', () => {
        logger.warn(`Aleo 矿机 ${miner.id} 矿池连接关闭`);
        this.handlePoolDisconnect(miner);
      });

      poolSocket.setTimeout(60000);
    });
  }

  /**
   * 处理矿池发送的数据
   */
  private handlePoolData(miner: AleoMinerConnection, data: Buffer): void {
    if (!miner.poolParser) return;

    const messages = miner.poolParser.parse(data);
    for (const message of messages) {
      this.handlePoolMessage(miner, message);
    }
  }

  /**
   * 处理矿池消息
   */
  private handlePoolMessage(miner: AleoMinerConnection, message: AleoMessage): void {
    logger.debug(`Aleo 矿池消息 (${miner.id}):`, message);

    // 处理响应消息
    if (message.id !== null && message.id !== undefined) {
      const pendingRequest = miner.pendingRequests.get(message.id);
      
      if (pendingRequest) {
        miner.pendingRequests.delete(message.id);

        // 处理授权响应
        if (pendingRequest.method === AleoMethod.AUTHORIZE) {
          if (message.result === true || message.result) {
            miner.isAuthorized = true;
            logger.info(`Aleo 矿机 ${miner.id} 授权成功`);
          } else {
            logger.warn(`Aleo 矿机 ${miner.id} 授权失败`);
          }
        }

        // 处理解决方案提交响应
        if (pendingRequest.method === AleoMethod.SUBMIT) {
          if (message.result === true || (message.result && !message.error)) {
            miner.solutionsAccepted++;
            logger.info(`Aleo 矿机 ${miner.id} 解决方案被接受`);
          } else {
            miner.solutionsRejected++;
            logger.warn(`Aleo 矿机 ${miner.id} 解决方案被拒绝`);
          }
        }
      }

      this.sendToMiner(miner, message);
      return;
    }

    // 处理通知消息
    switch (message.method) {
      case AleoMethod.SET_DIFFICULTY:
        const diffParams = message.params as { difficulty: number };
        if (diffParams?.difficulty) {
          miner.currentDifficulty = diffParams.difficulty;
          logger.debug(`Aleo 矿机 ${miner.id} 难度设置: ${diffParams.difficulty}`);
        }
        this.sendToMiner(miner, message);
        break;

      case AleoMethod.SET_TARGET:
        this.sendToMiner(miner, message);
        break;

      case AleoMethod.NOTIFY:
        const puzzle = AleoParser.parsePuzzle(message);
        if (puzzle) {
          miner.currentPuzzle = puzzle;
          logger.debug(`Aleo 矿机 ${miner.id} 收到新 Puzzle - Epoch: ${puzzle.epoch_number}`);
        }
        this.sendToMiner(miner, message);
        break;

      default:
        this.sendToMiner(miner, message);
    }
  }

  /**
   * 处理矿池断开连接
   */
  private handlePoolDisconnect(miner: AleoMinerConnection): void {
    if (miner.poolSocket) {
      miner.poolSocket.destroy();
      miner.poolSocket = null;
      miner.poolParser = null;
    }

    // 尝试重连
    if (this.miners.has(miner.id)) {
      logger.info(`Aleo 矿机 ${miner.id} 尝试重连矿池...`);
      setTimeout(async () => {
        if (this.miners.has(miner.id)) {
          const connected = await this.connectToPool(miner);
          if (connected && miner.minerInfo) {
            const subscribeMsg = AleoParser.createSubscribe('mining-proxy/1.0');
            this.sendToPool(miner, subscribeMsg);
          }
        }
      }, 5000);
    }
  }

  /**
   * 发送消息给矿机
   */
  private sendToMiner(miner: AleoMinerConnection, message: AleoMessage): void {
    try {
      if (miner.socket && !miner.socket.destroyed) {
        miner.socket.write(AleoParser.serialize(message));
      }
    } catch (err) {
      logger.error(`发送消息到 Aleo 矿机 ${miner.id} 失败:`, err);
    }
  }

  /**
   * 发送消息给矿池
   */
  private sendToPool(miner: AleoMinerConnection, message: AleoMessage): void {
    try {
      if (miner.poolSocket && !miner.poolSocket.destroyed) {
        miner.poolSocket.write(AleoParser.serialize(message));
      }
    } catch (err) {
      logger.error(`发送消息到 Aleo 矿池失败 (${miner.id}):`, err);
    }
  }

  /**
   * 断开矿机连接
   */
  private disconnectMiner(minerId: string, reason: string): void {
    const miner = this.miners.get(minerId);
    if (!miner) return;

    logger.info(`断开 Aleo 矿机 ${minerId}: ${reason}`);

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
    const timeout = 600000;

    for (const [id, miner] of this.miners) {
      if (now - miner.lastActivity.getTime() > timeout) {
        logger.warn(`清理不活跃 Aleo 连接: ${id}`);
        this.disconnectMiner(id, '不活跃超时');
      }
    }
  }

  /**
   * 获取所有矿机信息
   */
  public getMiners(): AleoMinerConnection[] {
    return Array.from(this.miners.values());
  }

  /**
   * 获取统计信息
   */
  public getStats(): object {
    const miners = this.getMiners();
    let totalSolutions = 0;
    let acceptedSolutions = 0;
    let rejectedSolutions = 0;

    for (const miner of miners) {
      totalSolutions += miner.solutionsSubmitted;
      acceptedSolutions += miner.solutionsAccepted;
      rejectedSolutions += miner.solutionsRejected;
    }

    return {
      protocol: 'aleo',
      activeMiners: miners.length,
      totalSolutions,
      acceptedSolutions,
      rejectedSolutions,
      acceptRate: totalSolutions > 0 ? ((acceptedSolutions / totalSolutions) * 100).toFixed(2) + '%' : '0%'
    };
  }
}

export default AleoProxy;

