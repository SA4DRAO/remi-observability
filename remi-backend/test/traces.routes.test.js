const assert = require('node:assert/strict');
const { once } = require('node:events');
const test = require('node:test');

const express = require('express');

const { createTracesRoutes } = require('../dist/routes/traces.routes');
const { normalizeOtlpPayload } = require('../dist/services/otlp.service');
const { Logger } = require('../dist/services/logger');

function createOtlpPayload() {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            {
              key: 'session.id',
              value: { stringValue: 'session-otlp-route-test' },
            },
          ],
        },
        scopeSpans: [
          {
            scope: {
              name: 'route-test',
              version: '1.0.0',
            },
            spans: [
              {
                traceId: '0123456789abcdef0123456789abcdef',
                spanId: '0123456789abcdef',
                name: 'llm.generate',
                startTimeUnixNano: '1715356800000000000',
                endTimeUnixNano: '1715356801000000000',
              },
            ],
          },
        ],
      },
    ],
  };
}

function createOtlpPayloadWithoutSessionIdentity() {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            {
              key: 'service.namespace',
              value: { stringValue: 'org-without-session' },
            },
            {
              key: 'service.name',
              value: { stringValue: 'agent-without-session' },
            },
          ],
        },
        scopeSpans: [
          {
            scope: {
              name: 'route-test',
              version: '1.0.0',
            },
            spans: [
              {
                traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                spanId: 'bbbbbbbbbbbbbbbb',
                name: 'chain.invoke',
                startTimeUnixNano: '1715356800000000000',
                endTimeUnixNano: '1715356801000000000',
              },
            ],
          },
        ],
      },
    ],
  };
}

test('createTracesRoutes accepts the OTLP HTTP collector path alias', async (t) => {
  const originalApiKey = process.env.REMI_API_KEY;
  const originalWebhookSecret = process.env.REMI_WEBHOOK_SECRET;

  process.env.REMI_API_KEY = 'test-api-key';
  process.env.REMI_WEBHOOK_SECRET = '';

  t.after(() => {
    if (originalApiKey === undefined) {
      delete process.env.REMI_API_KEY;
    } else {
      process.env.REMI_API_KEY = originalApiKey;
    }

    if (originalWebhookSecret === undefined) {
      delete process.env.REMI_WEBHOOK_SECRET;
    } else {
      process.env.REMI_WEBHOOK_SECRET = originalWebhookSecret;
    }
  });

  const publishedBatches = [];
  const kafka = {
    publishEventBatch: async (sessionId, events, _unusedTopic, context) => {
      publishedBatches.push({ sessionId, events, context });
    },
  };

  const app = express();
  app.use(express.json());
  app.use('/api/v1/traces', createTracesRoutes(() => kafka, new Logger('error')));

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  t.after(
    () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      })
  );

  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, 'object');

  const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/traces/v1/traces`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': 'test-api-key',
    },
    body: JSON.stringify(createOtlpPayload()),
  });

  assert.equal(response.status, 202);

  const payload = await response.json();
  assert.deepEqual(payload, {
    success: true,
    data: {
      accepted: 1,
      sessions: 1,
    },
  });

  assert.equal(publishedBatches.length, 1);
  assert.equal(publishedBatches[0].sessionId, 'session-otlp-route-test');
  assert.equal(publishedBatches[0].events.length, 1);
  assert.equal(publishedBatches[0].events[0].event_type, 'otel_span');
  assert.ok(
    typeof publishedBatches[0].events[0].data.span_category === 'string',
    'span_category must be set on every emitted event'
  );
});

test('normalizeOtlpPayload propagates span-level Remi identity across a trace regardless of ordering', () => {
  const traceId = 'feedfacefeedfacefeedfacefeedface';
  const payload = {
    resourceSpans: [
      {
        resource: {
          attributes: [],
        },
        scopeSpans: [
          {
            scope: {
              name: 'route-test',
              version: '1.0.0',
            },
            spans: [
              {
                traceId,
                spanId: '1111111111111111',
                parentSpanId: '2222222222222222',
                name: 'tool.execute',
                startTimeUnixNano: '1715356800000000000',
                endTimeUnixNano: '1715356800500000000',
              },
            ],
          },
        ],
      },
      {
        resource: {
          attributes: [],
        },
        scopeSpans: [
          {
            scope: {
              name: 'route-test',
              version: '1.0.0',
            },
            spans: [
              {
                traceId,
                spanId: '2222222222222222',
                name: 'chain.invoke',
                startTimeUnixNano: '1715356799000000000',
                endTimeUnixNano: '1715356801000000000',
                attributes: [
                  {
                    key: 'remi.session_id',
                    value: { stringValue: 'session-from-span' },
                  },
                  {
                    key: 'remi.org_id',
                    value: { stringValue: 'org-from-span' },
                  },
                  {
                    key: 'remi.agent_id',
                    value: { stringValue: 'agent-from-span' },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  const batches = normalizeOtlpPayload(payload, 'webhook');

  assert.equal(batches.length, 1);
  assert.equal(batches[0].session_id, 'session-from-span');
  assert.equal(batches[0].org_id, 'org-from-span');
  assert.equal(batches[0].agent_id, 'agent-from-span');
  assert.equal(batches[0].events.length, 2);
  assert.deepEqual(
    batches[0].events.map((event) => event.data.span_id).sort(),
    ['1111111111111111', '2222222222222222']
  );
});

test('normalizeOtlpPayload drops spans that lack explicit session identity', () => {
  const batches = normalizeOtlpPayload(createOtlpPayloadWithoutSessionIdentity(), 'sdk');

  assert.deepEqual(batches, []);
});