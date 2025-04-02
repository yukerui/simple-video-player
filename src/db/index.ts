import { DatabaseAdapter } from './adapters/base.js';
import { SQLAdapter } from './adapters/sql-adapter.js';
import { PgAdapter, PgAdapterOptions } from './adapters/pg-adapter.js';
import { KVAdapter } from './adapters/kv-adapter.js';

/**
 * 数据库配置接口
 */
export interface DatabaseConfig {
  /**
   * SQL 数据库连接字符串
   */
  sqlDsn?: string;
  
  /**
   * PostgreSQL 配置
   */
  pgConfig?: {
    connection: string | Record<string, unknown>;
    tableName?: string;
  };
  
  /**
   * Cloudflare KV Namespace
   */
  kvNamespace?: any;
}

/**
 * 统一数据库操作类
 * 按优先级使用不同的数据库适配器:
 * 1. SQL_DSN (通过 MySQL 连接)
 * 2. PostgreSQL (如：Neon 或 Supabase)
 * 3. Cloudflare KV
 */
export class Database {
  private static instance: Database;
  private adapter: DatabaseAdapter | null = null;
  private initialized = false;
  
  /**
   * 私有构造函数，防止直接实例化
   */
  private constructor() {}
  
  /**
   * 获取单例实例
   */
  public static getInstance(): Database {
    if (!Database.instance) {
      Database.instance = new Database();
    }
    return Database.instance;
  }
  
  /**
   * 初始化数据库
   * 按优先级选择适当的适配器
   */
  public async initialize(config: DatabaseConfig): Promise<boolean> {
    if (this.initialized && this.adapter) return true;
    
    // 关闭已有连接
    if (this.adapter) {
      await this.adapter.close();
      this.adapter = null;
    }
    
    try {
      // 优先级 1: SQL_DSN
      if (config.sqlDsn) {
        console.log('使用 SQL 数据库适配器');
        this.adapter = new SQLAdapter(config.sqlDsn);
        if (await this.adapter.initialize()) {
          this.initialized = true;
          return true;
        } else {
          // 初始化失败，尝试下一个适配器
          this.adapter = null;
        }
      }
      
      // 优先级 2: PostgreSQL (Neon 或 Supabase)
      if (!this.adapter && config.pgConfig && config.pgConfig.connection) {
        console.log('使用 PostgreSQL 数据库适配器');
        const options: PgAdapterOptions = {
          connection: config.pgConfig.connection,
          tableName: config.pgConfig.tableName
        };
        
        this.adapter = new PgAdapter(options);
        if (await this.adapter.initialize()) {
          this.initialized = true;
          return true;
        } else {
          // 初始化失败，尝试下一个适配器
          this.adapter = null;
        }
      }
      
      // 优先级 3: Cloudflare KV
      if (!this.adapter && config.kvNamespace) {
        console.log('使用 Cloudflare KV 数据库适配器');
        this.adapter = new KVAdapter(config.kvNamespace);

        if (await this.adapter.initialize()) {
          this.initialized = true;
          return true;
        } else {
          // 初始化失败
          this.adapter = null;
        }
      }
      
      if (!this.adapter) {
        console.error('无法初始化任何数据库适配器');
        return false;
      }
      
      return true;
    } catch (error) {
      console.error('初始化数据库失败:', error);
      this.adapter = null;
      this.initialized = false;
      return false;
    }
  }
  
  /**
   * 获取当前使用的适配器
   */
  public getAdapter(): DatabaseAdapter | null {
    return this.adapter;
  }
  
  /**
   * 获取一个值
   * @param key 键名
   */
  public async get<T>(key: string): Promise<T | null> {
    if (!this.adapter) {
      throw new Error('数据库未初始化');
    }
    return await this.adapter.get<T>(key);
  }
  
  /**
   * 设置一个值
   * @param key 键名
   * @param value 值
   */
  public async set<T>(key: string, value: T): Promise<boolean> {
    if (!this.adapter) {
      throw new Error('数据库未初始化');
    }
    return await this.adapter.set<T>(key, value);
  }
  
  /**
   * 删除一个值
   * @param key 键名
   */
  public async delete(key: string): Promise<boolean> {
    if (!this.adapter) {
      throw new Error('数据库未初始化');
    }
    return await this.adapter.delete(key);
  }
  
  /**
   * 列出所有键
   */
  public async list(): Promise<string[]> {
    if (!this.adapter) {
      throw new Error('数据库未初始化');
    }
    return await this.adapter.list();
  }
  
  /**
   * 查询数据
   * @param query SQL查询语句
   * @param params 查询参数
   */
  public async query<T>(query: string, params: any[] = []): Promise<T[]> {
    if (!this.adapter) {
      throw new Error('数据库未初始化');
    }
    return await this.adapter.query<T>(query, params);
  }
  
  /**
   * 执行事务
   * @param callback 事务回调函数
   */
  public async transaction<T>(callback: (db: DatabaseAdapter) => Promise<T>): Promise<T> {
    if (!this.adapter) {
      throw new Error('数据库未初始化');
    }
    return await this.adapter.transaction<T>(callback);
  }
  
  /**
   * 关闭数据库连接
   */
  public async close(): Promise<void> {
    if (this.adapter) {
      await this.adapter.close();
      this.adapter = null;
      this.initialized = false;
    }
  }
}

// 导出默认实例
export const db = Database.getInstance();

// 辅助函数：从环境变量初始化数据库
export async function initDatabaseFromEnv(env?: any): Promise<boolean> {
  const config: DatabaseConfig = {};
  
  // 检查 Node.js 环境变量或传入的 env 对象
  const isCloudflare = typeof process === 'undefined' || env;
  
  if (isCloudflare && env) {
    // Cloudflare 环境
    if (env.SQL_DSN) {
      config.sqlDsn = env.SQL_DSN;
    }
    
    // 使用 PostgreSQL 连接
    if (env.PG_CONNECTION_STRING) {
      config.pgConfig = {
        connection: env.PG_CONNECTION_STRING,
        tableName: env.PG_TABLE_NAME || 'configs'
      };
    }
    
    // 支持Cloudflare KV 命名空间
    if (env.VIDEO_CONFIG) {  // 直接使用绑定名称
      config.kvNamespace = env.VIDEO_CONFIG;
    }
  } else {
    // Node.js 环境
    if (process.env.SQL_DSN) {
      config.sqlDsn = process.env.SQL_DSN;
    }
    
    // 使用 PostgreSQL 连接
    if (process.env.PG_CONNECTION_STRING) {
      config.pgConfig = {
        connection: process.env.PG_CONNECTION_STRING,
        tableName: process.env.PG_TABLE_NAME || 'configs'
      };
    }
  }
  
  return await db.initialize(config);
} 
