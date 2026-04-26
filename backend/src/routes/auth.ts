import crypto from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import type { MembershipRole } from '@prisma/client';
import db from '../lib/db.js';
import { hashToken, issueSessionTokens, verifyRefreshToken } from '../lib/auth.js';
import { config } from '../lib/env.js';

const OTP_TTL_MINUTES = 10;
const MAX_OTP_ATTEMPTS = 5;

const normalizePhone = (value: string): string => value.trim().replace(/\s+/g, '');

const generateOtpCode = (): string => {
  const value = crypto.randomInt(0, 1_000_000);
  return value.toString().padStart(6, '0');
};

const resolvePrimaryMembership = async (params: { userId: string; businessId?: string }) => {
  if (params.businessId) {
    const selected = await db.businessMembership.findUnique({
      where: {
        businessId_userId: {
          businessId: params.businessId,
          userId: params.userId
        }
      },
      include: { business: true }
    });
    if (selected && selected.membershipStatus !== 'revoked') {
      return selected;
    }
  }

  const active = await db.businessMembership.findFirst({
    where: {
      userId: params.userId,
      membershipStatus: 'active'
    },
    orderBy: { createdAt: 'asc' },
    include: { business: true }
  });

  if (active) return active;

  const invited = await db.businessMembership.findFirst({
    where: {
      userId: params.userId,
      membershipStatus: 'invited'
    },
    orderBy: { createdAt: 'asc' },
    include: { business: true }
  });

  return invited;
};

const authRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/request-otp', async (request, reply) => {
    const body = request.body as { phoneNumber?: string };
    if (!body.phoneNumber) {
      return reply.status(400).send({ message: 'phoneNumber is required.' });
    }

    const phoneNumber = normalizePhone(body.phoneNumber);
    const user = await db.user.findUnique({ where: { phoneNumber } });
    if (!user) {
      return reply.status(404).send({ message: 'No account found for this phone number.' });
    }

    const now = new Date();
    const windowStart = new Date(now.getTime() - config.OTP_REQUEST_WINDOW_MINUTES * 60 * 1000);

    const [phoneWindowCount, ipWindowCount, latestForPhone] = await Promise.all([
      db.otpCode.count({
        where: {
          phoneNumber,
          createdAt: { gte: windowStart }
        }
      }),
      db.otpCode.count({
        where: {
          requestedByIp: request.ip,
          createdAt: { gte: windowStart }
        }
      }),
      db.otpCode.findFirst({
        where: { phoneNumber },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true }
      })
    ]);

    if (phoneWindowCount >= config.OTP_MAX_REQUESTS_PER_PHONE_WINDOW) {
      return reply.status(429).send({ message: 'Too many OTP requests for this phone. Please wait and try again.' });
    }

    if (ipWindowCount >= config.OTP_MAX_REQUESTS_PER_IP_WINDOW) {
      return reply.status(429).send({ message: 'Too many OTP requests from this network. Please wait and try again.' });
    }

    if (latestForPhone) {
      const earliestNextRequest = latestForPhone.createdAt.getTime() + config.OTP_MIN_SECONDS_BETWEEN_REQUESTS * 1000;
      if (now.getTime() < earliestNextRequest) {
        const retryAfterSeconds = Math.max(1, Math.ceil((earliestNextRequest - now.getTime()) / 1000));
        reply.header('Retry-After', String(retryAfterSeconds));
        return reply.status(429).send({
          message: `Please wait ${retryAfterSeconds}s before requesting another OTP.`
        });
      }
    }

    const code = generateOtpCode();
    const codeHash = hashToken(code);
    const codeLast4 = code.slice(-4);
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

    await db.otpCode.create({
      data: {
        phoneNumber,
        codeHash,
        codeLast4,
        expiresAt,
        requestedByIp: request.ip
      }
    });

    const payload: Record<string, unknown> = {
      success: true,
      expiresAt: expiresAt.toISOString()
    };

    if (config.AUTH_EXPOSE_DEV_OTP && config.NODE_ENV !== 'production') {
      payload.devOtpCode = code;
    }

    return payload;
  });

  fastify.post('/verify-otp', async (request, reply) => {
    const body = request.body as {
      phoneNumber?: string;
      code?: string;
      businessId?: string;
    };

    if (!body.phoneNumber || !body.code) {
      return reply.status(400).send({ message: 'phoneNumber and code are required.' });
    }

    const phoneNumber = normalizePhone(body.phoneNumber);
    const otp = await db.otpCode.findFirst({
      where: {
        phoneNumber,
        consumedAt: null
      },
      orderBy: { createdAt: 'desc' }
    });

    if (!otp || otp.expiresAt <= new Date()) {
      return reply.status(400).send({ message: 'OTP is invalid or expired.' });
    }

    if (otp.attempts >= MAX_OTP_ATTEMPTS) {
      return reply.status(429).send({ message: 'OTP retry limit reached. Request a new code.' });
    }

    const matches = hashToken(body.code) === otp.codeHash;
    if (!matches) {
      await db.otpCode.update({
        where: { id: otp.id },
        data: { attempts: { increment: 1 } }
      });
      return reply.status(400).send({ message: 'OTP is invalid.' });
    }

    const user = await db.user.findUnique({ where: { phoneNumber } });
    if (!user) {
      return reply.status(404).send({ message: 'No account found for this phone number.' });
    }

    const membership = await resolvePrimaryMembership({
      userId: user.id,
      businessId: body.businessId
    });

    if (!membership) {
      return reply.status(403).send({ message: 'No workspace membership found for this user.' });
    }

    const now = new Date();

    const activatedMembership = membership.membershipStatus === 'invited'
      ? await db.businessMembership.update({
        where: { id: membership.id },
        data: {
          membershipStatus: 'active',
          joinedAt: now
        }
      })
      : membership;

    const session = await db.userSession.create({
      data: {
        userId: user.id,
        businessId: activatedMembership.businessId,
        refreshTokenHash: '',
        expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
      }
    });

    const tokens = issueSessionTokens({
      userId: user.id,
      businessId: activatedMembership.businessId,
      role: activatedMembership.role,
      sessionId: session.id
    });

    await db.$transaction([
      db.user.update({
        where: { id: user.id },
        data: {
          status: 'active',
          activeBusinessId: activatedMembership.businessId
        }
      }),
      db.userSession.update({
        where: { id: session.id },
        data: {
          refreshTokenHash: hashToken(tokens.refreshToken)
        }
      }),
      db.otpCode.update({
        where: { id: otp.id },
        data: {
          consumedAt: now,
          attempts: otp.attempts + 1
        }
      })
    ]);

    const memberships = await db.businessMembership.findMany({
      where: {
        userId: user.id,
        membershipStatus: { in: ['active', 'invited'] }
      },
      include: { business: true },
      orderBy: { createdAt: 'asc' }
    });

    return {
      user,
      session: {
        id: session.id,
        businessId: activatedMembership.businessId,
        role: activatedMembership.role
      },
      memberships: memberships.map((entry) => ({
        id: entry.id,
        businessId: entry.businessId,
        businessName: entry.business.businessName,
        role: entry.role,
        status: entry.membershipStatus
      })),
      tokens
    };
  });

  fastify.post('/refresh', async (request, reply) => {
    const body = request.body as { refreshToken?: string };

    if (!body.refreshToken) {
      return reply.status(400).send({ message: 'refreshToken is required.' });
    }

    let payload;
    try {
      payload = verifyRefreshToken(body.refreshToken);
    } catch {
      return reply.status(401).send({ message: 'Invalid refresh token.' });
    }

    const session = await db.userSession.findUnique({
      where: { id: payload.sid },
      include: {
        user: true,
        business: true
      }
    });

    if (!session || session.revokedAt || session.expiresAt <= new Date()) {
      return reply.status(401).send({ message: 'Refresh session expired or revoked.' });
    }

    if (session.userId !== payload.sub || hashToken(body.refreshToken) !== session.refreshTokenHash) {
      return reply.status(401).send({ message: 'Refresh token mismatch.' });
    }

    const membership = await db.businessMembership.findUnique({
      where: {
        businessId_userId: {
          businessId: session.businessId,
          userId: session.userId
        }
      }
    });

    if (!membership || membership.membershipStatus !== 'active') {
      return reply.status(403).send({ message: 'User does not have active workspace access.' });
    }

    const tokens = issueSessionTokens({
      userId: session.userId,
      businessId: session.businessId,
      role: membership.role,
      sessionId: session.id
    });

    await db.userSession.update({
      where: { id: session.id },
      data: {
        refreshTokenHash: hashToken(tokens.refreshToken),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      }
    });

    return {
      tokens,
      session: {
        id: session.id,
        businessId: session.businessId,
        role: membership.role
      }
    };
  });

  fastify.post('/logout', async (request, reply) => {
    const body = request.body as { refreshToken?: string };

    if (!body.refreshToken) {
      return reply.status(400).send({ message: 'refreshToken is required.' });
    }

    try {
      const payload = verifyRefreshToken(body.refreshToken);
      await db.userSession.update({
        where: { id: payload.sid },
        data: { revokedAt: new Date() }
      });
    } catch {
      // Intentionally ignore to preserve idempotent logout behavior.
    }

    return { success: true };
  });

  fastify.post('/bootstrap-owner', async (request, reply) => {
    const body = request.body as {
      name?: string;
      phoneNumber?: string;
      businessName?: string;
      role?: MembershipRole;
    };

    if (!body.name || !body.phoneNumber || !body.businessName) {
      return reply.status(400).send({ message: 'name, phoneNumber, and businessName are required.' });
    }

    const name = body.name;
    const businessName = body.businessName;
    const phoneNumber = normalizePhone(body.phoneNumber);
    const role = body.role ?? 'owner';

    if (role !== 'owner') {
      return reply.status(400).send({ message: 'bootstrap-owner only supports owner role.' });
    }

    const existing = await db.user.findUnique({ where: { phoneNumber } });
    if (existing) {
      return reply.status(409).send({ message: 'A user with this phone number already exists.' });
    }

    const created = await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name,
          phoneNumber,
          fullName: name,
          status: 'active'
        }
      });

      const business = await tx.business.create({
        data: {
          businessName,
          ownerUserId: user.id,
          primaryWhatsappUserId: user.id,
          timezone: 'Africa/Accra',
          subscriptionStatus: 'trial'
        }
      });

      const membership = await tx.businessMembership.create({
        data: {
          businessId: business.id,
          userId: user.id,
          role: 'owner',
          membershipStatus: 'active',
          joinedAt: new Date()
        }
      });

      await tx.user.update({
        where: { id: user.id },
        data: {
          activeBusinessId: business.id,
          businessName: business.businessName
        }
      });

      return { user, business, membership };
    });

    reply.status(201);
    return created;
  });
};

export default authRoutes;
