#!/usr/bin/env python3
"""
Verify that events are being published to Kafka
Consumes messages from the remi-events topic and displays them
"""

import os
import sys
import json
import signal
from datetime import datetime
from typing import Dict, Any

try:
    from kafka import KafkaConsumer
except ImportError:
    print("❌ kafka-python not installed. Installing...")
    os.system(f"{sys.executable} -m pip install kafka-python")
    from kafka import KafkaConsumer

# Configuration
KAFKA_BROKERS = os.getenv("KAFKA_BROKERS", "localhost:9092")  # External port
KAFKA_TOPIC = os.getenv("KAFKA_EVENT_TOPIC", "remi-events")
GROUP_ID = f"verification-consumer-{datetime.now().strftime('%Y%m%d-%H%M%S')}"

# Track stats
message_count = 0
event_types = {}
sessions = set()

def signal_handler(sig, frame):
    """Handle Ctrl+C gracefully"""
    print(f"\n\n📊 Final Statistics:")
    print(f"   Total messages: {message_count}")
    print(f"   Unique sessions: {len(sessions)}")
    print(f"\n📈 Event types:")
    for event_type, count in sorted(event_types.items(), key=lambda x: x[1], reverse=True):
        print(f"   - {event_type}: {count}")
    sys.exit(0)

signal.signal(signal.SIGINT, signal_handler)

def main():
    print("🔍 Kafka Event Verification Tool")
    print("=" * 60)
    print(f"📍 Broker: {KAFKA_BROKERS}")
    print(f"📍 Topic: {KAFKA_TOPIC}")
    print(f"📍 Group ID: {GROUP_ID}")
    print("=" * 60)
    
    try:
        # Create consumer
        print("\n🔌 Connecting to Kafka...")
        consumer = KafkaConsumer(
            KAFKA_TOPIC,
            bootstrap_servers=KAFKA_BROKERS.split(','),
            group_id=GROUP_ID,
            auto_offset_reset='earliest',  # Read from beginning
            enable_auto_commit=True,
            value_deserializer=lambda m: json.loads(m.decode('utf-8')),
            consumer_timeout_ms=10000,  # 10 second timeout
        )
        print("✅ Connected to Kafka\n")
        
        print("📨 Reading messages (Ctrl+C to stop)...\n")
        
        global message_count, event_types, sessions
        
        for message in consumer:
            message_count += 1
            value = message.value
            
            # Extract event info
            event_type = value.get('event_type', 'unknown')
            session_id = value.get('session_id', 'unknown')
            data = value.get('data', {})
            timestamp = value.get('timestamp', data.get('ts', 'N/A'))
            
            # Track stats
            event_types[event_type] = event_types.get(event_type, 0) + 1
            sessions.add(session_id)
            
            # Display message
            print(f"📬 Message #{message_count}")
            print(f"   Partition: {message.partition}, Offset: {message.offset}")
            print(f"   Session: {session_id[:16]}...")
            print(f"   Type: {event_type}")
            print(f"   Timestamp: {timestamp}")
            
            # Show some data details
            if event_type == 'tool_start':
                print(f"   Tool: {data.get('tool', 'N/A')}")
            elif event_type == 'llm_start':
                print(f"   Model: {data.get('model', 'N/A')}")
            elif event_type == 'chain_start':
                print(f"   Chain: {data.get('name', 'N/A')}")
            
            print()
        
        # Timeout reached - no more messages
        print("\n⏱️  No more messages in topic (10 second timeout)")
        
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return 1
    
    finally:
        # Print summary
        print(f"\n\n📊 Summary:")
        print(f"   Total messages consumed: {message_count}")
        print(f"   Unique sessions: {len(sessions)}")
        
        if event_types:
            print(f"\n📈 Event types breakdown:")
            for event_type, count in sorted(event_types.items(), key=lambda x: x[1], reverse=True):
                print(f"   - {event_type}: {count}")
        
        if message_count == 0:
            print("\n⚠️  No messages found in Kafka topic!")
            print("   Possible reasons:")
            print("   1. Backend is not publishing to Kafka")
            print("   2. KafkaService is not initialized")
            print("   3. Wrong broker address or topic name")
            print("   4. Agent hasn't sent any events yet")
            print("\n💡 Try running the customer_support_agent.py first")
        else:
            print(f"\n✅ Successfully verified {message_count} events in Kafka!")
    
    return 0

if __name__ == "__main__":
    sys.exit(main())
