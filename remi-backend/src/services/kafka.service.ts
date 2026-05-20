import { Kafka, Producer, logLevel } from 'kafkajs';
import { context, propagation } from '@opentelemetry/api';
import { Logger } from './logger';

/**
 * KafkaService — producer-only.
 *
 * The backend publishes ingested events to Kafka for downstream processing
 * by remi-worker.  It does NOT consume from Kafka; the worker is the sole
 * consumer (group: remi-worker-group).
 */
export class KafkaService {
  private kafka: Kafka | null = null;
  private producer: Producer | null = null;
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  private resolveEventsTopic(explicitTopic?: string): string {
    return explicitTopic || process.env.KAFKA_EVENTS_TOPIC || 'remi-events';
  }

  async initialize(): Promise<void> {
    const brokers = (process.env.KAFKA_BROKERS || 'kafka:29092').split(',');

    this.kafka = new Kafka({
      clientId: 'remi-backend',
      brokers,
      logLevel: logLevel.WARN,
    });

    this.producer = this.kafka.producer();

    try {
      await this.producer.connect();
      this.logger.info('Kafka producer connected', { brokers, clientId: 'remi-backend' });
    } catch (error) {
      this.logger.error('Failed to connect Kafka producer:', error);
      this.producer = null;
      throw error;
    }
  }

  async publishEvent(
    topic: string,
    events: Array<{ key?: string; value: string; headers?: Record<string, string> }>
  ): Promise<void> {
    if (!this.producer) {
      throw new Error('Kafka producer not initialized');
    }

    try {
      const started = Date.now();
      await this.producer.send({
        topic,
        messages: events,
      });
      this.logger.debug('Kafka publish succeeded', {
        topic,
        messages: events.length,
        durationMs: Date.now() - started,
      });
    } catch (error) {
      this.logger.error(`Failed to publish to topic ${topic}:`, error);
      throw error;
    }
  }

  async publishEventBatch(
    sessionId: string,
    events: Array<any>,
    topic?: string,
    metadata?: { requestId?: string; orgId?: string | null; agentId?: string | null }
  ): Promise<void> {
    if (!this.producer) {
      throw new Error('Kafka producer not initialized');
    }

    const resolvedTopic = this.resolveEventsTopic(topic);
    const firstSeq = events.length > 0 ? events[0]?._seq : null;
    const lastSeq = events.length > 0 ? events[events.length - 1]?._seq : null;

    // Inject W3C trace context (traceparent/tracestate) as Kafka message headers
    // so the worker can create child spans linked to this producer span.
    const traceCarrier: Record<string, string> = {};
    propagation.inject(context.active(), traceCarrier);

    const messages = events.map((event) => ({
      key: sessionId,
      value: JSON.stringify({
        ...event,
        session_id: sessionId,
        org_id:   metadata?.orgId   ?? null,
        agent_id: metadata?.agentId ?? null,
        ingest_request_id: metadata?.requestId || null,
        timestamp: new Date().toISOString(),
      }),
      headers: traceCarrier,
    }));

    this.logger.debug('Preparing Kafka batch publish', {
      sessionId,
      topic: resolvedTopic,
      eventsCount: events.length,
      firstSeq,
      lastSeq,
      orgId:   metadata?.orgId   ?? null,
      agentId: metadata?.agentId ?? null,
      requestId: metadata?.requestId || null,
    });

    // Validate message sizes BEFORE publishing
    const MAX_KAFKA_MESSAGE_BYTES = parseInt(process.env.KAFKA_MAX_MESSAGE_BYTES || '286720');
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      if (!message) continue;
      const messageBytes = Buffer.byteLength(message.value, 'utf8');
      if (messageBytes > MAX_KAFKA_MESSAGE_BYTES) {
        const parsed = JSON.parse(message.value);
        this.logger.error('Event exceeds Kafka message limit', {
          sessionId,
          eventIndex: i,
          eventType: parsed.event_type,
          seq: parsed.seq ?? null,
          sizeBytes: messageBytes,
          limitBytes: MAX_KAFKA_MESSAGE_BYTES,
        });
        throw new Error(
          `Event ${i} (type: ${parsed.event_type}, seq: ${parsed.seq ?? 'null'}) ` +
          `size ${messageBytes} bytes exceeds Kafka limit ${MAX_KAFKA_MESSAGE_BYTES} bytes`
        );
      }
    }

    await this.publishEvent(resolvedTopic, messages);
    this.logger.info(`Published ${messages.length} events to "${resolvedTopic}" (session: ${sessionId})`, {
      sessionId,
      topic: resolvedTopic,
      eventsCount: messages.length,
      firstSeq,
      lastSeq,
      orgId:   metadata?.orgId   ?? null,
      agentId: metadata?.agentId ?? null,
    });
  }

  async disconnect(): Promise<void> {
    if (this.producer) {
      await this.producer.disconnect();
      this.logger.info('Kafka producer disconnected');
    }
  }
}
