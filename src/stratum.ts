/**
 * Stratum协议处理器
 * 支持Stratum V1协议（最常用的挖矿协议）
 */

export interface StratumMessage {
  id: number | null;
  method?: string;
  params?: unknown[];
  result?: unknown;
  error?: unknown;
}

export interface StratumJob {
  jobId: string;
  prevHash: string;
  coinbase1: string;
  coinbase2: string;
  merkleBranches: string[];
  version: string;
  nbits: string;
  ntime: string;
  cleanJobs: boolean;
}

export interface MinerInfo {
  address: string;
  worker: string;
  password: string;
  extranonce1?: string;
  extranonce2Size?: number;
}

export class StratumParser {
  private buffer: string = '';

  /**
   * 解析Stratum消息
   */
  public parse(data: Buffer): StratumMessage[] {
    this.buffer += data.toString();
    const messages: StratumMessage[] = [];
    
    let newlineIndex: number;
    while ((newlineIndex = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.substring(0, newlineIndex).trim();
      this.buffer = this.buffer.substring(newlineIndex + 1);
      
      if (line.length > 0) {
        try {
          const message = JSON.parse(line) as StratumMessage;
          messages.push(message);
        } catch (e) {
          // 忽略无效的JSON消息
          console.error('Invalid Stratum message:', line);
        }
      }
    }
    
    return messages;
  }

  /**
   * 序列化Stratum消息
   */
  public static serialize(message: StratumMessage): string {
    return JSON.stringify(message) + '\n';
  }

  /**
   * 创建订阅请求
   */
  public static createSubscribe(userAgent: string = 'mining-proxy/1.0'): StratumMessage {
    return {
      id: 1,
      method: 'mining.subscribe',
      params: [userAgent]
    };
  }

  /**
   * 创建授权请求
   */
  public static createAuthorize(address: string, worker: string, password: string = 'x'): StratumMessage {
    return {
      id: 2,
      method: 'mining.authorize',
      params: [`${address}.${worker}`, password]
    };
  }

  /**
   * 创建提交份额请求
   */
  public static createSubmit(
    worker: string,
    jobId: string,
    extranonce2: string,
    ntime: string,
    nonce: string
  ): StratumMessage {
    return {
      id: Math.floor(Math.random() * 1000000),
      method: 'mining.submit',
      params: [worker, jobId, extranonce2, ntime, nonce]
    };
  }

  /**
   * 创建设置难度通知
   */
  public static createSetDifficulty(difficulty: number): StratumMessage {
    return {
      id: null,
      method: 'mining.set_difficulty',
      params: [difficulty]
    };
  }

  /**
   * 创建新任务通知
   */
  public static createNotify(job: StratumJob): StratumMessage {
    return {
      id: null,
      method: 'mining.notify',
      params: [
        job.jobId,
        job.prevHash,
        job.coinbase1,
        job.coinbase2,
        job.merkleBranches,
        job.version,
        job.nbits,
        job.ntime,
        job.cleanJobs
      ]
    };
  }

  /**
   * 创建成功响应
   */
  public static createResponse(id: number, result: unknown = true): StratumMessage {
    return {
      id,
      result,
      error: null
    };
  }

  /**
   * 创建错误响应
   */
  public static createError(id: number, code: number, message: string): StratumMessage {
    return {
      id,
      result: null,
      error: [code, message, null]
    };
  }

  /**
   * 解析授权消息中的矿工信息
   */
  public static parseAuthorize(message: StratumMessage): MinerInfo | null {
    if (message.method !== 'mining.authorize' || !message.params) {
      return null;
    }

    const [fullWorker, password] = message.params as string[];
    if (!fullWorker) return null;

    // 格式: address.worker 或 address
    const parts = fullWorker.split('.');
    const address = parts[0];
    const worker = parts.slice(1).join('.') || 'default';

    return {
      address,
      worker,
      password: password || 'x'
    };
  }

  /**
   * 解析订阅响应
   */
  public static parseSubscribeResponse(message: StratumMessage): { extranonce1: string; extranonce2Size: number } | null {
    if (!message.result || !Array.isArray(message.result)) {
      return null;
    }

    const result = message.result as unknown[];
    // 订阅响应格式: [[["mining.set_difficulty", "..."], ["mining.notify", "..."]], extranonce1, extranonce2_size]
    if (result.length >= 3) {
      return {
        extranonce1: result[1] as string,
        extranonce2Size: result[2] as number
      };
    }

    return null;
  }

  /**
   * 清空缓冲区
   */
  public clear(): void {
    this.buffer = '';
  }
}

export default StratumParser;

