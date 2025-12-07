/**
 * 算力计算模块
 * 计算实时算力、15分钟算力和24小时平均算力
 */

export interface ShareRecord {
  timestamp: number;
  difficulty: number;
  accepted: boolean;
}

export interface HashrateData {
  realtime: number;      // 实时算力 (M)
  avg15min: number;      // 15分钟平均算力 (M)
  avg24h: number;        // 24小时平均算力 (M)
  unit: string;          // 单位
}

export class HashrateCalculator {
  private shares: ShareRecord[] = [];
  private readonly MAX_HISTORY = 86400; // 保留24小时的记录（按秒计）
  private readonly REALTIME_WINDOW = 60;      // 实时算力窗口：60秒
  private readonly AVG_15MIN_WINDOW = 900;    // 15分钟窗口：900秒
  private readonly AVG_24H_WINDOW = 86400;    // 24小时窗口：86400秒

  /**
   * 添加份额记录
   */
  public addShare(difficulty: number, accepted: boolean): void {
    const now = Date.now();
    this.shares.push({
      timestamp: now,
      difficulty,
      accepted
    });

    // 清理过期记录（保留24小时）
    const cutoff = now - this.AVG_24H_WINDOW * 1000;
    this.shares = this.shares.filter(s => s.timestamp > cutoff);
  }

  /**
   * 计算指定时间窗口内的算力
   * 算力 = 总难度 / 时间窗口（秒）
   */
  private calculateHashrate(windowSeconds: number): number {
    const now = Date.now();
    const cutoff = now - windowSeconds * 1000;
    
    // 筛选时间窗口内的接受份额
    const windowShares = this.shares.filter(s => 
      s.timestamp > cutoff && s.accepted
    );

    if (windowShares.length === 0) {
      return 0;
    }

    // 计算总难度
    const totalDifficulty = windowShares.reduce((sum, s) => sum + s.difficulty, 0);
    
    // 计算实际时间跨度
    const firstShare = Math.min(...windowShares.map(s => s.timestamp));
    const actualWindow = Math.max((now - firstShare) / 1000, 1);
    
    // 算力 = 难度 / 时间（转换为 M/s）
    // Aleo 难度单位与算力单位的转换
    const hashrate = totalDifficulty / actualWindow;
    
    return hashrate;
  }

  /**
   * 获取所有算力数据
   */
  public getHashrate(): HashrateData {
    const realtime = this.calculateHashrate(this.REALTIME_WINDOW);
    const avg15min = this.calculateHashrate(this.AVG_15MIN_WINDOW);
    const avg24h = this.calculateHashrate(this.AVG_24H_WINDOW);

    return {
      realtime: this.formatHashrate(realtime),
      avg15min: this.formatHashrate(avg15min),
      avg24h: this.formatHashrate(avg24h),
      unit: 'M'
    };
  }

  /**
   * 格式化算力为 M 单位，保留2位小数
   */
  private formatHashrate(hashrate: number): number {
    // 转换为 M (百万)
    const inM = hashrate / 1000000;
    return Math.round(inM * 100) / 100;
  }

  /**
   * 获取份额统计
   */
  public getShareStats(): { total: number; accepted: number; rejected: number } {
    const accepted = this.shares.filter(s => s.accepted).length;
    const rejected = this.shares.filter(s => !s.accepted).length;
    return {
      total: this.shares.length,
      accepted,
      rejected
    };
  }

  /**
   * 清空记录
   */
  public clear(): void {
    this.shares = [];
  }
}

// 全局算力计算器实例
export const globalHashrateCalculator = new HashrateCalculator();

export default HashrateCalculator;

