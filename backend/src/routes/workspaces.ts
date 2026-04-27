import type { FastifyPluginAsync } from 'fastify';
import type { MembershipRole, MembershipStatus } from '@prisma/client';
import db from '../lib/db.js';
import { hashToken, issueSessionTokens, requireAuth } from '../lib/auth.js';
import { writeAuditLog } from '../services/audit.js';
import { hasPermission } from '../services/rbac.js';

const membershipRoles: MembershipRole[] = ['owner', 'cashier', 'manager', 'bookkeeper', 'viewer', 'accountant'];
const membershipStatuses: MembershipStatus[] = ['invited', 'active', 'inactive', 'revoked'];

const normalizePhone = (value: string): string => value.trim().replace(/\s+/g, '');

const isMembershipRole = (value: unknown): value is MembershipRole => {
  return typeof value === 'string' && membershipRoles.includes(value as MembershipRole);
};

const isMembershipStatus = (value: unknown): value is MembershipStatus => {
  return typeof value === 'string' && membershipStatuses.includes(value as MembershipStatus);
};

const hasPremiumWorkspaceAccess = async (businessId: string): Promise<boolean> => {
  const workspace = await db.business.findUnique({
    where: { id: businessId },
    select: { subscriptionStatus: true }
  });
  return workspace?.subscriptionStatus === 'premium';
};

const workspaceRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', async (request, reply) => {
    const auth = await requireAuth(request, reply);
    if (!auth) return;

    const memberships = await db.businessMembership.findMany({
      where: {
        userId: auth.userId,
        membershipStatus: { in: ['active', 'invited', 'inactive'] }
      },
      include: {
        business: true
      },
      orderBy: { createdAt: 'asc' }
    });

    return memberships.map((membership) => ({
      membershipId: membership.id,
      businessId: membership.businessId,
      businessName: membership.business.businessName,
      role: membership.role,
      status: membership.membershipStatus
    }));
  });

  fastify.post('/select', async (request, reply) => {
    const auth = await requireAuth(request, reply);
    if (!auth) return;

    const body = request.body as { businessId?: string };
    if (!body.businessId) {
      return reply.status(400).send({ message: 'businessId is required.' });
    }

    const membership = await db.businessMembership.findUnique({
      where: {
        businessId_userId: {
          businessId: body.businessId,
          userId: auth.userId
        }
      }
    });

    if (!membership || membership.membershipStatus !== 'active') {
      return reply.status(403).send({ message: 'No active membership found for requested workspace.' });
    }

    await db.$transaction([
      db.user.update({
        where: { id: auth.userId },
        data: { activeBusinessId: body.businessId }
      }),
      db.userSession.update({
        where: { id: auth.sessionId },
        data: { businessId: body.businessId }
      })
    ]);

    const tokens = issueSessionTokens({
      userId: auth.userId,
      businessId: body.businessId,
      role: membership.role,
      sessionId: auth.sessionId
    });

    await db.userSession.update({
      where: { id: auth.sessionId },
      data: {
        refreshTokenHash: hashToken(tokens.refreshToken)
      }
    });

    return {
      businessId: body.businessId,
      role: membership.role,
      tokens
    };
  });

  fastify.get('/members', async (request, reply) => {
    const auth = await requireAuth(request, reply);
    if (!auth) return;

    if (!hasPermission(auth.role, 'workspace:view')) {
      return reply.status(403).send({ message: 'Permission denied for workspace members.' });
    }

    const members = await db.businessMembership.findMany({
      where: {
        businessId: auth.businessId
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            fullName: true,
            phoneNumber: true,
            email: true,
            status: true
          }
        }
      },
      orderBy: { createdAt: 'asc' }
    });

    return members.map((member) => ({
      membershipId: member.id,
      userId: member.userId,
      role: member.role,
      status: member.membershipStatus,
      joinedAt: member.joinedAt,
      invitedByUserId: member.invitedByUserId,
      user: member.user
    }));
  });

  fastify.post('/members/invite', async (request, reply) => {
    const auth = await requireAuth(request, reply);
    if (!auth) return;

    if (!hasPermission(auth.role, 'workspace:members:manage')) {
      return reply.status(403).send({ message: 'Permission denied for member invites.' });
    }

    if (!(await hasPremiumWorkspaceAccess(auth.businessId))) {
      return reply.status(403).send({ message: 'Team workspace invites require Premium subscription.' });
    }

    const body = request.body as {
      fullName?: string;
      email?: string;
      phoneNumber?: string;
      role?: MembershipRole;
    };

    if (!body.fullName || !body.role || (!body.phoneNumber && !body.email)) {
      return reply.status(400).send({ message: 'fullName, role, and phoneNumber or email are required.' });
    }

    if (!isMembershipRole(body.role) || body.role === 'owner') {
      return reply.status(400).send({ message: 'role must be cashier, manager, bookkeeper, viewer, or accountant.' });
    }

    const normalizedPhone = body.phoneNumber ? normalizePhone(body.phoneNumber) : null;

    const existingUser = await db.user.findFirst({
      where: {
        OR: [
          ...(normalizedPhone ? [{ phoneNumber: normalizedPhone }] : []),
          ...(body.email ? [{ email: body.email }] : [])
        ]
      }
    });

    const user = existingUser
      ? await db.user.update({
        where: { id: existingUser.id },
        data: {
          name: body.fullName,
          fullName: body.fullName,
          email: body.email ?? existingUser.email,
          phoneNumber: normalizedPhone ?? existingUser.phoneNumber,
          status: existingUser.status === 'suspended' ? existingUser.status : 'pending'
        }
      })
      : await db.user.create({
        data: {
          name: body.fullName,
          fullName: body.fullName,
          phoneNumber: normalizedPhone ?? `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          email: body.email ?? null,
          status: 'pending'
        }
      });

    const membership = await db.businessMembership.upsert({
      where: {
        businessId_userId: {
          businessId: auth.businessId,
          userId: user.id
        }
      },
      update: {
        role: body.role,
        membershipStatus: 'invited',
        invitedByUserId: auth.userId
      },
      create: {
        businessId: auth.businessId,
        userId: user.id,
        role: body.role,
        membershipStatus: 'invited',
        invitedByUserId: auth.userId
      }
    });

    await writeAuditLog({
      businessId: auth.businessId,
      entityType: 'membership',
      entityId: membership.id,
      action: 'member_invited',
      performedByUserId: auth.userId,
      newValue: {
        role: membership.role,
        status: membership.membershipStatus,
        invitedUserId: membership.userId
      }
    });

    reply.status(201);
    return {
      membershipId: membership.id,
      userId: user.id,
      role: membership.role,
      status: membership.membershipStatus
    };
  });

  fastify.patch('/members/:membershipId', async (request, reply) => {
    const auth = await requireAuth(request, reply);
    if (!auth) return;

    if (!hasPermission(auth.role, 'workspace:members:manage')) {
      return reply.status(403).send({ message: 'Permission denied for member updates.' });
    }

    if (!(await hasPremiumWorkspaceAccess(auth.businessId))) {
      return reply.status(403).send({ message: 'Team workspace management requires Premium subscription.' });
    }

    const { membershipId } = request.params as { membershipId: string };
    const body = request.body as {
      role?: MembershipRole;
      status?: MembershipStatus;
    };

    if (body.role !== undefined && (!isMembershipRole(body.role) || body.role === 'owner')) {
      return reply.status(400).send({ message: 'Invalid role update.' });
    }

    if (body.status !== undefined && !isMembershipStatus(body.status)) {
      return reply.status(400).send({ message: 'Invalid membership status update.' });
    }

    const existing = await db.businessMembership.findUnique({ where: { id: membershipId } });
    if (!existing || existing.businessId !== auth.businessId) {
      return reply.status(404).send({ message: 'Workspace member not found.' });
    }

    if (existing.role === 'owner') {
      return reply.status(400).send({ message: 'Owner membership cannot be changed here.' });
    }

    const updated = await db.businessMembership.update({
      where: { id: membershipId },
      data: {
        role: body.role ?? existing.role,
        membershipStatus: body.status ?? existing.membershipStatus,
        joinedAt: body.status === 'active' && !existing.joinedAt ? new Date() : existing.joinedAt
      }
    });

    await writeAuditLog({
      businessId: auth.businessId,
      entityType: 'membership',
      entityId: updated.id,
      action: 'member_updated',
      performedByUserId: auth.userId,
      oldValue: {
        role: existing.role,
        status: existing.membershipStatus
      },
      newValue: {
        role: updated.role,
        status: updated.membershipStatus
      }
    });

    return {
      membershipId: updated.id,
      role: updated.role,
      status: updated.membershipStatus,
      joinedAt: updated.joinedAt
    };
  });

  fastify.get('/audit-logs', async (request, reply) => {
    const auth = await requireAuth(request, reply);
    if (!auth) return;

    if (!hasPermission(auth.role, 'audit:view')) {
      return reply.status(403).send({ message: 'Permission denied for audit logs.' });
    }

    const query = request.query as { limit?: string };
    const limit = Math.min(200, Math.max(1, Number(query.limit ?? 50)));
    if (!Number.isFinite(limit)) {
      return reply.status(400).send({ message: 'limit must be a number.' });
    }

    const logs = await db.auditLog.findMany({
      where: { businessId: auth.businessId },
      orderBy: { performedAt: 'desc' },
      take: limit
    });

    return logs;
  });
};

export default workspaceRoutes;
