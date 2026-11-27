import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 3001);
const dbPath = process.env.DB_PATH ?? './bullion-desk.db';
const enableLiveFeed = process.env.ENABLE_LIVE_FEED !== 'false';

const { app } = await createApp({ dbPath, enableFeedTimer: true, enableLiveFeed });

await app.listen({ port, host: '0.0.0.0' });
console.log(`BullionDesk Server listening on http://0.0.0.0:${port} (liveFeed=${enableLiveFeed})`);
