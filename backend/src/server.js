import app from './app.js';
import { db } from './db/knex.js';
import { env } from './config/env.js';

try {
  await db.migrate.latest();
  const server=app.listen(env.port,'0.0.0.0',()=>console.log(`Clinico API listening on 0.0.0.0:${env.port} (${env.nodeEnv})`));
  const shutdown=async(signal)=>{console.log(`${signal}: closing Clinico API`);server.close(async()=>{await db.destroy();process.exit(0);});setTimeout(()=>process.exit(1),10000).unref();};
  process.on('SIGTERM',()=>shutdown('SIGTERM'));process.on('SIGINT',()=>shutdown('SIGINT'));
}catch(error){console.error('Startup failed:',error.message);await db.destroy();process.exit(1);}
