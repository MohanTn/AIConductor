/**
 * WebSocket integration for real-time market research data updates
 * Enables dashboard consumers to subscribe to competitive analysis changes
 */

// Simple EventEmitter implementation for client-side WebSocket
class SimpleEventEmitter {
  private events: Map<string, Set<(...args: any[]) => void>> = new Map();

  on(event: string, listener: (...args: any[]) => void): this {
    if (!this.events.has(event)) {
      this.events.set(event, new Set());
    }
    this.events.get(event)!.add(listener);
    return this;
  }

  emit(event: string, ...args: any[]): boolean {
    const listeners = this.events.get(event);
    if (listeners) {
      listeners.forEach(listener => listener(...args));
      return true;
    }
    return false;
  }

  off(event: string, listener: (...args: any[]) => void): this {
    const listeners = this.events.get(event);
    if (listeners) {
      listeners.delete(listener);
    }
    return this;
  }
}

export interface MarketDataUpdateMessage {
  type: 'matrix_update' | 'gap_identified' | 'positioning_updated' | 'roadmap_changed';
  timestamp: number;
  featureSlug: string;
  data: any;
  source?: string;
}

export interface MarketDataSubscription {
  featureSlug: string;
  messageTypes?: string[];
}

export class MarketDataWebSocketManager extends SimpleEventEmitter {
  private ws: WebSocket | null = null;
  private url: string;
  private messageQueue: MarketDataUpdateMessage[] = [];
  private isConnected = false;
  private subscriptions: Map<string, MarketDataSubscription> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000; // ms

  constructor(url?: string) {
    super();
    if (url) {
      this.url = url;
    } else {
      // Use try-catch to handle window reference safely
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const loc = (global as any).window?.location;
        if (loc) {
          const protocol = loc.protocol === 'https:' ? 'wss:' : 'ws:';
          this.url = `${protocol}//${loc.host}/ws/market-data`;
        } else {
          this.url = 'ws://localhost:5111/ws/market-data';
        }
      } catch {
        this.url = 'ws://localhost:5111/ws/market-data';
      }
    }
  }

  /**
   * Connect to WebSocket and establish market data stream
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // Check if WebSocket is available (client-side only)
        if (typeof WebSocket === 'undefined') {
          return reject(new Error('WebSocket not available in this environment'));
        }

        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          console.log('[MarketData WS] Connected');
          this.isConnected = true;
          this.reconnectAttempts = 0;
          this.flushMessageQueue();
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data) as MarketDataUpdateMessage;
            this.handleMessage(message);
          } catch (err) {
            console.error('[MarketData WS] Failed to parse message:', err);
          }
        };

        this.ws.onerror = (error) => {
          console.error('[MarketData WS] Error:', error);
          this.emit('error', error);
          reject(error);
        };

        this.ws.onclose = () => {
          console.log('[MarketData WS] Disconnected');
          this.isConnected = false;
          this.attemptReconnect();
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Disconnect from WebSocket
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.isConnected = false;
    }
  }

  /**
   * Subscribe to market data updates for a specific feature
   */
  subscribe(subscription: MarketDataSubscription): void {
    this.subscriptions.set(subscription.featureSlug, subscription);

    if (this.isConnected && this.ws) {
      this.ws.send(JSON.stringify({
        action: 'subscribe',
        payload: subscription,
      }));
    }
  }

  /**
   * Unsubscribe from market data updates
   */
  unsubscribe(featureSlug: string): void {
    this.subscriptions.delete(featureSlug);

    if (this.isConnected && this.ws) {
      this.ws.send(JSON.stringify({
        action: 'unsubscribe',
        payload: { featureSlug },
      }));
    }
  }

  /**
   * Broadcast market data update to all connected clients
   * Called from backend when competitive matrix, gap analysis, or positioning changes
   */
  broadcastUpdate(message: MarketDataUpdateMessage): void {
    if (this.isConnected && this.ws) {
      this.ws.send(JSON.stringify({
        action: 'broadcast',
        payload: message,
      }));
    } else {
      this.messageQueue.push(message);
    }
  }

  /**
   * Request full competitive matrix data
   */
  requestCompetitiveMatrix(featureSlug: string): void {
    if (this.isConnected && this.ws) {
      this.ws.send(JSON.stringify({
        action: 'request',
        payload: {
          type: 'competitive_matrix',
          featureSlug,
        },
      }));
    }
  }

  /**
   * Request gap analysis data
   */
  requestGapAnalysis(featureSlug: string): void {
    if (this.isConnected && this.ws) {
      this.ws.send(JSON.stringify({
        action: 'request',
        payload: {
          type: 'gap_analysis',
          featureSlug,
        },
      }));
    }
  }

  /**
   * Internal: Handle incoming WebSocket message
   */
  private handleMessage(message: MarketDataUpdateMessage): void {
    // Emit to listeners subscribed to this feature slug
    this.emit(`update:${message.featureSlug}`, message);

    // Emit globally for message type
    this.emit(`${message.type}`, message);

    // Emit all messages to generic listener
    this.emit('message', message);
  }

  /**
   * Internal: Flush queued messages that arrived while disconnected
   */
  private flushMessageQueue(): void {
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      if (message) {
        this.handleMessage(message);
      }
    }
  }

  /**
   * Internal: Attempt to reconnect after disconnection
   */
  private attemptReconnect(): void {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
      console.log(`[MarketData WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

      setTimeout(() => {
        this.connect().catch((err) => {
          console.error('[MarketData WS] Reconnection failed:', err);
        });
      }, delay);
    } else {
      console.error('[MarketData WS] Max reconnection attempts reached');
      this.emit('reconnect_failed');
    }
  }

  /**
   * Check if WebSocket is currently connected
   */
  isReady(): boolean {
    return this.isConnected && this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Get current subscriptions
   */
  getSubscriptions(): MarketDataSubscription[] {
    return Array.from(this.subscriptions.values());
  }
}

/**
 * Global singleton instance for market data WebSocket
 */
let instance: MarketDataWebSocketManager | null = null;

export function getMarketDataWebSocketManager(): MarketDataWebSocketManager {
  if (!instance) {
    instance = new MarketDataWebSocketManager();
  }
  return instance;
}

export function resetMarketDataWebSocketManager(): void {
  if (instance) {
    instance.disconnect();
    instance = null;
  }
}
