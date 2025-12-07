/**
 * Aleo Stratum 协议处理器
 * Aleo 使用 Stratum 协议变体，主要区别在于任务和提交格式
 * 
 * 矿池地址示例：stratum+tcp://aleo.f2pool.com:4400
 */

import { StratumMessage, StratumParser, MinerInfo } from '../stratum';

/**
 * Aleo 任务结构
 */
export interface AleoJob {
  jobId: string;
  epochChallenge: string;    // Aleo 特有的 epoch_challenge
  address: string;
  blockHeight: number;
  difficulty: number;
  timestamp: number;
}

/**
 * Aleo Stratum 解决方案结构
 */
export interface AleoStratumSolution {
  jobId: string;
  nonce: string;
  commitment: string;
  proof: string;
}

/**
 * Aleo Stratum 协议扩展
 */
export class AleoStratumParser extends StratumParser {
  
  /**
   * 创建 Aleo 订阅请求
   */
  public static createAleoSubscribe(userAgent: string = 'mining-proxy/1.0'): StratumMessage {
    return {
      id: 1,
      method: 'mining.subscribe',
      params: [userAgent, null, 'aleo']  // 添加 aleo 标识
    };
  }

  /**
   * 创建 Aleo 授权请求
   * Aleo 地址格式: aleo1xxxxxxxxx...
   */
  public static createAleoAuthorize(address: string, worker: string = 'default', password: string = 'x'): StratumMessage {
    // 验证 Aleo 地址格式
    if (!AleoStratumParser.isValidAleoAddress(address)) {
      console.warn(`警告: Aleo 地址格式可能不正确: ${address}`);
    }
    
    return {
      id: 2,
      method: 'mining.authorize',
      params: [`${address}.${worker}`, password]
    };
  }

  /**
   * 创建 Aleo 解决方案提交
   */
  public static createAleoSubmit(
    worker: string,
    jobId: string,
    nonce: string,
    commitment?: string,
    proof?: string
  ): StratumMessage {
    const params: unknown[] = [worker, jobId, nonce];
    
    // 某些矿池需要额外参数
    if (commitment) params.push(commitment);
    if (proof) params.push(proof);
    
    return {
      id: Math.floor(Math.random() * 1000000),
      method: 'mining.submit',
      params
    };
  }

  /**
   * 解析 Aleo 任务通知
   * Aleo 的 mining.notify 格式与标准 Stratum 略有不同
   */
  public static parseAleoNotify(message: StratumMessage): AleoJob | null {
    if (message.method !== 'mining.notify' || !message.params) {
      return null;
    }

    const params = message.params as unknown[];
    if (params.length < 2) return null;

    // Aleo 任务格式可能因矿池而异
    // F2Pool 格式: [job_id, epoch_challenge, address, block_height, difficulty, timestamp]
    return {
      jobId: String(params[0]),
      epochChallenge: String(params[1] || ''),
      address: String(params[2] || ''),
      blockHeight: Number(params[3] || 0),
      difficulty: Number(params[4] || 1),
      timestamp: Number(params[5] || Date.now() / 1000)
    };
  }

  /**
   * 验证 Aleo 地址格式
   * Aleo 地址以 'aleo1' 开头，总长度 63 字符
   */
  public static isValidAleoAddress(address: string): boolean {
    return /^aleo1[a-z0-9]{58}$/.test(address);
  }

  /**
   * 解析 Aleo 矿工信息
   */
  public static parseAleoMinerInfo(message: StratumMessage): MinerInfo | null {
    const minerInfo = StratumParser.parseAuthorize(message);
    if (!minerInfo) return null;

    // 验证是否为 Aleo 地址
    if (!AleoStratumParser.isValidAleoAddress(minerInfo.address)) {
      console.warn(`非标准 Aleo 地址: ${minerInfo.address}`);
    }

    return minerInfo;
  }

  /**
   * 判断是否为 Aleo 相关消息
   */
  public static isAleoMessage(message: StratumMessage): boolean {
    // 检查消息中是否包含 Aleo 特征
    if (message.params && Array.isArray(message.params)) {
      const params = message.params as string[];
      
      // 检查是否包含 aleo 地址
      for (const param of params) {
        if (typeof param === 'string' && param.startsWith('aleo1')) {
          return true;
        }
      }
      
      // 检查是否有 aleo 标识
      if (params.includes('aleo')) {
        return true;
      }
    }
    
    return false;
  }
}

export default AleoStratumParser;

