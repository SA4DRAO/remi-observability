const assert = require('node:assert/strict');
const test = require('node:test');

const { KafkaService } = require('../dist/services/kafka.service');

const logger = {
  info() {},
  debug() {},
  warn() {},
  error() {},
};

test('publishEventBatch includes org_id in Kafka messages', async () => {
  const service = new KafkaService(logger);
  service.producer = {};

  let publishedTopic = null;
  let publishedMessages = null;

  service.publishEvent = async (topic, events) => {
    publishedTopic = topic;
    publishedMessages = events;
  };

  await service.publishEventBatch(
    'session-123',
    [{ event_type: 'llm_start', data: { model: 'gpt-4o' } }],
    undefined,
    { requestId: 'req-1', orgId: 'org-123' }
  );

  assert.equal(publishedTopic, 'remi-events');
  assert.equal(Array.isArray(publishedMessages), true);
  assert.equal(publishedMessages.length, 1);

  const payload = JSON.parse(publishedMessages[0].value);
  assert.equal(payload.session_id, 'session-123');
  assert.equal(payload.org_id, 'org-123');
  assert.equal(payload.ingest_request_id, 'req-1');
});