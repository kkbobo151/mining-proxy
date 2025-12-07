import * as fs from 'fs';
import * as path from 'path';

// 协议类型
export type Protocol = 'stratum' | 'aleo';

// 币种类型
export type CoinType = 'btc' | 'eth' | 'etc' | 'ltc' | 'aleo' | 'other';

export interface PoolConfig {
  name: string;
  host: string;
  port: number;
  weight: number;
  enabled: boolean;
  protocol?: Protocol;  // 协议类型，默认 stratum
  coin?: CoinType;      // 币种类型
  ssl?: boolean;        // 是否使用 SSL
}

export interface ProxyConfig {
  host: string;
  port: number;
  maxConnections: number;
}

export interface WalletConfig {
  address: string;
  workerPrefix: string;
}

export interface FeeConfig {
  enabled: boolean;
  percent: number;
  wallet: string;
}

export interface LoggingConfig {
  level: string;
  file: string;
  maxSize: string;
  maxFiles: number;
}

export interface StatsConfig {
  enabled: boolean;
  interval: number;
  apiPort: number;
}

export interface Config {
  proxy: ProxyConfig;
  pools: PoolConfig[];
  wallet: WalletConfig;
  fees: FeeConfig;
  logging: LoggingConfig;
  stats: StatsConfig;
}

class ConfigManager {
  private config: Config;
  private configPath: string;

  constructor() {
    this.configPath = path.resolve(process.cwd(), 'config.json');
    this.config = this.loadConfig();
  }

  private loadConfig(): Config {
    try {
      const configFile = fs.readFileSync(this.configPath, 'utf-8');
      return JSON.parse(configFile);
    } catch (error) {
      console.error('无法加载配置文件:', error);
      process.exit(1);
    }
  }

  public get(): Config {
    return this.config;
  }

  public reload(): void {
    this.config = this.loadConfig();
  }

  public getActivePool(protocol?: Protocol): PoolConfig | undefined {
    let enabledPools = this.config.pools.filter(p => p.enabled);
    
    // 如果指定了协议，筛选对应协议的矿池
    if (protocol) {
      enabledPools = enabledPools.filter(p => 
        (p.protocol || 'stratum') === protocol
      );
    }
    
    if (enabledPools.length === 0) return undefined;
    
    // 按权重选择矿池
    const totalWeight = enabledPools.reduce((sum, p) => sum + p.weight, 0);
    if (totalWeight === 0) return enabledPools[0];
    
    let random = Math.random() * totalWeight;
    for (const pool of enabledPools) {
      random -= pool.weight;
      if (random <= 0) return pool;
    }
    return enabledPools[0];
  }

  /**
   * 获取指定协议的所有矿池
   */
  public getPoolsByProtocol(protocol: Protocol): PoolConfig[] {
    return this.config.pools.filter(p => 
      p.enabled && (p.protocol || 'stratum') === protocol
    );
  }

  /**
   * 获取 Aleo 矿池
   */
  public getAleoPools(): PoolConfig[] {
    return this.config.pools.filter(p => 
      p.enabled && (p.protocol === 'aleo' || p.coin === 'aleo')
    );
  }

  /**
   * 获取 Stratum 矿池
   */
  public getStratumPools(): PoolConfig[] {
    return this.config.pools.filter(p => 
      p.enabled && (!p.protocol || p.protocol === 'stratum')
    );
  }
}

export const configManager = new ConfigManager();
export default configManager;

