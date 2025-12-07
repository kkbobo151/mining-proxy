import * as winston from 'winston';
import * as path from 'path';
import * as fs from 'fs';
import { configManager } from './config';

const config = configManager.get();

// 确保日志目录存在
const logDir = path.dirname(path.resolve(process.cwd(), config.logging.file));
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// 自定义日志格式
const customFormat = winston.format.printf(({ level, message, timestamp, ...meta }) => {
  const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : '';
  return `${timestamp} [${level.toUpperCase()}] ${message} ${metaStr}`;
});

// 创建logger实例
const logger = winston.createLogger({
  level: config.logging.level,
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    customFormat
  ),
  transports: [
    // 控制台输出
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        customFormat
      )
    }),
    // 文件输出
    new winston.transports.File({
      filename: path.resolve(process.cwd(), config.logging.file),
      maxsize: parseSize(config.logging.maxSize),
      maxFiles: config.logging.maxFiles,
    })
  ]
});

function parseSize(size: string): number {
  const units: { [key: string]: number } = {
    'k': 1024,
    'm': 1024 * 1024,
    'g': 1024 * 1024 * 1024
  };
  const match = size.toLowerCase().match(/^(\d+)([kmg])?$/);
  if (!match) return 10 * 1024 * 1024; // 默认10MB
  const num = parseInt(match[1]);
  const unit = match[2] || 'm';
  return num * (units[unit] || 1024 * 1024);
}

export default logger;

