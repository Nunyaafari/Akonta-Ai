import Fastify from 'fastify';
import crypto from 'node:crypto';
import { parse as parseQuerystring } from 'node:querystring';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { config } from './lib/env.js';
import userRoutes from './routes/users.js';
import authRoutes from './routes/auth.js';
import workspaceRoutes from './routes/workspaces.js';
import transactionRoutes from './routes/transactions.js';
import summaryRoutes from './routes/summaries.js';
import budgetRoutes from './routes/budgets.js';
import insightRoutes from './routes/insights.js';
import whatsappRoutes from './routes/whatsapp.js';
import chatRoutes from './routes/chat.js';
import adminRoutes from './routes/admin.js';
import subscriptionsRoutes from './routes/subscriptions.js';

const isProduction = config.NODE_ENV === 'production';

const validateProductionSecurityConfig = () => {
  if (!isProduction) return;

  const minSecretLength = 32;
  if (!config.JWT_ACCESS_SECRET || config.JWT_ACCESS_SECRET.length < minSecretLength) {
    throw new Error(`JWT_ACCESS_SECRET must be set and at least ${minSecretLength} chars in production.`);
  }

  if (!config.JWT_REFRESH_SECRET || config.JWT_REFRESH_SECRET.length < minSecretLength) {
    throw new Error(`JWT_REFRESH_SECRET must be set and at least ${minSecretLength} chars in production.`);
  }

  if (config.ALLOW_LEGACY_USER_HEADER_AUTH) {
    throw new Error('ALLOW_LEGACY_USER_HEADER_AUTH must be false in production.');
  }

  if (config.AUTH_EXPOSE_DEV_OTP) {
    throw new Error('AUTH_EXPOSE_DEV_OTP must be false in production.');
  }
};

validateProductionSecurityConfig();

const app = Fastify({
  logger: true,
  trustProxy: true
});

const isAllowedCorsOrigin = (origin: string | undefined): boolean => {
  if (!origin) return true;
  if (config.APP_ORIGINS.includes('*')) return true;
  const normalized = origin.replace(/\/$/, '');
  return config.APP_ORIGINS.includes(normalized);
};

const secureEqual = (a: string, b: string): boolean => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
};

const resolveApiKeyFromRequest = (authorizationHeader: unknown, apiKeyHeader: unknown): string | null => {
  const direct = typeof apiKeyHeader === 'string' ? apiKeyHeader : null;
  if (direct && direct.trim().length > 0) return direct.trim();

  if (typeof authorizationHeader !== 'string') return null;
  const token = authorizationHeader.trim();
  if (!token) return null;
  if (token.toLowerCase().startsWith('bearer ')) {
    return token.slice(7).trim();
  }
  return token;
};

const hasLikelyJwtBearer = (authorizationHeader: unknown): boolean => {
  if (typeof authorizationHeader !== 'string') return false;
  const token = authorizationHeader.trim();
  if (!token.toLowerCase().startsWith('bearer ')) return false;
  const value = token.slice(7).trim();
  return value.split('.').length === 3;
};

app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_request, body, done) => {
  try {
    const payload = typeof body === 'string' ? body : body.toString('utf-8');
    done(null, parseQuerystring(payload));
  } catch (error) {
    done(error as Error);
  }
});

await app.register(cors, {
  origin: (origin, callback) => {
    callback(null, isAllowedCorsOrigin(origin));
  },
  credentials: true
});

await app.register(helmet, {
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  hsts: isProduction
    ? {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true
    }
    : false
});

app.addHook('onRequest', async (request, reply) => {
  const path = request.url.split('?')[0];
  if (request.method === 'OPTIONS') return;

  let hasAdminAccess = false;
  if (path.startsWith('/api/admin') && config.ADMIN_API_KEY) {
    const providedAdminKey = resolveApiKeyFromRequest(
      request.headers.authorization,
      request.headers['x-akonta-admin-key']
    );
    if (!providedAdminKey || !secureEqual(config.ADMIN_API_KEY, providedAdminKey)) {
      return reply.status(401).send({ message: 'Unauthorized: invalid admin API key.' });
    }
    hasAdminAccess = true;
  }

  if (!config.BACKEND_API_KEY || hasAdminAccess) return;

  const publicPaths = new Set([
    '/api/health',
    '/api/whatsapp/webhook/twilio',
    '/api/whatsapp/webhook/infobip',
    '/api/subscriptions/webhook/paystack'
  ]);

  if (publicPaths.has(path) || path.startsWith('/api/auth')) return;

  if (hasLikelyJwtBearer(request.headers.authorization)) return;

  const providedKey = resolveApiKeyFromRequest(request.headers.authorization, request.headers['x-akonta-api-key']);
  if (!providedKey || !secureEqual(config.BACKEND_API_KEY, providedKey)) {
    return reply.status(401).send({ message: 'Unauthorized: invalid API key.' });
  }
});

await app.register(userRoutes, { prefix: '/api/users' });
await app.register(authRoutes, { prefix: '/api/auth' });
await app.register(workspaceRoutes, { prefix: '/api/workspaces' });
await app.register(transactionRoutes, { prefix: '/api/transactions' });
await app.register(summaryRoutes, { prefix: '/api/summaries' });
await app.register(budgetRoutes, { prefix: '/api/budgets' });
await app.register(insightRoutes, { prefix: '/api/insights' });
await app.register(whatsappRoutes, { prefix: '/api/whatsapp' });
await app.register(chatRoutes, { prefix: '/api/chat' });
await app.register(adminRoutes, { prefix: '/api/admin' });
await app.register(subscriptionsRoutes, { prefix: '/api/subscriptions' });

app.get('/api/health', async () => ({ status: 'ok' }));

const port = Number(config.PORT ?? 4000);
await app.listen({ port, host: '0.0.0.0' });
app.log.info(`Backend running at http://localhost:${port}`);
