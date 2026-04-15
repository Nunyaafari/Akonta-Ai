import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { config } from './lib/env.js';
import userRoutes from './routes/users.js';
import transactionRoutes from './routes/transactions.js';
import summaryRoutes from './routes/summaries.js';
import budgetRoutes from './routes/budgets.js';
import whatsappRoutes from './routes/whatsapp.js';
import chatRoutes from './routes/chat.js';

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: [config.APP_ORIGIN],
});

await app.register(helmet);
await app.register(userRoutes, { prefix: '/api/users' });
await app.register(transactionRoutes, { prefix: '/api/transactions' });
await app.register(summaryRoutes, { prefix: '/api/summaries' });
await app.register(budgetRoutes, { prefix: '/api/budgets' });
await app.register(whatsappRoutes, { prefix: '/api/whatsapp' });
await app.register(chatRoutes, { prefix: '/api/chat' });

app.get('/api/health', async () => ({ status: 'ok' }));

const port = Number(config.PORT ?? 4000);
await app.listen({ port, host: '0.0.0.0' });
app.log.info(`Backend running at http://localhost:${port}`);
