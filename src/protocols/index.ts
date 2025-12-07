/**
 * 协议模块索引
 * 导出所有支持的挖矿协议
 */

// Aleo 独立协议 (备用)
export { 
  AleoParser,
  AleoMessage,
  AleoError,
  AleoPuzzle,
  AleoMinerInfo,
  AleoMethod
} from './aleo';

// Aleo Stratum 协议 (主要使用)
export { 
  AleoStratumParser,
  AleoJob,
  AleoStratumSolution 
} from './aleoStratum';

// 协议类型枚举
export enum ProtocolType {
  STRATUM = 'stratum',
  ALEO = 'aleo',
}

// 支持的币种
export enum CoinType {
  // Stratum 协议币种
  BTC = 'btc',
  ETH = 'eth',
  ETC = 'etc',
  LTC = 'ltc',
  
  // Aleo 协议币种
  ALEO = 'aleo',
}

// 币种到协议的映射
export const CoinProtocolMap: Record<CoinType, ProtocolType> = {
  [CoinType.BTC]: ProtocolType.STRATUM,
  [CoinType.ETH]: ProtocolType.STRATUM,
  [CoinType.ETC]: ProtocolType.STRATUM,
  [CoinType.LTC]: ProtocolType.STRATUM,
  [CoinType.ALEO]: ProtocolType.ALEO,
};

// 获取币种使用的协议
export function getProtocolForCoin(coin: CoinType): ProtocolType {
  return CoinProtocolMap[coin] || ProtocolType.STRATUM;
}

