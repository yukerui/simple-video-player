import { JsonAdapterOptions } from './adapters/json-adapter.js';
import { PgAdapterOptions } from './adapters/pg-adapter.js';

export interface DatabaseConfig {
  sqlDsn?: string;
  pgConfig?: PgAdapterOptions;
  kvNamespace?: any;
  jsonConfig?: JsonAdapterOptions;
} 