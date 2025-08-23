import type { MetadataTypes } from 'vectra';
import type { MessageParticipant } from './types/magi-types';

/**
 * Message types for inter-service communication
 */
export enum MessageType {
  REQUEST = 'request',
  RESPONSE = 'response',
  NOTIFICATION = 'notification',
  COMMAND = 'command',
  EVENT = 'event'
}


/**
 * Base message interface that extends Vectra's MetadataTypes
 * This allows the message to be stored as metadata in Vectra
 */
export interface QueueMessage extends Record<string, MetadataTypes> {
  /** Unique message identifier */
  id: string;
  
  /** Who sent the message */
  sender: MessageParticipant;
  
  /** Who should receive the message */
  recipient: MessageParticipant;
  
  /** Message content (can be any serializable data) */
  content: string;
  
  /** Type of message */
  type: MessageType;
  
  /** When the message was created (ISO string) */
  timestamp: string;
  
  /** Whether the message has been processed by the recipient */
  processed: boolean;
  
  /** Correlation ID for request/response patterns */
  correlationId: string;
  
  /** Priority level (higher numbers = higher priority) */
  priority: number;
  
  /** Expiration timestamp (ISO string) */
  expiresAt: string;
}

/**
 * Subscription callback function
 */
export type MessageCallback = (message: QueueMessage) => Promise<void> | void;

/**
 * Subscription handle for managing subscriptions
 */
export interface Subscription {
  /** Unique subscription ID */
  id: string;
  
  /** The participant who subscribed */
  participant: MessageParticipant;
  
  /** The callback function */
  callback: MessageCallback;
  
  /** Unsubscribe function */
  unsubscribe: () => void;
}

/**
 * Message queue configuration
 */
export interface MessageQueueConfig {
  /** Path to the Vectra index directory */
  indexPath?: string;
  
  /** Maximum number of processed messages to keep for history */
  maxProcessedMessages?: number;
  
  /** How often to run cleanup (in milliseconds) */
  cleanupInterval?: number;
  
  /** Default message expiration time (in milliseconds) */
  defaultExpirationMs?: number;
}

/**
 * Message queue statistics
 */
export interface QueueStats {
  /** Total number of messages in queue */
  totalMessages: number;
  
  /** Number of unprocessed messages */
  pendingMessages: number;
  
  /** Number of processed messages */
  processedMessages: number;
  
  /** Number of active subscriptions */
  activeSubscriptions: number;
  
  /** Messages per participant */
  messagesByParticipant: Record<MessageParticipant, number>;
}

/**
 * Message publish options
 */
export interface PublishOptions {
  /** Message priority (higher = more important) */
  priority?: number;
  
  /** Correlation ID for request/response tracking */
  correlationId?: string;
  
  /** Message expiration time in milliseconds from now */
  expirationMs?: number;
}