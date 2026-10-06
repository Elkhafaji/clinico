// Keep the Express import in the Vercel entrypoint so its Express adapter can detect it.
import express from 'express';
import app from './backend/src/app.js';

if (typeof express !== 'function') throw new Error('Express failed to load.');

// Vercel's Express adapter uses this root entry point; normal Node starts backend/src/server.js.
export default app;
