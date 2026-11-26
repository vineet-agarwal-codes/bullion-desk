import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 3001);
const dbPath = process.env.DB_PATH ?? './bullion-desk.db';

const { app } = await createApp({ dbPath, enableFeedTimer: true });

await app.listen({ port, host: '0.0.0.0' });
console.log(`BullionDesk Server listening on http://0.0.0.0:${port}`);
