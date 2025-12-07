/**
 * 连接池管理模块
 * 管理与上游矿池的连接复用和负载均衡
 */

import * as net from 'net';
import { EventEmitter } from 'events';
import { StratumParser, StratumMessage } from './stratum';
import { PoolConfig, configManager } from './config';
import logger from './logger';

export interface PoolConnection {
  id: string;
  pool: PoolConfig;
  socket: net.Socket;
  parser: StratumParser;
  isConnected: boolean;
  isSubscribed: boolean;
  extranonce1: string;
  extranonce2Size: number;
  difficulty: number;
  currentJob: StratumMessage | null;
  connectTime: Date;
  lastActivity: Date;
  reconnectAttempts: number;
  subscribers: Set<string>;
}

export class ConnectionPool extends EventEmitter {
  private connections: Map<string, PoolConnection> = new Map();
  private connectionIdCounter: number = 0;
  private maxReconnectAttempts: number = 10;
  private reconnectDelay: number = 5000;

  constructor() {
    super();
  }

  /**
   * 获取或创建到矿池的连接
   */
  public async getConnection(pool: PoolConfig): Promise<PoolConnection | null> {
    // 查找现有的可用连接
    for (const [id, conn] of this.connections) {
      if (conn.pool.host === pool.host && 
          conn.pool.port === pool.port && 
          conn.isConnected) {
        return conn;
      }
    }

    // 创建新连接
    return this.createConnection(pool);
  }

  /**
   * 创建新的矿池连接
   */
  private createConnection(pool: PoolConfig): Promise<PoolConnection | null> {
    return new Promise((resolve) => {
      const id = `pool_${++this.connectionIdCounter}`;
      
      logger.info(`创建矿池连接 ${id}: ${pool.name} (${pool.host}:${pool.port})`);

      const socket = net.createConnection({
        host: pool.host,
        port: pool.port
      });

      const connection: PoolConnection = {
        id,
        pool,
        socket,
        parser: new StratumParser(),
        isConnected: false,
        isSubscribed: false,
        extranonce1: '',
        extranonce2Size: 4,
        difficulty: 1,
        currentJob: null,
        connectTime: new Date(),
        lastActivity: new Date(),
        reconnectAttempts: 0,
        subscribers: new Set()
      };

      socket.on('connect', () => {
        logger.info(`矿池连接 ${id} 已建立`);
        connection.isConnected = true;
        connection.reconnectAttempts = 0;
        this.connections.set(id, connection);
        this.emit('connected', connection);
        resolve(connection);
      });

      socket.on('data', (data) => {
        connection.lastActivity = new Date();
        const messages = connection.parser.parse(data);
        for (const message of messages) {
          this.handlePoolMessage(connection, message);
        }
      });

      socket.on('error', (err) => {
        logger.error(`矿池连接 ${id} 错误:`, err.message);
        this.handleDisconnect(connection);
        if (!connection.isConnected) {
          resolve(null);
        }
      });

      socket.on('close', () => {
        logger.warn(`矿池连接 ${id} 关闭`);
        this.handleDisconnect(connection);
      });

      socket.setTimeout(120000); // 2分钟超时
      socket.on('timeout', () => {
        logger.warn(`矿池连接 ${id} 超时`);
        socket.destroy();
      });
    });
  }

  /**
   * 处理矿池消息
   */
  private handlePoolMessage(connection: PoolConnection, message: StratumMessage): void {
    logger.debug(`矿池 ${connection.id} 消息:`, message);

    // 处理订阅响应
    if (message.id === 1 && message.result) {
      const result = StratumParser.parseSubscribeResponse(message);
      if (result) {
        connection.extranonce1 = result.extranonce1;
        connection.extranonce2Size = result.extranonce2Size;
        connection.isSubscribed = true;
        logger.info(`矿池 ${connection.id} 订阅成功 - extranonce1: ${result.extranonce1}`);
      }
    }

    // 处理难度设置
    if (message.method === 'mining.set_difficulty') {
      const difficulty = (message.params as number[])[0];
      connection.difficulty = difficulty;
      logger.debug(`矿池 ${connection.id} 难度: ${difficulty}`);
    }

    // 处理新任务
    if (message.method === 'mining.notify') {
      connection.currentJob = message;
    }

    this.emit('message', connection, message);
  }

  /**
   * 处理连接断开
   */
  private handleDisconnect(connection: PoolConnection): void {
    connection.isConnected = false;
    connection.isSubscribed = false;
    this.emit('disconnected', connection);

    // 尝试重连
    if (connection.reconnectAttempts < this.maxReconnectAttempts) {
      connection.reconnectAttempts++;
      const delay = this.reconnectDelay * connection.reconnectAttempts;
      
      logger.info(`矿池 ${connection.id} 将在 ${delay/1000}秒后重连 (尝试 ${connection.reconnectAttempts}/${this.maxReconnectAttempts})`);
      
      setTimeout(() => {
        this.reconnect(connection);
      }, delay);
    } else {
      logger.error(`矿池 ${connection.id} 重连次数超限，放弃重连`);
      this.connections.delete(connection.id);
    }
  }

  /**
   * 重新连接
   */
  private async reconnect(connection: PoolConnection): Promise<void> {
    if (connection.socket) {
      connection.socket.destroy();
    }

    const newSocket = net.createConnection({
      host: connection.pool.host,
      port: connection.pool.port
    });

    connection.socket = newSocket;
    connection.parser = new StratumParser();

    newSocket.on('connect', () => {
      logger.info(`矿池 ${connection.id} 重连成功`);
      connection.isConnected = true;
      connection.reconnectAttempts = 0;
      this.emit('reconnected', connection);

      // 重新订阅
      const subscribeMsg = StratumParser.createSubscribe('mining-proxy/1.0');
      this.send(connection, subscribeMsg);
    });

    newSocket.on('data', (data) => {
      connection.lastActivity = new Date();
      const messages = connection.parser.parse(data);
      for (const message of messages) {
        this.handlePoolMessage(connection, message);
      }
    });

    newSocket.on('error', (err) => {
      logger.error(`矿池 ${connection.id} 重连错误:`, err.message);
      this.handleDisconnect(connection);
    });

    newSocket.on('close', () => {
      logger.warn(`矿池 ${connection.id} 连接关闭`);
      this.handleDisconnect(connection);
    });
  }

  /**
   * 发送消息到矿池
   */
  public send(connection: PoolConnection, message: StratumMessage): boolean {
    try {
      if (connection.socket && !connection.socket.destroyed && connection.isConnected) {
        connection.socket.write(StratumParser.serialize(message));
        return true;
      }
      return false;
    } catch (err) {
      logger.error(`发送消息到矿池 ${connection.id} 失败:`, err);
      return false;
    }
  }

  /**
   * 关闭指定连接
   */
  public closeConnection(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (connection) {
      connection.reconnectAttempts = this.maxReconnectAttempts; // 阻止重连
      if (connection.socket) {
        connection.socket.destroy();
      }
      this.connections.delete(connectionId);
      logger.info(`矿池连接 ${connectionId} 已关闭`);
    }
  }

  /**
   * 关闭所有连接
   */
  public closeAll(): void {
    for (const [id, connection] of this.connections) {
      connection.reconnectAttempts = this.maxReconnectAttempts;
      if (connection.socket) {
        connection.socket.destroy();
      }
    }
    this.connections.clear();
    logger.info('所有矿池连接已关闭');
  }

  /**
   * 获取所有连接状态
   */
  public getConnections(): PoolConnection[] {
    return Array.from(this.connections.values());
  }

  /**
   * 获取活跃连接数
   */
  public getActiveCount(): number {
    return Array.from(this.connections.values()).filter(c => c.isConnected).length;
  }
}

export default ConnectionPool;

