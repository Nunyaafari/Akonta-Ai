import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { MembershipRole } from '@prisma/client';
import db from './db.js';
import { config } from './env.js';
import { hasPermission, type Permission } from '../services/rbac.js';

export interface AccessTokenPayload {
  sub: string;
  businessId: string;
  role: MembershipRole;
  sid: string;
  type: 'access';
}

interface RefreshTokenPayload {
  sub: string;
  businessId: string;
  sid: string;
  type: 'refresh';
}

export interface AuthContext {
  userId: string;
  businessId: string;
  role: MembershipRole;
  membershipId: string;
  sessionId: string;
}

const ACCESS_TTL_SECONDS = 60 * 15;
const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 30;

const getAccessSecret = (): string => config.JWT_ACCESS_SECRET || config.BACKEND_API_KEY || 'akonta-access-dev-secret';
const getRefreshSecret = (): string => config.JWT_REFRESH_SECRET || config.BACKEND_API_KEY || 'akonta-refresh-dev-secret';

const decodeBearer = (headerValue: unknown): string | null => {
  if (typeof headerValue !== 'string') return null;
  const value = headerValue.trim();
  if (!value) return null;
  if (value.toLowerCase().startsWith('bearer ')) {
    return value.slice(7).trim();
  }
  return value;
};

export const hashToken = (value: string): string => {
  return crypto.createHash('sha256').update(value).digest('hex');
};

export const issueSessionTokens = (params: {
  userId: string;
  businessId: string;
  role: MembershipRole;
  sessionId: string;
}) => {
  const accessToken = jwt.sign(
    {
      sub: params.userId,
      businessId: params.businessId,
      role: params.role,
      sid: params.sessionId,
      type: 'access'
    },
    getAccessSecret(),
    { expiresIn: ACCESS_TTL_SECONDS }
  );

  const refreshToken = jwt.sign(
    {
      sub: params.userId,
      businessId: params.businessId,
      sid: params.sessionId,
      type: 'refresh'
    },
    getRefreshSecret(),
    { expiresIn: REFRESH_TTL_SECONDS }
  );

  return {
    accessToken,
    refreshToken,
    accessExpiresIn: ACCESS_TTL_SECONDS,
    refreshExpiresIn: REFRESH_TTL_SECONDS
  };
};

export const verifyRefreshToken = (refreshToken: string): RefreshTokenPayload => {
  const decoded = jwt.verify(refreshToken, getRefreshSecret()) as RefreshTokenPayload;
  if (decoded.type !== 'refresh') {
    throw new Error('Invalid token type');
  }
  return decoded;
};

export const verifyAccessToken = (accessToken: string): AccessTokenPayload => {
  const decoded = jwt.verify(accessToken, getAccessSecret()) as AccessTokenPayload;
  if (decoded.type !== 'access') {
    throw new Error('Invalid token type');
  }
  return decoded;
};

export const requireAuth = async (request: FastifyRequest, reply: FastifyReply): Promise<AuthContext | null> => {
  const token = decodeBearer(request.headers.authorization);
  if (!token) {
    if (!config.ALLOW_LEGACY_USER_HEADER_AUTH) {
      await reply.status(401).send({ message: 'Missing bearer token.' });
      return null;
    }

    const body = (request.body ?? {}) as Record<string, unknown>;
    const query = (request.query ?? {}) as Record<string, unknown>;
    const legacyUserId = typeof request.headers['x-akonta-user-id'] === 'string'
      ? request.headers['x-akonta-user-id']
      : typeof body.userId === 'string'
        ? body.userId
        : typeof query.userId === 'string'
          ? query.userId
          : null;

    if (!legacyUserId) {
      await reply.status(401).send({ message: 'Missing bearer token.' });
      return null;
    }

    const user = await db.user.findUnique({
      where: { id: legacyUserId },
      select: { id: true, activeBusinessId: true }
    });
    if (!user || !user.activeBusinessId) {
      await reply.status(401).send({ message: 'Legacy user context is invalid.' });
      return null;
    }

    const membership = await db.businessMembership.findUnique({
      where: {
        businessId_userId: {
          businessId: user.activeBusinessId,
          userId: user.id
        }
      }
    });

    if (!membership || membership.membershipStatus !== 'active') {
      await reply.status(403).send({ message: 'User is not active in this workspace.' });
      return null;
    }

    return {
      userId: user.id,
      businessId: user.activeBusinessId,
      role: membership.role,
      membershipId: membership.id,
      sessionId: 'legacy'
    };
  }

  let decoded: AccessTokenPayload;
  try {
    decoded = verifyAccessToken(token);
  } catch {
    await reply.status(401).send({ message: 'Invalid or expired access token.' });
    return null;
  }

  const session = await db.userSession.findUnique({
    where: { id: decoded.sid }
  });

  if (!session || session.revokedAt || session.expiresAt <= new Date() || session.userId !== decoded.sub) {
    await reply.status(401).send({ message: 'Session is invalid or expired.' });
    return null;
  }

  const membership = await db.businessMembership.findUnique({
    where: {
      businessId_userId: {
        businessId: decoded.businessId,
        userId: decoded.sub
      }
    }
  });

  if (!membership || membership.membershipStatus !== 'active') {
    await reply.status(403).send({ message: 'User is not active in this workspace.' });
    return null;
  }

  return {
    userId: decoded.sub,
    businessId: decoded.businessId,
    role: membership.role,
    membershipId: membership.id,
    sessionId: decoded.sid
  };
};

export const requirePermission = async (
  request: FastifyRequest,
  reply: FastifyReply,
  permission: Permission
): Promise<AuthContext | null> => {
  const auth = await requireAuth(request, reply);
  if (!auth) return null;

  if (!hasPermission(auth.role, permission)) {
    await reply.status(403).send({ message: `Permission denied for ${permission}.` });
    return null;
  }

  return auth;
};
