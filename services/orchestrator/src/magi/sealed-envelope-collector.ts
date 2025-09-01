import { logger } from '../logger';
import { MagiName } from '../types/magi-types';
import { MessageParticipant } from '../types/magi-types';
import type { MessageQueueService } from '../../../message-queue/src/MessageQueueService';
import type { Subscription } from '../../../message-queue/src/types';

export interface MagiResponses {
  balthazar: string;
  melchior: string;
  caspar: string;
}

/**
 * Simple, dedicated collector for sealed envelope responses from all three Magi.
 * Uses a linear approach: set up subscriptions, wait for all responses, clean up.
 */
export class SealedEnvelopeCollector {
  private responses = new Map<MagiName, string>();
  private subscriptions: Subscription[] = [];
  private timeoutHandle?: NodeJS.Timeout;
  private isComplete = false;

  /**
   * Collect responses from all three Magi with a simple, linear approach
   */
  async collect(messageQueue: MessageQueueService, timeoutMs: number = 30000): Promise<MagiResponses> {
    return new Promise<MagiResponses>((resolve, reject) => {
      const magiNames = [MagiName.Balthazar, MagiName.Melchior, MagiName.Caspar];
      
      // Set up cleanup function
      const cleanup = () => {
        if (this.timeoutHandle) {
          clearTimeout(this.timeoutHandle);
          this.timeoutHandle = undefined;
        }
        this.subscriptions.forEach(sub => {
          try { 
            sub.unsubscribe(); 
          } catch (e) { 
            logger.debug(`Error unsubscribing: ${e}`);
          }
        });
        this.subscriptions = [];
      };

      // Set up completion check
      const checkCompletion = () => {
        if (this.isComplete) return;
        
        if (this.responses.size === 3) {
          this.isComplete = true;
          cleanup();
          
          const result: MagiResponses = {
            balthazar: this.responses.get(MagiName.Balthazar)!,
            melchior: this.responses.get(MagiName.Melchior)!,
            caspar: this.responses.get(MagiName.Caspar)!
          };
          
          logger.debug(`Sealed envelope collection complete: collected ${this.responses.size}/3 responses`);
          resolve(result);
        }
      };

      // Set up timeout
      this.timeoutHandle = setTimeout(() => {
        if (!this.isComplete) {
          this.isComplete = true;
          cleanup();
          
          const missing = magiNames.filter(name => !this.responses.has(name));
          const received = magiNames.filter(name => this.responses.has(name));
          
          logger.error(`Sealed envelope collection timeout: received responses from [${received.join(', ')}], missing [${missing.join(', ')}]`);
          reject(new Error(`Timeout waiting for sealed envelope responses from: ${missing.join(', ')}`));
        }
      }, timeoutMs);

      // Set up subscriptions for each Magi
      magiNames.forEach(magiName => {
        const subscription = messageQueue.subscribe(MessageParticipant.System, async (message) => {
          if (this.isComplete) return;
          
          // Check if this message is from the expected Magi and we don't already have their response
          if (message.sender === magiName && !this.responses.has(magiName)) {
            this.responses.set(magiName, message.content);
            logger.debug(`Collected sealed envelope response from ${magiName} (${this.responses.size}/3)`);
            checkCompletion();
          }
        });
        
        this.subscriptions.push(subscription);
      });

      logger.debug(`Set up sealed envelope collection subscriptions for: ${magiNames.join(', ')}`);
    });
  }

  /**
   * Get current collection status for debugging
   */
  getStatus(): { collected: MagiName[]; missing: MagiName[]; total: number } {
    const allMagi = [MagiName.Balthazar, MagiName.Melchior, MagiName.Caspar];
    const collected = allMagi.filter(name => this.responses.has(name));
    const missing = allMagi.filter(name => !this.responses.has(name));
    
    return {
      collected,
      missing,
      total: this.responses.size
    };
  }
}