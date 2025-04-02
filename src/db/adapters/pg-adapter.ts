import { DatabaseAdapter } from './base.js';
import postgres from 'postgres';
import type { Sql } from 'postgres';

/**
 * PostgreSQL 数据库适配器接口参数
 */
export interface PgAdapterOptions {
  /**
   * 数据库连接字符串或配置
   * - 连接字符串格式: 'postgres://user:password@host:port/database'
   * - 或者使用配置对象
   */
  connection: string | postgres.Options;
  
  /**
   * 表名
   */
  tableName?: string;
  
  /**
   * 额外连接选项
   */
  options?: {
    /**
     * 连接池最大连接数
     */
    max?: number;
    /**
     * 空闲连接超时时间（毫秒）
     */
    idleTimeoutMillis?: number;
    /**
     * 连接超时时间（毫秒）
     */
    connectionTimeoutMillis?: number;
  };
}

/**
 * PostgreSQL 数据库适配器
 * 实现基础数据库适配器接口，统一使用 PostgreSQL 原生连接来操作 Neon 和 Supabase 数据库
 */
export class PgAdapter implements DatabaseAdapter {
  private options: PgAdapterOptions;
  private initialized = false;
  private tableName: string;

  /**
   * 构造函数
   * @param options PostgreSQL 配置选项
   */
  constructor(options: PgAdapterOptions) {
    this.options = options;
    this.tableName = options.tableName || 'configs';
  }

  /**
   * 创建一个新的数据库连接
   * 在Cloudflare Workers环境中，每个请求应该使用独立的连接
   */
  private createConnection(): Sql {
    const connectionOptions = typeof this.options.connection === 'string' ? 
      this.options.connection as string : 
      this.options.connection as Record<string, unknown>;
    
    // 设置连接选项
    //const options = {
    //  max: 1, // 限制连接数为1
    //  idle_timeout: 2, // 快速关闭空闲连接
    //  connect_timeout: 5 // 连接超时5秒
    //};
    
    //return postgres(connectionOptions, options);
    return postgres(connectionOptions);
  }

  /**
   * 初始化数据库连接
   */
  public async initialize(): Promise<boolean> {
    if (this.initialized) return true;
    
    console.log(`开始初始化 PostgreSQL 数据库连接...`);
    
    try {
      // 创建临时连接来验证并创建表
      const sql = this.createConnection();
      
      // 检查连接
      console.log('检查 PostgreSQL 数据库连接...');
      const result = await sql`SELECT 1 as connected`;
      console.log('PostgreSQL 数据库连接成功!', result);

      // 创建表
      console.log(`尝试创建表 ${this.tableName}...`);
      await sql`
        CREATE TABLE IF NOT EXISTS ${sql(this.tableName)} (
          id TEXT PRIMARY KEY,
          config JSONB NOT NULL,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
      `;
      console.log(`表 ${this.tableName} 创建成功或已存在!`);
      
      // 关闭连接
      await sql.end();
      
      this.initialized = true;
      console.log('PostgreSQL 数据库连接初始化成功!');
      return true;
    } catch (error) {
      console.error('初始化 PostgreSQL 数据库连接失败:', error);
      return false;
    }
  }

  /**
   * 获取一个值
   * @param key 键名
   */
  public async get<T>(key: string): Promise<T | null> {
    if (!this.initialized && !(await this.initialize())) return null;
    
    const sql = this.createConnection();
    try {
      const result = await sql`
        SELECT config FROM ${sql(this.tableName)} WHERE id = ${key} LIMIT 1
      `;
      
      if (result.length === 0) return null;
      return result[0].config as T;
    } catch (error) {
      console.error(`获取 ${key} 失败:`, error);
      return null;
    } finally {
      // 确保关闭连接
      await sql.end();
    }
  }

  /**
   * 设置一个值
   * @param key 键名
   * @param value 值
   */
  public async set<T>(key: string, value: T): Promise<boolean> {
    if (!this.initialized && !(await this.initialize())) return false;
    
    const sql = this.createConnection();
    try {
      // 确保数据是对象形式
      let dataToStore: any = value;
      if (typeof value === 'string') {
        try {
          // 尝试解析字符串，看是否是有效的JSON
          const parsed = JSON.parse(value as string);
          dataToStore = parsed; // 如果是JSON字符串，使用解析后的对象
          console.log('检测到JSON字符串，已转换为对象');
        } catch (e) {
          // 如果解析失败，说明不是JSON字符串，保持原值
          console.log('非JSON字符串，保持原值');
        }
      }
      
      // 使用原始SQL查询，让postgresql自动处理对象到JSONB的转换
      const query = `
        INSERT INTO ${this.tableName} (id, config) 
        VALUES ($1, $2)
        ON CONFLICT (id) 
        DO UPDATE SET config = $2, updated_at = CURRENT_TIMESTAMP
      `;
      
      // 使用unsafe方法执行原始SQL，直接传递对象让pg驱动自己处理
      await sql.unsafe(query, [key, dataToStore]);
      
      return true;
    } catch (error) {
      console.error(`设置 ${key} 失败:`, error);
      return false;
    } finally {
      // 确保关闭连接
      await sql.end();
    }
  }

  /**
   * 删除一个值
   * @param key 键名
   */
  public async delete(key: string): Promise<boolean> {
    if (!this.initialized && !(await this.initialize())) return false;
    
    const sql = this.createConnection();
    try {
      await sql`
        DELETE FROM ${sql(this.tableName)} WHERE id = ${key}
      `;
      
      return true;
    } catch (error) {
      console.error(`删除 ${key} 失败:`, error);
      return false;
    } finally {
      // 确保关闭连接
      await sql.end();
    }
  }

  /**
   * 列出所有键
   */
  public async list(): Promise<string[]> {
    if (!this.initialized && !(await this.initialize())) return [];
    
    const sql = this.createConnection();
    try {
      const result = await sql`
        SELECT id FROM ${sql(this.tableName)}
      `;
      
      return result.map((row: any) => row.id as string);
    } catch (error) {
      console.error('列出所有键失败:', error);
      return [];
    } finally {
      // 确保关闭连接
      await sql.end();
    }
  }

  /**
   * 查询数据
   * @param query SQL查询语句
   * @param params 查询参数
   */
  public async query<T>(query: string, params: any[] = []): Promise<T[]> {
    if (!this.initialized && !(await this.initialize())) return [];
    
    const sql = this.createConnection();
    try {
      // postgres 库不直接支持原始SQL字符串和参数数组的方式
      // 这里我们使用 sql.unsafe 方法来执行原始SQL
      const result = await sql.unsafe(query, params);
      return result as unknown as T[];
    } catch (error) {
      console.error('查询失败:', error);
      return [];
    } finally {
      // 确保关闭连接
      await sql.end();
    }
  }

  /**
   * 执行事务
   * @param callback 事务回调函数
   */
  public async transaction<T>(callback: (adapter: DatabaseAdapter) => Promise<T>): Promise<T> {
    if (!this.initialized && !(await this.initialize())) {
      throw new Error('数据库未初始化');
    }
    
    const sql = this.createConnection();
    try {
      // postgres 库的事务API
      return await sql.begin(async (txSql: Sql<any>) => {
        // 创建一个临时适配器，使用当前事务的客户端
        const tempAdapter: DatabaseAdapter = {
          initialize: async () => true,
          get: async <U>(key: string): Promise<U | null> => {
            const result = await txSql`
              SELECT config FROM ${txSql(this.tableName)} WHERE id = ${key} LIMIT 1
            `;
            if (result.length === 0) return null;
            return result[0].config as U;
          },
          set: async <U>(key: string, value: U): Promise<boolean> => {
            // 防止双重序列化
            // 如果值已经是字符串，尝试解析它以确保它不是JSON字符串
            let dataToStore: any = value;
            if (typeof value === 'string') {
              try {
                // 尝试解析字符串，看是否是有效的JSON
                const parsed = JSON.parse(value as string);
                dataToStore = parsed; // 如果是JSON字符串，使用解析后的对象
                console.log('事务中：检测到JSON字符串，已转换为对象');
              } catch (e) {
                // 如果解析失败，说明不是JSON字符串，保持原值
                console.log('事务中：非JSON字符串，保持原值');
              }
            }
            
            // 使用原始SQL查询，让postgresql自动处理对象到JSONB的转换
            const query = `
              INSERT INTO ${this.tableName} (id, config) 
              VALUES ($1, $2)
              ON CONFLICT (id) 
              DO UPDATE SET config = $2, updated_at = CURRENT_TIMESTAMP
            `;
            
            // 在事务中执行原始SQL
            await txSql.unsafe(query, [key, dataToStore]);
            return true;
          },
          delete: async (key: string): Promise<boolean> => {
            await txSql`
              DELETE FROM ${txSql(this.tableName)} WHERE id = ${key}
            `;
            return true;
          },
          list: async (): Promise<string[]> => {
            const result = await txSql`
              SELECT id FROM ${txSql(this.tableName)}
            `;
            return result.map((row: any) => row.id as string);
          },
          query: async <U>(query: string, params: any[] = []): Promise<U[]> => {
            // 在事务中执行原始SQL
            const result = await txSql.unsafe(query, params);
            return result as unknown as U[];
          },
          transaction: async <U>(cb: (adapter: DatabaseAdapter) => Promise<U>): Promise<U> => {
            // 在事务中不支持嵌套事务，直接调用回调
            return await cb(tempAdapter);
          },
          // 添加 close 方法以符合 DatabaseAdapter 接口
          close: async (): Promise<void> => {
            // 在事务中不需要关闭连接，由外层管理
            console.log('事务中的临时适配器不需要关闭连接');
          }
        };
        
        // 使用类型断言解决返回类型问题
        const result = await callback(tempAdapter);
        return result as T;
      });
    } finally {
      // 确保关闭连接
      await sql.end();
    }
  }

  /**
   * 关闭数据库连接
   * 由于我们现在每次操作都创建新连接，此方法只重置初始化状态
   */
  public async close(): Promise<void> {
    this.initialized = false;
    console.log('PostgreSQL 数据库连接已重置');
  }
} 
