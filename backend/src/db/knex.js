import knexFactory from 'knex';
import path from 'node:path';
import fs from 'node:fs';
import { env } from '../config/env.js';

if (env.dbClient === 'better-sqlite3') fs.mkdirSync(path.dirname(env.dbFilename), { recursive: true });

const migrations = { directory: path.join(env.backendRoot, 'src/db/migrations'), tableName: 'knex_migrations' };

const config = env.dbClient === 'pg'
  ? {
      client: 'pg',
      connection: {
        connectionString: env.databaseUrl,
        application_name: 'clinico-systems',
        options: `-c timezone=${process.env.TZ || 'Africa/Cairo'}`
      },
      // Vercel instances are short-lived; keep the per-instance Neon pool intentionally small.
      pool: { min: 0, max: env.isVercel ? 1 : 5, idleTimeoutMillis: 10000, acquireTimeoutMillis: 30000 },
      migrations
    }
  : env.dbClient === 'mysql2'
    ? {
        client: 'mysql2',
        connection: { host: env.dbHost, port: env.dbPort, user: env.dbUser, password: env.dbPassword, database: env.dbName, charset: 'utf8mb4' },
        pool: { min: 2, max: 10 },
        migrations
      }
    : {
        client: 'better-sqlite3',
        connection: { filename: env.dbFilename },
        useNullAsDefault: true,
        pool: {
          afterCreate: (connection, done) => {
            try { connection.pragma('foreign_keys = ON'); connection.pragma('journal_mode = WAL'); done(null, connection); }
            catch (error) { done(error, connection); }
          }
        },
        migrations
      };

export const db = knexFactory(config);
export const clientName = env.dbClient;
