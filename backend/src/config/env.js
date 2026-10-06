import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// Use the repository-root .env first; backend/.env is a fallback for older installs.
dotenv.config({ path: path.join(backendRoot, '..', '.env') });
dotenv.config({ path: path.join(backendRoot, '.env') });

// The default clinic timezone is Cairo. Set TZ explicitly to override it for another region.
if (!process.env.TZ) process.env.TZ = 'Africa/Cairo';

const bool = (value, fallback = false) => value == null ? fallback : ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
const isVercel = process.env.VERCEL === '1';
const nodeEnv = process.env.NODE_ENV || (isVercel && process.env.VERCEL_ENV !== 'development' ? 'production' : 'development');
const requestedDbClient = process.env.DB_CLIENT;
const dbClient = requestedDbClient || (isVercel ? 'pg' : nodeEnv === 'production' ? 'mysql2' : 'better-sqlite3');

export const env = {
  backendRoot,
  nodeEnv,
  isVercel,
  port: Number(process.env.PORT || 4000),
  appOrigin: process.env.APP_ORIGIN || (isVercel && process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:5173'),
  vercelUrl: process.env.VERCEL_URL || '',
  vercelBranchUrl: process.env.VERCEL_BRANCH_URL || '',
  vercelProjectProductionUrl: process.env.VERCEL_PROJECT_PRODUCTION_URL || '',
  dbClient,
  databaseUrl: process.env.DATABASE_URL || '',
  dbFilename: path.resolve(backendRoot, process.env.DB_FILENAME || 'data/clinico.sqlite'),
  dbHost: process.env.DB_HOST || '127.0.0.1',
  dbPort: Number(process.env.DB_PORT || (dbClient === 'pg' ? 5432 : 3306)),
  dbUser: process.env.DB_USER || 'clinico',
  dbPassword: process.env.DB_PASSWORD || '',
  dbName: process.env.DB_NAME || 'clinico',
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET || 'development-access-secret-change-before-production',
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || 'development-refresh-secret-change-before-production',
  encryptionKey: process.env.DATA_ENCRYPTION_KEY || '',
  uploadDir: path.resolve(backendRoot, process.env.UPLOAD_DIR || 'uploads'),
  backupDir: path.resolve(backendRoot, process.env.BACKUP_DIR || 'backups'),
  fileStorageEnabled: !isVercel && bool(process.env.FILE_STORAGE_ENABLED, true),
  featureAiPlan: bool(process.env.FEATURE_AI_PLAN),
  featureVoiceNotes: bool(process.env.FEATURE_VOICE_NOTES),
  seedDemo: bool(process.env.SEED_DEMO),
  adminEmail: process.env.ADMIN_EMAIL,
  adminPassword: process.env.ADMIN_PASSWORD,
  adminName: process.env.ADMIN_NAME || 'مدير النظام',
  adminForcePasswordChange: bool(process.env.ADMIN_FORCE_PASSWORD_CHANGE, true),
  demoPassword: process.env.DEMO_PASSWORD
};

if (env.nodeEnv === 'production') {
  const isPlaceholder = (value) => /^(development|replace|change|your)[-_ ]/i.test(String(value || ''));
  for (const [key, value] of [['JWT_ACCESS_SECRET', env.jwtAccessSecret], ['JWT_REFRESH_SECRET', env.jwtRefreshSecret]]) {
    if (!value || isPlaceholder(value) || value.length < 32) throw new Error(`${key} must be a unique random secret of at least 32 characters in production.`);
  }
  if (!env.encryptionKey || Buffer.from(env.encryptionKey, 'hex').length !== 32) throw new Error('DATA_ENCRYPTION_KEY must be 64 hex characters (32 bytes) in production.');
  if (!['pg', 'mysql2'].includes(env.dbClient)) throw new Error('DB_CLIENT must be pg (Neon) or mysql2 in production.');
  if (env.dbClient === 'pg' && !env.databaseUrl) throw new Error('DATABASE_URL is required when DB_CLIENT=pg. Use the pooled connection string from Neon on Vercel.');
  if (env.dbClient === 'mysql2' && (!env.dbPassword || isPlaceholder(env.dbPassword))) throw new Error('Set a unique DB_PASSWORD in production.');
  if (env.isVercel && env.dbClient !== 'pg') throw new Error('DB_CLIENT=pg is required on Vercel; connect a PostgreSQL database such as Neon.');
  if (env.isVercel && env.fileStorageEnabled) throw new Error('FILE_STORAGE_ENABLED must be false on Vercel until persistent object storage is configured.');
  if (!env.isVercel && (!env.adminEmail || !env.adminPassword || env.adminPassword.length < 12 || isPlaceholder(env.adminPassword) || env.adminEmail.endsWith('@example.com'))) {
    throw new Error('Set a real ADMIN_EMAIL and a unique ADMIN_PASSWORD of at least 12 characters in production.');
  }
}

export { bool };
