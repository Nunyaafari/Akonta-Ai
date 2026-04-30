import type { FastifyPluginAsync } from 'fastify';
import { Prisma, type BusinessCategoryKind, type ProductServiceType } from '@prisma/client';
import db from '../lib/db.js';
import { requirePermission } from '../lib/auth.js';
import { config } from '../lib/env.js';
import { bootstrapBusinessDefaults } from '../services/setupDefaults.js';
import { computeBalanceSheetSnapshot } from '../services/balanceSheet.js';

const normalizeName = (value: string): string => value.trim().replace(/\s+/g, ' ');
const normalizeLookup = (value: string): string => normalizeName(value).toLowerCase();
const normalizeCurrencyCode = (value?: string): string | null => {
  if (!value) return null;
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) return null;
  return normalized;
};

const toOptionalNumber = (value: unknown): number | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const isProductServiceType = (value: unknown): value is ProductServiceType =>
  value === 'product' || value === 'service';

const isCategoryKind = (value: unknown): value is BusinessCategoryKind =>
  value === 'sales' || value === 'expense';

const toOptionalText = (value: unknown): string | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const normalized = normalizeName(value);
  return normalized || null;
};

const isLedgerAccountType = (value: unknown): value is 'asset' | 'liability' | 'equity' | 'income' | 'expense' =>
  value === 'asset' || value === 'liability' || value === 'equity' || value === 'income' || value === 'expense';

type SetupCounts = {
  products: number;
  customers: number;
  suppliers: number;
  categories: number;
  ledgerAccounts: number;
};

type ProfileBusiness = {
  id: string;
  businessName: string;
  businessType: string | null;
  currencyCode: string;
  timezone: string;
  enabledPaymentMethods: Prisma.JsonValue;
  onboardingVersion: number;
  onboardingCompletedAt: Date | null;
};

const buildProfileCompletion = (business: ProfileBusiness, counts: SetupCounts) => {
  const hasBusinessName = Boolean(business.businessName?.trim());
  const hasBusinessType = Boolean(business.businessType?.trim());
  const hasCurrencyCode = Boolean(business.currencyCode?.trim());
  const hasTimezone = Boolean(business.timezone?.trim());
  const paymentMethods = Array.isArray(business.enabledPaymentMethods)
    ? business.enabledPaymentMethods.filter((entry) => typeof entry === 'string')
    : [];
  const hasPaymentMethods = paymentMethods.length > 0;

  const requiredChecks = [
    hasBusinessName,
    hasBusinessType,
    hasCurrencyCode,
    hasTimezone,
    hasPaymentMethods
  ];
  const requiredCompleted = requiredChecks.filter(Boolean).length;
  const requiredTotal = requiredChecks.length;
  const requiredCompletionPercent = Math.round((requiredCompleted / requiredTotal) * 100);

  const setupModules = [
    counts.categories > 0,
    counts.products > 0,
    counts.customers > 0,
    counts.suppliers > 0
  ];
  const setupCompleted = setupModules.filter(Boolean).length;
  const setupTotal = setupModules.length;
  const setupCompletionPercent = Math.round((setupCompleted / setupTotal) * 100);
  const overallCompletionPercent = Math.round(((requiredCompletionPercent * 0.7) + (setupCompletionPercent * 0.3)));

  return {
    required: {
      hasBusinessName,
      hasBusinessType,
      hasCurrencyCode,
      hasTimezone,
      hasPaymentMethods
    },
    setupModules: {
      hasCategories: counts.categories > 0,
      hasProducts: counts.products > 0,
      hasCustomers: counts.customers > 0,
      hasSuppliers: counts.suppliers > 0,
      hasDefaultLedger: counts.ledgerAccounts > 0
    },
    completion: {
      requiredCompleted,
      requiredTotal,
      requiredCompletionPercent,
      setupCompleted,
      setupTotal,
      setupCompletionPercent,
      overallCompletionPercent
    },
    isReadyForFirstRecord: requiredCompletionPercent === 100,
    isSetupSeeded: counts.ledgerAccounts > 0 || counts.categories > 0
  };
};

const toProfileResponse = (business: ProfileBusiness, counts: SetupCounts) => ({
  ...business,
  setupCounts: counts,
  onboardingProfile: buildProfileCompletion(business, counts)
});

const settingsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/profile', async (request, reply) => {
    const auth = await requirePermission(request, reply, 'settings:view');
    if (!auth) return;

    const [business, counts] = await Promise.all([
      db.business.findUnique({
        where: { id: auth.businessId },
        select: {
          id: true,
          businessName: true,
          businessType: true,
          currencyCode: true,
          timezone: true,
          enabledPaymentMethods: true,
          onboardingVersion: true,
          onboardingCompletedAt: true
        }
      }),
      db.$transaction([
        db.productService.count({ where: { businessId: auth.businessId, isActive: true } }),
        db.customer.count({ where: { businessId: auth.businessId, isActive: true } }),
        db.supplier.count({ where: { businessId: auth.businessId, isActive: true } }),
        db.businessCategory.count({ where: { businessId: auth.businessId, isActive: true } }),
        db.ledgerAccount.count({ where: { businessId: auth.businessId, isActive: true } })
      ])
    ]);

    if (!business) return reply.status(404).send({ message: 'Business not found.' });

    const setupCounts: SetupCounts = {
      products: counts[0],
      customers: counts[1],
      suppliers: counts[2],
      categories: counts[3],
      ledgerAccounts: counts[4]
    };

    return toProfileResponse(business, setupCounts);
  });

  fastify.patch('/profile', async (request, reply) => {
    const auth = await requirePermission(request, reply, 'settings:manage');
    if (!auth) return;

    const body = request.body as {
      businessName?: string;
      businessType?: string | null;
      currencyCode?: string;
      timezone?: string | null;
      enabledPaymentMethods?: unknown;
      onboardingCompleted?: boolean;
    };

    const normalizedCurrency = body.currencyCode !== undefined
      ? normalizeCurrencyCode(body.currencyCode)
      : undefined;
    if (body.currencyCode !== undefined && !normalizedCurrency) {
      return reply.status(400).send({ message: 'currencyCode must be a valid 3-letter ISO code.' });
    }

    const updated = await db.business.update({
      where: { id: auth.businessId },
      data: {
        businessName: body.businessName ? normalizeName(body.businessName) : undefined,
        businessType: body.businessType === undefined ? undefined : body.businessType,
        currencyCode: normalizedCurrency ?? undefined,
        timezone: body.timezone === undefined || body.timezone === null ? undefined : body.timezone,
        enabledPaymentMethods: body.enabledPaymentMethods === undefined
          ? undefined
          : body.enabledPaymentMethods === null
            ? Prisma.JsonNull
            : body.enabledPaymentMethods,
        onboardingCompletedAt: body.onboardingCompleted === true ? new Date() : undefined
      }
    });

    await db.user.updateMany({
      where: { activeBusinessId: auth.businessId },
      data: {
        businessName: updated.businessName,
        businessType: updated.businessType,
        currencyCode: updated.currencyCode,
        timezone: updated.timezone
      }
    });

    const countRows = await db.$transaction([
      db.productService.count({ where: { businessId: auth.businessId, isActive: true } }),
      db.customer.count({ where: { businessId: auth.businessId, isActive: true } }),
      db.supplier.count({ where: { businessId: auth.businessId, isActive: true } }),
      db.businessCategory.count({ where: { businessId: auth.businessId, isActive: true } }),
      db.ledgerAccount.count({ where: { businessId: auth.businessId, isActive: true } })
    ]);

    const setupCounts: SetupCounts = {
      products: countRows[0],
      customers: countRows[1],
      suppliers: countRows[2],
      categories: countRows[3],
      ledgerAccounts: countRows[4]
    };

    return toProfileResponse(updated, setupCounts);
  });

  fastify.post('/bootstrap-defaults', async (request, reply) => {
    const auth = await requirePermission(request, reply, 'settings:manage');
    if (!auth) return;

    const business = await db.business.findUnique({
      where: { id: auth.businessId },
      select: { businessType: true }
    });
    if (!business) return reply.status(404).send({ message: 'Business not found.' });

    await db.$transaction(async (tx) => {
      await bootstrapBusinessDefaults(tx, {
        businessId: auth.businessId,
        businessType: business.businessType,
        includeLedger: config.DEFAULT_LEDGER_V1_ENABLED
      });
    });

    return { success: true };
  });

  fastify.get('/categories', async (request, reply) => {
    const auth = await requirePermission(request, reply, 'settings:view');
    if (!auth) return;

    const list = await db.businessCategory.findMany({
      where: { businessId: auth.businessId },
      orderBy: [{ kind: 'asc' }, { name: 'asc' }]
    });
    return list;
  });

  fastify.post('/categories', async (request, reply) => {
    const auth = await requirePermission(request, reply, 'masterdata:manage');
    if (!auth) return;

    const body = request.body as {
      kind?: BusinessCategoryKind;
      name?: string;
    };

    if (!body.kind || !isCategoryKind(body.kind) || !body.name) {
      return reply.status(400).send({ message: 'kind and name are required.' });
    }

    const name = normalizeName(body.name);
    if (!name) return reply.status(400).send({ message: 'name is required.' });

    const created = await db.businessCategory.upsert({
      where: {
        businessId_kind_normalizedName: {
          businessId: auth.businessId,
          kind: body.kind,
          normalizedName: normalizeLookup(name)
        }
      },
      update: {
        name,
        isActive: true
      },
      create: {
        businessId: auth.businessId,
        kind: body.kind,
        name,
        normalizedName: normalizeLookup(name)
      }
    });

    reply.status(201);
    return created;
  });

  fastify.patch('/categories/:id', async (request, reply) => {
    const auth = await requirePermission(request, reply, 'masterdata:manage');
    if (!auth) return;

    const params = request.params as { id?: string };
    if (!params.id) return reply.status(400).send({ message: 'Category id is required.' });

    const existing = await db.businessCategory.findFirst({
      where: {
        id: params.id,
        businessId: auth.businessId
      }
    });
    if (!existing) return reply.status(404).send({ message: 'Category not found.' });

    const body = request.body as {
      kind?: BusinessCategoryKind;
      name?: string;
      isActive?: boolean;
    };

    if (body.kind !== undefined && !isCategoryKind(body.kind)) {
      return reply.status(400).send({ message: 'kind must be sales or expense.' });
    }

    const normalizedName = body.name !== undefined ? normalizeName(body.name) : undefined;
    if (body.name !== undefined && !normalizedName) {
      return reply.status(400).send({ message: 'name cannot be empty.' });
    }
    if (existing.isDefault && body.isActive === false) {
      return reply.status(400).send({ message: 'Default categories cannot be deactivated.' });
    }

    try {
      const updated = await db.businessCategory.update({
        where: { id: existing.id },
        data: {
          kind: body.kind,
          name: normalizedName,
          normalizedName: normalizedName ? normalizeLookup(normalizedName) : undefined,
          isActive: body.isActive
        }
      });
      return updated;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return reply.status(409).send({ message: 'A category with this name already exists.' });
      }
      throw error;
    }
  });

  fastify.patch('/categories/:id/deactivate', async (request, reply) => {
    const auth = await requirePermission(request, reply, 'masterdata:manage');
    if (!auth) return;

    const params = request.params as { id?: string };
    if (!params.id) return reply.status(400).send({ message: 'Category id is required.' });

    const existing = await db.businessCategory.findFirst({
      where: {
        id: params.id,
        businessId: auth.businessId
      }
    });
    if (!existing) return reply.status(404).send({ message: 'Category not found.' });
    if (existing.isDefault) {
      return reply.status(400).send({ message: 'Default categories cannot be deactivated.' });
    }

    const updated = await db.businessCategory.update({
      where: { id: existing.id },
      data: { isActive: false }
    });
    return updated;
  });

  fastify.get('/products-services', async (request, reply) => {
    const auth = await requirePermission(request, reply, 'settings:view');
    if (!auth) return;

    const list = await db.productService.findMany({
      where: { businessId: auth.businessId },
      include: { category: true },
      orderBy: [{ type: 'asc' }, { name: 'asc' }]
    });
    return list;
  });

  fastify.post('/products-services', async (request, reply) => {
    const auth = await requirePermission(request, reply, 'masterdata:manage');
    if (!auth) return;

    const body = request.body as {
      name?: string;
      type?: ProductServiceType;
      defaultPrice?: number | null;
      estimatedCost?: number | null;
      categoryId?: string | null;
    };

    if (!body.name || !body.type || !isProductServiceType(body.type)) {
      return reply.status(400).send({ message: 'name and type are required (product|service).' });
    }

    const name = normalizeName(body.name);
    if (!name) return reply.status(400).send({ message: 'name is required.' });

    if (body.categoryId) {
      const category = await db.businessCategory.findFirst({
        where: {
          id: body.categoryId,
          businessId: auth.businessId
        }
      });
      if (!category) return reply.status(404).send({ message: 'categoryId is invalid for this workspace.' });
    }

    const created = await db.productService.upsert({
      where: {
        businessId_normalizedName: {
          businessId: auth.businessId,
          normalizedName: normalizeLookup(name)
        }
      },
      update: {
        name,
        type: body.type,
        defaultPrice: toOptionalNumber(body.defaultPrice),
        estimatedCost: toOptionalNumber(body.estimatedCost),
        categoryId: body.categoryId ?? null,
        isActive: true
      },
      create: {
        businessId: auth.businessId,
        name,
        normalizedName: normalizeLookup(name),
        type: body.type,
        defaultPrice: toOptionalNumber(body.defaultPrice) ?? null,
        estimatedCost: toOptionalNumber(body.estimatedCost) ?? null,
        categoryId: body.categoryId ?? null
      },
      include: { category: true }
    });

    reply.status(201);
    return created;
  });

  fastify.patch('/products-services/:id', async (request, reply) => {
    const auth = await requirePermission(request, reply, 'masterdata:manage');
    if (!auth) return;

    const params = request.params as { id?: string };
    if (!params.id) return reply.status(400).send({ message: 'Product/service id is required.' });

    const existing = await db.productService.findFirst({
      where: {
        id: params.id,
        businessId: auth.businessId
      }
    });
    if (!existing) return reply.status(404).send({ message: 'Product/service not found.' });

    const body = request.body as {
      name?: string;
      type?: ProductServiceType;
      defaultPrice?: number | null;
      estimatedCost?: number | null;
      categoryId?: string | null;
      isActive?: boolean;
    };

    if (body.type !== undefined && !isProductServiceType(body.type)) {
      return reply.status(400).send({ message: 'type must be product or service.' });
    }

    const name = body.name !== undefined ? normalizeName(body.name) : undefined;
    if (body.name !== undefined && !name) return reply.status(400).send({ message: 'name cannot be empty.' });

    const defaultPrice = toOptionalNumber(body.defaultPrice);
    if (body.defaultPrice !== undefined && defaultPrice === undefined) {
      return reply.status(400).send({ message: 'defaultPrice must be numeric.' });
    }
    const estimatedCost = toOptionalNumber(body.estimatedCost);
    if (body.estimatedCost !== undefined && estimatedCost === undefined) {
      return reply.status(400).send({ message: 'estimatedCost must be numeric.' });
    }

    if (body.categoryId !== undefined && body.categoryId !== null) {
      const category = await db.businessCategory.findFirst({
        where: {
          id: body.categoryId,
          businessId: auth.businessId
        }
      });
      if (!category) return reply.status(404).send({ message: 'categoryId is invalid for this workspace.' });
    }

    try {
      const updated = await db.productService.update({
        where: { id: existing.id },
        data: {
          name,
          normalizedName: name ? normalizeLookup(name) : undefined,
          type: body.type,
          defaultPrice,
          estimatedCost,
          categoryId: body.categoryId === undefined ? undefined : body.categoryId,
          isActive: body.isActive
        },
        include: { category: true }
      });
      return updated;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return reply.status(409).send({ message: 'A product/service with this name already exists.' });
      }
      throw error;
    }
  });

  fastify.patch('/products-services/:id/deactivate', async (request, reply) => {
    const auth = await requirePermission(request, reply, 'masterdata:manage');
    if (!auth) return;

    const params = request.params as { id?: string };
    if (!params.id) return reply.status(400).send({ message: 'Product/service id is required.' });

    const existing = await db.productService.findFirst({
      where: {
        id: params.id,
        businessId: auth.businessId
      }
    });
    if (!existing) return reply.status(404).send({ message: 'Product/service not found.' });

    const updated = await db.productService.update({
      where: { id: existing.id },
      data: { isActive: false },
      include: { category: true }
    });
    return updated;
  });

  fastify.get('/customers', async (request, reply) => {
    const auth = await requirePermission(request, reply, 'settings:view');
    if (!auth) return;

    const list = await db.customer.findMany({
      where: { businessId: auth.businessId },
      orderBy: { name: 'asc' }
    });
    return list;
  });

  fastify.post('/customers', async (request, reply) => {
    const auth = await requirePermission(request, reply, 'masterdata:manage');
    if (!auth) return;

    const body = request.body as {
      name?: string;
      phoneNumber?: string | null;
      notes?: string | null;
      openingReceivable?: number | null;
    };

    if (!body.name) return reply.status(400).send({ message: 'name is required.' });
    const name = normalizeName(body.name);
    if (!name) return reply.status(400).send({ message: 'name is required.' });

    const created = await db.customer.upsert({
      where: {
        businessId_normalizedName: {
          businessId: auth.businessId,
          normalizedName: normalizeLookup(name)
        }
      },
      update: {
        name,
        phoneNumber: body.phoneNumber ?? null,
        notes: body.notes ?? null,
        openingReceivable: toOptionalNumber(body.openingReceivable) ?? 0,
        isActive: true
      },
      create: {
        businessId: auth.businessId,
        name,
        normalizedName: normalizeLookup(name),
        phoneNumber: body.phoneNumber ?? null,
        notes: body.notes ?? null,
        openingReceivable: toOptionalNumber(body.openingReceivable) ?? 0
      }
    });

    reply.status(201);
    return created;
  });

  fastify.patch('/customers/:id', async (request, reply) => {
    const auth = await requirePermission(request, reply, 'masterdata:manage');
    if (!auth) return;

    const params = request.params as { id?: string };
    if (!params.id) return reply.status(400).send({ message: 'Customer id is required.' });

    const existing = await db.customer.findFirst({
      where: {
        id: params.id,
        businessId: auth.businessId
      }
    });
    if (!existing) return reply.status(404).send({ message: 'Customer not found.' });

    const body = request.body as {
      name?: string;
      phoneNumber?: string | null;
      notes?: string | null;
      openingReceivable?: number | null;
      isActive?: boolean;
    };

    const name = body.name !== undefined ? normalizeName(body.name) : undefined;
    if (body.name !== undefined && !name) return reply.status(400).send({ message: 'name cannot be empty.' });

    const openingReceivable = toOptionalNumber(body.openingReceivable);
    if (body.openingReceivable !== undefined && openingReceivable === undefined) {
      return reply.status(400).send({ message: 'openingReceivable must be numeric.' });
    }

    try {
      const updated = await db.customer.update({
        where: { id: existing.id },
        data: {
          name,
          normalizedName: name ? normalizeLookup(name) : undefined,
          phoneNumber: toOptionalText(body.phoneNumber),
          notes: toOptionalText(body.notes),
          openingReceivable: openingReceivable ?? undefined,
          isActive: body.isActive
        }
      });
      return updated;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return reply.status(409).send({ message: 'A customer with this name already exists.' });
      }
      throw error;
    }
  });

  fastify.patch('/customers/:id/deactivate', async (request, reply) => {
    const auth = await requirePermission(request, reply, 'masterdata:manage');
    if (!auth) return;

    const params = request.params as { id?: string };
    if (!params.id) return reply.status(400).send({ message: 'Customer id is required.' });

    const existing = await db.customer.findFirst({
      where: {
        id: params.id,
        businessId: auth.businessId
      }
    });
    if (!existing) return reply.status(404).send({ message: 'Customer not found.' });

    const updated = await db.customer.update({
      where: { id: existing.id },
      data: { isActive: false }
    });
    return updated;
  });

  fastify.get('/suppliers', async (request, reply) => {
    const auth = await requirePermission(request, reply, 'settings:view');
    if (!auth) return;

    const list = await db.supplier.findMany({
      where: { businessId: auth.businessId },
      orderBy: { name: 'asc' }
    });
    return list;
  });

  fastify.get('/ledger-accounts', async (request, reply) => {
    const auth = await requirePermission(request, reply, 'ledger:view');
    if (!auth) return;

    const accounts = await db.ledgerAccount.findMany({
      where: {
        businessId: auth.businessId,
        isActive: true
      },
      orderBy: [{ accountType: 'asc' }, { code: 'asc' }, { name: 'asc' }]
    });

    return accounts;
  });

  fastify.post('/ledger-accounts', async (request, reply) => {
    const auth = await requirePermission(request, reply, 'settings:manage');
    if (!auth) return;

    const body = request.body as {
      code?: string;
      name?: string;
      accountType?: 'asset' | 'liability' | 'equity' | 'income' | 'expense';
      parentId?: string | null;
    };

    const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
    const name = typeof body.name === 'string' ? normalizeName(body.name) : '';
    if (!code || !/^[A-Z0-9\-]{2,20}$/.test(code)) {
      return reply.status(400).send({ message: 'code is required (2-20 chars, letters/numbers/-).' });
    }
    if (!name) {
      return reply.status(400).send({ message: 'name is required.' });
    }
    if (!isLedgerAccountType(body.accountType)) {
      return reply.status(400).send({ message: 'accountType must be asset, liability, equity, income, or expense.' });
    }

    let parentId: string | null = null;
    if (body.parentId) {
      const parent = await db.ledgerAccount.findFirst({
        where: {
          id: body.parentId,
          businessId: auth.businessId,
          isActive: true
        },
        select: { id: true, accountType: true }
      });
      if (!parent) {
        return reply.status(404).send({ message: 'parentId does not exist in this workspace.' });
      }
      if (parent.accountType !== body.accountType) {
        return reply.status(400).send({ message: 'parent ledger must have the same accountType.' });
      }
      parentId = parent.id;
    }

    try {
      const created = await db.ledgerAccount.create({
        data: {
          businessId: auth.businessId,
          code,
          name,
          normalizedName: normalizeLookup(name),
          accountType: body.accountType,
          isSystemDefault: false,
          isActive: true,
          parentId
        }
      });
      reply.status(201);
      return created;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return reply.status(409).send({ message: 'A ledger with this code or name already exists.' });
      }
      throw error;
    }
  });

  fastify.patch('/ledger-accounts/:id', async (request, reply) => {
    const auth = await requirePermission(request, reply, 'settings:manage');
    if (!auth) return;

    const params = request.params as { id?: string };
    if (!params.id) return reply.status(400).send({ message: 'Ledger account id is required.' });

    const existing = await db.ledgerAccount.findFirst({
      where: {
        id: params.id,
        businessId: auth.businessId
      }
    });
    if (!existing) return reply.status(404).send({ message: 'Ledger account not found.' });
    if (existing.isSystemDefault) {
      return reply.status(400).send({ message: 'System default ledgers cannot be edited in this release.' });
    }

    const body = request.body as {
      code?: string;
      name?: string;
      parentId?: string | null;
      isActive?: boolean;
    };

    const code = body.code !== undefined ? body.code.trim().toUpperCase() : undefined;
    const name = body.name !== undefined ? normalizeName(body.name) : undefined;
    if (body.code !== undefined && (!code || !/^[A-Z0-9\-]{2,20}$/.test(code))) {
      return reply.status(400).send({ message: 'code must be 2-20 chars using letters, numbers, or -.' });
    }
    if (body.name !== undefined && !name) {
      return reply.status(400).send({ message: 'name cannot be empty.' });
    }

    let parentId: string | null | undefined = undefined;
    if (body.parentId !== undefined) {
      if (!body.parentId) {
        parentId = null;
      } else {
        if (body.parentId === existing.id) {
          return reply.status(400).send({ message: 'A ledger cannot be its own parent.' });
        }
        const parent = await db.ledgerAccount.findFirst({
          where: {
            id: body.parentId,
            businessId: auth.businessId,
            isActive: true
          },
          select: { id: true, accountType: true }
        });
        if (!parent) {
          return reply.status(404).send({ message: 'parentId does not exist in this workspace.' });
        }
        if (parent.accountType !== existing.accountType) {
          return reply.status(400).send({ message: 'parent ledger must have the same accountType.' });
        }
        parentId = parent.id;
      }
    }

    try {
      const updated = await db.ledgerAccount.update({
        where: { id: existing.id },
        data: {
          code,
          name,
          normalizedName: name ? normalizeLookup(name) : undefined,
          parentId,
          isActive: body.isActive
        }
      });
      return updated;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return reply.status(409).send({ message: 'A ledger with this code or name already exists.' });
      }
      throw error;
    }
  });

  fastify.patch('/ledger-accounts/:id/deactivate', async (request, reply) => {
    const auth = await requirePermission(request, reply, 'settings:manage');
    if (!auth) return;

    const params = request.params as { id?: string };
    if (!params.id) return reply.status(400).send({ message: 'Ledger account id is required.' });

    const existing = await db.ledgerAccount.findFirst({
      where: {
        id: params.id,
        businessId: auth.businessId
      }
    });
    if (!existing) return reply.status(404).send({ message: 'Ledger account not found.' });
    if (existing.isSystemDefault) {
      return reply.status(400).send({ message: 'System default ledgers cannot be deactivated.' });
    }

    const [childCount, usageCount] = await Promise.all([
      db.ledgerAccount.count({
        where: {
          businessId: auth.businessId,
          parentId: existing.id,
          isActive: true
        }
      }),
      db.ledgerJournalLine.count({
        where: { accountId: existing.id }
      })
    ]);
    if (childCount > 0) {
      return reply.status(400).send({ message: 'Deactivate child ledgers first.' });
    }
    if (usageCount > 0) {
      return reply.status(400).send({ message: 'Ledger already used in journal entries and cannot be deactivated.' });
    }

    const updated = await db.ledgerAccount.update({
      where: { id: existing.id },
      data: { isActive: false }
    });
    return updated;
  });

  fastify.get('/journal-entries', async (request, reply) => {
    const auth = await requirePermission(request, reply, 'ledger:view');
    if (!auth) return;

    const entries = await db.ledgerJournalEntry.findMany({
      where: {
        businessId: auth.businessId
      },
      include: {
        transaction: {
          select: {
            id: true,
            type: true,
            eventType: true,
            amount: true,
            date: true,
            ledgerPostingStatus: true
          }
        },
        lines: {
          include: {
            account: {
              select: {
                id: true,
                code: true,
                name: true,
                accountType: true
              }
            }
          },
          orderBy: [
            { debitAmount: 'desc' },
            { creditAmount: 'desc' },
            { createdAt: 'asc' }
          ]
        }
      },
      orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }],
      take: 25
    });

    return entries;
  });

  fastify.post('/journal-entries', async (request, reply) => {
    const auth = await requirePermission(request, reply, 'settings:manage');
    if (!auth) return;

    const body = request.body as {
      entryDate?: string;
      description?: string | null;
      lines?: Array<{
        accountId?: string;
        debitAmount?: number;
        creditAmount?: number;
        memo?: string | null;
      }>;
    };

    if (!Array.isArray(body.lines) || body.lines.length < 2) {
      return reply.status(400).send({ message: 'At least 2 journal lines are required.' });
    }

    const entryDate = body.entryDate ? new Date(body.entryDate) : new Date();
    if (Number.isNaN(entryDate.getTime())) {
      return reply.status(400).send({ message: 'entryDate is invalid.' });
    }

    const normalizedLines = body.lines.map((line) => ({
      accountId: line.accountId?.trim() ?? '',
      debitAmount: Number(line.debitAmount ?? 0),
      creditAmount: Number(line.creditAmount ?? 0),
      memo: toOptionalText(line.memo) ?? null
    }));

    if (normalizedLines.some((line) => !line.accountId)) {
      return reply.status(400).send({ message: 'Every line must include accountId.' });
    }
    if (normalizedLines.some((line) => !Number.isFinite(line.debitAmount) || !Number.isFinite(line.creditAmount))) {
      return reply.status(400).send({ message: 'debitAmount and creditAmount must be valid numbers.' });
    }
    if (normalizedLines.some((line) => line.debitAmount < 0 || line.creditAmount < 0)) {
      return reply.status(400).send({ message: 'debitAmount and creditAmount cannot be negative.' });
    }
    if (normalizedLines.some((line) => line.debitAmount > 0 && line.creditAmount > 0)) {
      return reply.status(400).send({ message: 'A line cannot have both debit and credit values.' });
    }
    if (normalizedLines.every((line) => line.debitAmount === 0 && line.creditAmount === 0)) {
      return reply.status(400).send({ message: 'At least one debit or credit amount must be greater than zero.' });
    }

    const totals = normalizedLines.reduce((acc, line) => ({
      debit: acc.debit + line.debitAmount,
      credit: acc.credit + line.creditAmount
    }), { debit: 0, credit: 0 });
    const difference = Math.abs(totals.debit - totals.credit);
    if (difference > 0.0001) {
      return reply.status(400).send({ message: 'Journal entry is not balanced. Total debits must equal total credits.' });
    }

    const accountIds = Array.from(new Set(normalizedLines.map((line) => line.accountId)));
    const accounts = await db.ledgerAccount.findMany({
      where: {
        businessId: auth.businessId,
        isActive: true,
        id: { in: accountIds }
      },
      select: { id: true }
    });
    if (accounts.length !== accountIds.length) {
      return reply.status(400).send({ message: 'One or more accounts are invalid or inactive for this workspace.' });
    }

    const manualEntryStatus: 'posted' | 'needs_review' = auth.role === 'owner' ? 'posted' : 'needs_review';

    const created = await db.ledgerJournalEntry.create({
      data: {
        businessId: auth.businessId,
        entryDate,
        description: toOptionalText(body.description) ?? null,
        status: manualEntryStatus,
        source: 'manual',
        createdByUserId: auth.userId,
        approvedByUserId: auth.role === 'owner' ? auth.userId : null,
        lines: {
          create: normalizedLines.map((line) => ({
            accountId: line.accountId,
            debitAmount: line.debitAmount,
            creditAmount: line.creditAmount,
            memo: line.memo
          }))
        }
      },
      include: {
        transaction: {
          select: {
            id: true,
            type: true,
            eventType: true,
            amount: true,
            date: true,
            ledgerPostingStatus: true
          }
        },
        lines: {
          include: {
            account: {
              select: {
                id: true,
                code: true,
                name: true,
                accountType: true
              }
            }
          },
          orderBy: [
            { debitAmount: 'desc' },
            { creditAmount: 'desc' },
            { createdAt: 'asc' }
          ]
        }
      }
    });

    reply.status(201);
    return created;
  });

  fastify.get('/balance-sheet', async (request, reply) => {
    const auth = await requirePermission(request, reply, 'ledger:view');
    if (!auth) return;

    const query = request.query as { asOf?: string };
    const asOf = query.asOf ? new Date(query.asOf) : new Date();
    if (Number.isNaN(asOf.getTime())) {
      return reply.status(400).send({ message: 'Invalid asOf date.' });
    }

    const snapshot = await computeBalanceSheetSnapshot(db, {
      businessId: auth.businessId,
      asOf
    });

    return snapshot;
  });

  fastify.get('/reconciliation-sessions', async (request, reply) => {
    const auth = await requirePermission(request, reply, 'ledger:view');
    if (!auth) return;

    const query = request.query as { channel?: 'cash' | 'momo'; limit?: string };
    const limit = Math.min(20, Math.max(1, Number(query.limit ?? 10) || 10));

    const sessions = await db.reconciliationSession.findMany({
      where: {
        businessId: auth.businessId,
        ...(query.channel === 'cash' || query.channel === 'momo' ? { channel: query.channel } : {})
      },
      include: {
        createdByUser: {
          select: {
            id: true,
            name: true,
            fullName: true
          }
        }
      },
      orderBy: [{ asOf: 'desc' }, { createdAt: 'desc' }],
      take: limit
    });

    return sessions;
  });

  fastify.post('/reconciliation-sessions', async (request, reply) => {
    const auth = await requirePermission(request, reply, 'settings:manage');
    if (!auth) return;

    const body = request.body as {
      channel?: 'cash' | 'momo';
      asOf?: string;
      bookBalance?: number;
      countedBalance?: number;
      notes?: string | null;
    };

    if (body.channel !== 'cash' && body.channel !== 'momo') {
      return reply.status(400).send({ message: 'channel must be cash or momo.' });
    }
    if (typeof body.bookBalance !== 'number' || Number.isNaN(body.bookBalance)) {
      return reply.status(400).send({ message: 'bookBalance must be a valid number.' });
    }
    if (typeof body.countedBalance !== 'number' || Number.isNaN(body.countedBalance)) {
      return reply.status(400).send({ message: 'countedBalance must be a valid number.' });
    }

    const asOf = body.asOf ? new Date(body.asOf) : new Date();
    if (Number.isNaN(asOf.getTime())) {
      return reply.status(400).send({ message: 'Invalid asOf date.' });
    }

    const created = await db.reconciliationSession.create({
      data: {
        businessId: auth.businessId,
        createdByUserId: auth.userId,
        channel: body.channel,
        asOf,
        bookBalance: body.bookBalance,
        countedBalance: body.countedBalance,
        variance: body.countedBalance - body.bookBalance,
        notes: toOptionalText(body.notes) ?? null
      },
      include: {
        createdByUser: {
          select: {
            id: true,
            name: true,
            fullName: true
          }
        }
      }
    });

    reply.status(201);
    return created;
  });

  fastify.post('/suppliers', async (request, reply) => {
    const auth = await requirePermission(request, reply, 'masterdata:manage');
    if (!auth) return;

    const body = request.body as {
      name?: string;
      phoneNumber?: string | null;
      supplyType?: string | null;
      notes?: string | null;
      openingPayable?: number | null;
    };

    if (!body.name) return reply.status(400).send({ message: 'name is required.' });
    const name = normalizeName(body.name);
    if (!name) return reply.status(400).send({ message: 'name is required.' });

    const created = await db.supplier.upsert({
      where: {
        businessId_normalizedName: {
          businessId: auth.businessId,
          normalizedName: normalizeLookup(name)
        }
      },
      update: {
        name,
        phoneNumber: body.phoneNumber ?? null,
        supplyType: body.supplyType ?? null,
        notes: body.notes ?? null,
        openingPayable: toOptionalNumber(body.openingPayable) ?? 0,
        isActive: true
      },
      create: {
        businessId: auth.businessId,
        name,
        normalizedName: normalizeLookup(name),
        phoneNumber: body.phoneNumber ?? null,
        supplyType: body.supplyType ?? null,
        notes: body.notes ?? null,
        openingPayable: toOptionalNumber(body.openingPayable) ?? 0
      }
    });

    reply.status(201);
    return created;
  });

  fastify.patch('/suppliers/:id', async (request, reply) => {
    const auth = await requirePermission(request, reply, 'masterdata:manage');
    if (!auth) return;

    const params = request.params as { id?: string };
    if (!params.id) return reply.status(400).send({ message: 'Supplier id is required.' });

    const existing = await db.supplier.findFirst({
      where: {
        id: params.id,
        businessId: auth.businessId
      }
    });
    if (!existing) return reply.status(404).send({ message: 'Supplier not found.' });

    const body = request.body as {
      name?: string;
      phoneNumber?: string | null;
      supplyType?: string | null;
      notes?: string | null;
      openingPayable?: number | null;
      isActive?: boolean;
    };

    const name = body.name !== undefined ? normalizeName(body.name) : undefined;
    if (body.name !== undefined && !name) return reply.status(400).send({ message: 'name cannot be empty.' });

    const openingPayable = toOptionalNumber(body.openingPayable);
    if (body.openingPayable !== undefined && openingPayable === undefined) {
      return reply.status(400).send({ message: 'openingPayable must be numeric.' });
    }

    try {
      const updated = await db.supplier.update({
        where: { id: existing.id },
        data: {
          name,
          normalizedName: name ? normalizeLookup(name) : undefined,
          phoneNumber: toOptionalText(body.phoneNumber),
          supplyType: toOptionalText(body.supplyType),
          notes: toOptionalText(body.notes),
          openingPayable: openingPayable ?? undefined,
          isActive: body.isActive
        }
      });
      return updated;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return reply.status(409).send({ message: 'A supplier with this name already exists.' });
      }
      throw error;
    }
  });

  fastify.patch('/suppliers/:id/deactivate', async (request, reply) => {
    const auth = await requirePermission(request, reply, 'masterdata:manage');
    if (!auth) return;

    const params = request.params as { id?: string };
    if (!params.id) return reply.status(400).send({ message: 'Supplier id is required.' });

    const existing = await db.supplier.findFirst({
      where: {
        id: params.id,
        businessId: auth.businessId
      }
    });
    if (!existing) return reply.status(404).send({ message: 'Supplier not found.' });

    const updated = await db.supplier.update({
      where: { id: existing.id },
      data: { isActive: false }
    });
    return updated;
  });
};

export default settingsRoutes;
