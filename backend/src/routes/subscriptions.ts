import type { FastifyPluginAsync } from 'fastify';
import {
  applySuccessfulSubscriptionPayment,
  getPaymentStatusFromReference,
  initializeSubscriptionPayment,
  verifyPaystackWebhookSignature
} from '../services/subscriptions.js';

const subscriptionsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/initialize', async (request, reply) => {
    const body = request.body as {
      userId?: string;
      months?: number;
      callbackUrl?: string;
      customerEmail?: string;
    };

    if (!body.userId) {
      return reply.status(400).send({ message: 'userId is required.' });
    }

    if (body.months !== undefined && (!Number.isFinite(body.months) || body.months < 1 || body.months > 24)) {
      return reply.status(400).send({ message: 'months must be between 1 and 24.' });
    }

    try {
      const initialized = await initializeSubscriptionPayment({
        userId: body.userId,
        months: body.months,
        callbackUrl: body.callbackUrl,
        customerEmail: body.customerEmail
      });
      return initialized;
    } catch (error) {
      fastify.log.error(error);
      return reply.status(400).send({ message: error instanceof Error ? error.message : 'Unable to initialize payment.' });
    }
  });

  fastify.post('/verify', async (request, reply) => {
    const body = request.body as { reference?: string };
    if (!body.reference) {
      return reply.status(400).send({ message: 'reference is required.' });
    }

    try {
      const result = await applySuccessfulSubscriptionPayment({
        reference: body.reference,
        source: 'client_verify',
        payload: body
      });
      return result;
    } catch (error) {
      fastify.log.error(error);
      return reply.status(400).send({ message: error instanceof Error ? error.message : 'Unable to verify payment.' });
    }
  });

  fastify.post('/webhook/paystack', async (request, reply) => {
    const signatureHeader = typeof request.headers['x-paystack-signature'] === 'string'
      ? request.headers['x-paystack-signature']
      : null;
    const rawBody = typeof request.body === 'string' ? request.body : null;

    try {
      if (signatureHeader && rawBody) {
        const signatureValid = await verifyPaystackWebhookSignature({
          signatureHeader,
          rawBody
        });
        if (!signatureValid) {
          return reply.status(401).send({ message: 'Invalid Paystack webhook signature.' });
        }
      }

      const body = (request.body ?? {}) as { event?: string; data?: { reference?: string } };
      const reference = body.data?.reference;
      if (!reference) {
        return reply.status(200).send({ received: true, ignored: true, reason: 'Missing payment reference.' });
      }

      if (body.event !== 'charge.success') {
        const currentStatus = await getPaymentStatusFromReference(reference);
        return reply.status(200).send({
          received: true,
          ignored: true,
          event: body.event ?? 'unknown',
          reference,
          paymentStatus: currentStatus
        });
      }

      const result = await applySuccessfulSubscriptionPayment({
        reference,
        source: 'webhook',
        payload: request.body
      });

      return reply.status(200).send({
        received: true,
        event: body.event,
        reference,
        status: result.status,
        applied: result.applied
      });
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ message: 'Unable to process Paystack webhook.' });
    }
  });
};

export default subscriptionsRoutes;
