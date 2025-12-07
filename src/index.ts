/**
 * 矿池中转代理系统 - 主程序入口
 * 
 * 功能特性:
 * - 支持 Stratum V1 协议 (BTC/ETH/ETC/LTC)
 * - 支持 Aleo PoSW 协议
 * - 多矿池负载均衡
 * - 可选抽水功能
 * - 实时统计 API
 * - 日志记录
 * - 优雅关闭
 */

import { MiningProxy } from './proxy';
import { StatsServer } from './stats';
import { configManager } from './config';
import { poolChecker } from './poolChecker';
import logger from './logger';

// 版本信息
const VERSION = '1.0.0';

async function main(): Promise<void> {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║                                                          ║
║     矿池中转代理系统 v${VERSION}                           ║
║     Mining Pool Proxy System                             ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
  `);

  const config = configManager.get();

  logger.info('========================================');
  logger.info(`矿池中转代理系统 v${VERSION} 启动中...`);
  logger.info('========================================');

  // 打印配置信息
  logger.info(`代理监听: ${config.proxy.host}:${config.proxy.port}`);
  logger.info(`最大连接数: ${config.proxy.maxConnections}`);
  logger.info(`抽水功能: ${config.fees.enabled ? `已启用 (${config.fees.percent}%)` : '已禁用'}`);
  logger.info(`统计API: ${config.stats.enabled ? `已启用 (端口 ${config.stats.apiPort})` : '已禁用'}`);
  
  // 打印矿池配置
  logger.info('配置的矿池:');
  for (const pool of config.pools) {
    const protocol = pool.protocol || 'stratum';
    const coin = pool.coin || '';
    logger.info(`  - ${pool.name}: ${pool.host}:${pool.port} [${pool.enabled ? '启用' : '禁用'}] 协议: ${protocol} ${coin ? `币种: ${coin}` : ''}`);
  }

  // 创建代理服务器 (支持 Stratum 和 Aleo)
  const proxy = new MiningProxy();
  
  // 检查是否有 Aleo 矿池配置
  const aleoPools = configManager.getAleoPools();
  const hasAleoPools = aleoPools.length > 0;
  
  if (hasAleoPools) {
    logger.info(`检测到 ${aleoPools.length} 个 Aleo 矿池配置`);
    for (const pool of aleoPools) {
      logger.info(`  - ${pool.name}: ${pool.host}:${pool.port}`);
    }
  }

  // 创建统计服务器
  const statsServer = new StatsServer();
  statsServer.setGetMinersFunction(() => proxy.getMiners());

  // 监听代理事件
  proxy.on('minerConnected', (miner) => {
    logger.info(`[事件] 矿机连接: ${miner.id}`);
  });

  proxy.on('minerDisconnected', (miner, reason) => {
    logger.info(`[事件] 矿机断开: ${miner.id} - ${reason}`);
  });

  // 优雅关闭处理
  const shutdown = async (signal: string) => {
    logger.info(`收到 ${signal} 信号，正在关闭...`);
    
    try {
      poolChecker.stop();
      await proxy.stop();
      await statsServer.stop();
      logger.info('服务已优雅关闭');
      process.exit(0);
    } catch (err) {
      logger.error('关闭时出错:', err);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // 未捕获异常处理
  process.on('uncaughtException', (err) => {
    logger.error('未捕获异常:', err);
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.error('未处理的Promise拒绝:', reason);
  });

  try {
    // 启动矿池健康检查
    poolChecker.start();
    
    // 启动代理服务 (统一处理 Stratum 和 Aleo)
    await proxy.start();
    await statsServer.start();

    logger.info('========================================');
    logger.info('代理服务器启动成功！');
    logger.info(`矿机连接地址: ${config.proxy.host === '0.0.0.0' ? '服务器IP' : config.proxy.host}:${config.proxy.port}`);
    if (hasAleoPools) {
      logger.info(`支持 Aleo 挖矿 - 使用 aleo1 地址自动识别`);
    }
    if (config.stats.enabled) {
      logger.info(`统计API: http://localhost:${config.stats.apiPort}/stats`);
      logger.info(`监控面板: http://localhost:${config.stats.apiPort}/dashboard`);
    }
    logger.info('========================================');

  } catch (err) {
    logger.error('启动失败:', err);
    process.exit(1);
  }
}

// 启动程序
main().catch((err) => {
  console.error('程序异常退出:', err);
  process.exit(1);
});

