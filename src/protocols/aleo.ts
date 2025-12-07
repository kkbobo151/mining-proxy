/**
 * Aleo 挖矿协议处理器
 * 支持 Aleo PoSW (Proof of Succinct Work) 挖矿协议
 * 
 * Aleo 矿池通常使用 JSON-RPC 格式的消息
 */

export interface AleoMessage {
  id: number | string | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: AleoError | null;
}

export interface AleoError {
  code: number;
  message: string;
}

export interface AleoPuzzle {
  epoch_number: number;
  epoch_challenge: string;
  address: string;
  current_difficulty: number;
  timestamp: number;
}

export interface AleoSolution {
  epoch_number: number;
  address: string;
  counter: string;
  solution: string;
}

export interface AleoMinerInfo {
  address: string;
  worker: string;
  version?: string;
}

// Aleo 协议方法
export enum AleoMethod {
  // 客户端 -> 服务器
  AUTHORIZE = 'authorize',
  SUBSCRIBE = 'subscribe', 
  SUBMIT = 'submit',
  
  // 服务器 -> 客户端
  NOTIFY = 'notify',
  SET_TARGET = 'set_target',
  SET_DIFFICULTY = 'set_difficulty',
}

export class AleoParser {
  private buffer: string = '';

  /**
   * 解析 Aleo 消息
   */
  public parse(data: Buffer): AleoMessage[] {
    this.buffer += data.toString();
    const messages: AleoMessage[] = [];
    
    let newlineIndex: number;
    while ((newlineIndex = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.substring(0, newlineIndex).trim();
      this.buffer = this.buffer.substring(newlineIndex + 1);
      
      if (line.length > 0) {
        try {
          const message = JSON.parse(line) as AleoMessage;
          messages.push(message);
        } catch (e) {
          console.error('Invalid Aleo message:', line);
        }
      }
    }
    
    return messages;
  }

  /**
   * 序列化 Aleo 消息
   */
  public static serialize(message: AleoMessage): string {
    return JSON.stringify(message) + '\n';
  }

  /**
   * 创建订阅请求
   */
  public static createSubscribe(userAgent: string = 'mining-proxy/1.0', version: string = '1.0'): AleoMessage {
    return {
      id: 1,
      method: AleoMethod.SUBSCRIBE,
      params: {
        user_agent: userAgent,
        protocol_version: version
      }
    };
  }

  /**
   * 创建授权请求
   */
  public static createAuthorize(address: string, worker: string = 'default'): AleoMessage {
    return {
      id: 2,
      method: AleoMethod.AUTHORIZE,
      params: {
        address: address,
        worker: worker
      }
    };
  }

  /**
   * 创建提交解决方案请求
   */
  public static createSubmit(solution: AleoSolution): AleoMessage {
    return {
      id: Math.floor(Math.random() * 1000000),
      method: AleoMethod.SUBMIT,
      params: solution
    };
  }

  /**
   * 创建通知消息 (服务器端)
   */
  public static createNotify(puzzle: AleoPuzzle): AleoMessage {
    return {
      id: null,
      method: AleoMethod.NOTIFY,
      params: puzzle
    };
  }

  /**
   * 创建设置难度消息
   */
  public static createSetDifficulty(difficulty: number): AleoMessage {
    return {
      id: null,
      method: AleoMethod.SET_DIFFICULTY,
      params: { difficulty }
    };
  }

  /**
   * 创建设置目标消息
   */
  public static createSetTarget(target: string): AleoMessage {
    return {
      id: null,
      method: AleoMethod.SET_TARGET,
      params: { target }
    };
  }

  /**
   * 创建成功响应
   */
  public static createResponse(id: number | string, result: unknown = true): AleoMessage {
    return {
      id,
      result,
      error: null
    };
  }

  /**
   * 创建错误响应
   */
  public static createError(id: number | string, code: number, message: string): AleoMessage {
    return {
      id,
      result: null,
      error: { code, message }
    };
  }

  /**
   * 解析授权消息
   */
  public static parseAuthorize(message: AleoMessage): AleoMinerInfo | null {
    if (message.method !== AleoMethod.AUTHORIZE || !message.params) {
      return null;
    }

    const params = message.params as { address?: string; worker?: string };
    if (!params.address) return null;

    return {
      address: params.address,
      worker: params.worker || 'default'
    };
  }

  /**
   * 解析 Puzzle 通知
   */
  public static parsePuzzle(message: AleoMessage): AleoPuzzle | null {
    if (message.method !== AleoMethod.NOTIFY || !message.params) {
      return null;
    }

    const params = message.params as AleoPuzzle;
    if (!params.epoch_challenge) return null;

    return params;
  }

  /**
   * 验证 Aleo 地址格式
   */
  public static isValidAddress(address: string): boolean {
    // Aleo 地址以 'aleo1' 开头，长度为 63 字符
    return /^aleo1[a-z0-9]{58}$/.test(address);
  }

  /**
   * 清空缓冲区
   */
  public clear(): void {
    this.buffer = '';
  }
}

export default AleoParser;

