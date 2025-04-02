import { DatabaseAdapter } from '../types.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface JsonAdapterOptions {
  filePath?: string;
}

export class JsonAdapter implements DatabaseAdapter {
  private filePath: string;
  private cache: Record<string, any> = {};
  private initialized: boolean = false;

  constructor(options: JsonAdapterOptions = {}) {
    // 获取项目根目录路径
    let rootDir = '';
    try {
      // 在ESM环境中获取当前文件的目录
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      // 假设当前文件在 src/db/adapters 目录下
      rootDir = path.resolve(__dirname, '../../../');
    } catch (error) {
      // 降级方案，使用当前工作目录
      rootDir = process.cwd();
    }

    // 使用提供的文件路径或默认路径
    this.filePath = options.filePath || path.join(rootDir, 'data', 'simple-video-player.json');
  }

  /**
   * 初始化JSON文件存储
   */
  public async initialize(): Promise<boolean> {
    if (this.initialized) return true;
    
    try {
      // 确保目录存在
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      // 检查文件是否存在，不存在则创建空JSON
      if (!fs.existsSync(this.filePath)) {
        fs.writeFileSync(this.filePath, JSON.stringify({}), 'utf8');
      } else {
        // 文件存在，加载数据到缓存
        const data = await this.readJsonFile();
        this.cache = data;
      }
      
      this.initialized = true;
      console.log(`JSON数据库初始化成功: ${this.filePath}`);
      return true;
    } catch (error) {
      console.error('初始化JSON数据库失败:', error);
      return false;
    }
  }

  /**
   * 读取JSON文件内容
   */
  private async readJsonFile(): Promise<Record<string, any>> {
    try {
      const data = await fs.promises.readFile(this.filePath, 'utf8');
      return JSON.parse(data || '{}');
    } catch (error) {
      console.error('读取JSON文件失败:', error);
      return {};
    }
  }

  /**
   * 写入JSON文件
   */
  private async writeJsonFile(data: Record<string, any>): Promise<boolean> {
    try {
      await fs.promises.writeFile(this.filePath, JSON.stringify(data, null, 2), 'utf8');
      return true;
    } catch (error) {
      console.error('写入JSON文件失败:', error);
      return false;
    }
  }

  /**
   * 获取一个值
   * @param key 键名
   */
  public async get<T>(key: string): Promise<T | null> {
    if (!this.initialized && !(await this.initialize())) {
      return null;
    }
    
    return (this.cache[key] as T) || null;
  }

  /**
   * 设置一个值
   * @param key 键名
   * @param value 值
   */
  public async set<T>(key: string, value: T): Promise<boolean> {
    if (!this.initialized && !(await this.initialize())) {
      return false;
    }
    
    try {
      // 更新缓存
      this.cache[key] = value;
      
      // 写入文件
      await this.writeJsonFile(this.cache);
      return true;
    } catch (error) {
      console.error(`设置 ${key} 失败:`, error);
      return false;
    }
  }

  /**
   * 删除一个值
   * @param key 键名
   */
  public async delete(key: string): Promise<boolean> {
    if (!this.initialized && !(await this.initialize())) {
      return false;
    }
    
    try {
      // 如果键不存在，直接返回成功
      if (!(key in this.cache)) {
        return true;
      }
      
      // 从缓存中删除
      delete this.cache[key];
      
      // 更新文件
      await this.writeJsonFile(this.cache);
      return true;
    } catch (error) {
      console.error(`删除 ${key} 失败:`, error);
      return false;
    }
  }

  /**
   * 列出所有键
   */
  public async list(): Promise<string[]> {
    if (!this.initialized && !(await this.initialize())) {
      return [];
    }
    
    return Object.keys(this.cache);
  }

  /**
   * 执行查询操作
   * 注意：JSON适配器不支持复杂查询，此方法仅为兼容接口
   */
  public async query<T>(query: string, params: any[] = []): Promise<T[]> {
    console.warn('JSON适配器不支持SQL查询，返回空结果');
    return [];
  }

  /**
   * 执行事务操作
   * 注意：JSON适配器不支持真正的事务，此方法仅为兼容接口
   */
  public async transaction<T>(callback: (adapter: DatabaseAdapter) => Promise<T>): Promise<T> {
    // 创建一个临时的适配器实例，使用相同的缓存和文件路径
    const tempAdapter: DatabaseAdapter = new JsonAdapter({ filePath: this.filePath });
    await tempAdapter.initialize();
    
    try {
      // 执行回调函数
      const result = await callback(tempAdapter);
      return result;
    } catch (error) {
      console.error('JSON事务执行失败:', error);
      throw error;
    }
  }
} 