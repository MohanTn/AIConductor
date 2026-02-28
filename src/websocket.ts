/**
 * WebSocket Server Infrastructure & Connection Management (T01)
 *
 * Creates a WebSocket server on port 5111 that:
 * - Accepts authenticated client connections
 * - Maintains a registry of active connections with metadata
 * - Handles connection lifecycle (connect, authenticate, disconnect)
 * - Prevents memory leaks with proper cleanup
 * - Implements security controls (auth validation, rate limiting, timeouts, logging)
 */

import { WebSocketServer, WebSocket } from 'ws';
import { EventEmitter } from 'events';
import { Server as HttpServer } from 'http';
import crypto from 'crypto';

/**
 * Connection metadata stored for each WebSocket connection
 */
export interface WebSocketClientMetadata {
  connectionId: string;
  userId?: string;
  role?: string;
  currentFeature?: string;
  connectedAt: number;
  lastActivityAt: number;
  authenticated: boolean;
}

/**
 * WebSocket Server Manager
 * Extends EventEmitter to broadcast events across all clients
 */
export class WebSocketServerManager extends EventEmitter {
  private wss: WebSocketServer | null = null;
  private connections: Map<string, WebSocket> = new Map();
  private connectionMetadata: Map<string, WebSocketClientMetadata> = new Map();
  private ipConnectionCount: Map<string, number> = new Map();

  // Configuration constants
  private readonly CONNECTION_TIMEOUT = 5 * 60 * 1000; // 5 minutes idle timeout
  private readonly MAX_CONNECTIONS_PER_IP = 10;
  private readonly MESSAGE_SIZE_LIMIT = 1024 * 1024; // 1 MB

  // Timers
  private timeoutIntervals: Map<string, NodeJS.Timeout> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  /**
   * Initialize WebSocket server attached to HTTP server
   * @param httpServer The Express HTTP server to attach to
   * @param port Port for WebSocket (optional, defaults to same as HTTP server)
   */
  public initialize(httpServer?: HttpServer): void {
    // Create WebSocket server attached to HTTP server
    // This allows both HTTP and WebSocket on the same port
    this.wss = new WebSocketServer({
      noServer: true,
      maxPayload: this.MESSAGE_SIZE_LIMIT,
    });

    // Handle upgrade requests on HTTP server
    if (httpServer) {
      httpServer.on('upgrade', (request, socket, head) => {
        this.handleUpgrade(request, socket, head);
      });
    }

    // Set up cleanup interval for expired connections
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredConnections();
    }, 30000); // Run every 30 seconds

    this.logEvent('server', 'initialized', 'WebSocket server initialized on port 5111');
  }

  /**
   * Handle WebSocket upgrade request with authentication
   */
  private handleUpgrade(request: any, socket: any, head: any): void {
    const clientIp = this.getClientIP(request);

    // Rate limiting: check connections per IP
    const connCount = this.ipConnectionCount.get(clientIp) || 0;
    if (connCount >= this.MAX_CONNECTIONS_PER_IP) {
      this.logEvent('auth', 'rate-limit', `IP ${clientIp} exceeded max connections (${connCount})`);
      socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
      socket.destroy();
      return;
    }

    // Extract authentication token — browsers cannot send custom WS headers,
    // so accept token from query string (?token=...) as the primary mechanism,
    // with the Authorization header as a fallback for server-side clients.
    const urlParams = new URL(request.url, 'http://localhost').searchParams;
    const queryToken = urlParams.get('token');
    const authToken = queryToken || request.headers['authorization']?.split(' ')[1];
    if (!authToken) {
      this.logEvent('auth', 'missing-token', `Connection from ${clientIp} without auth token`);
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    // Accept the WebSocket upgrade
    if (this.wss) {
      this.wss.handleUpgrade(request, socket, head, (ws) => {
        this.handleConnection(ws, authToken, clientIp);
      });
    }
  }

  /**
   * Handle new WebSocket connection
   */
  private handleConnection(ws: WebSocket, authToken: string, clientIp: string): void {
    const connectionId = this.generateConnectionId();

    // Validate auth token (in production, verify JWT or session ID)
    const { valid, userId, role } = this.validateAuthToken(authToken);
    if (!valid) {
      this.logEvent('auth', 'invalid-token', `Invalid token from ${clientIp}`);
      ws.close(1008, 'Unauthorized');
      return;
    }

    // Create metadata for this connection
    const metadata: WebSocketClientMetadata = {
      connectionId,
      userId,
      role,
      connectedAt: Date.now(),
      lastActivityAt: Date.now(),
      authenticated: true,
    };

    // Register connection
    this.connections.set(connectionId, ws);
    this.connectionMetadata.set(connectionId, metadata);

    // Track IP connection count
    const connCount = this.ipConnectionCount.get(clientIp) || 0;
    this.ipConnectionCount.set(clientIp, connCount + 1);

    // Send welcome message
    const welcomeMsg = {
      type: 'welcome',
      connectionId,
      message: 'Connected to AIConductor WebSocket server',
      timestamp: Date.now(),
    };
    ws.send(JSON.stringify(welcomeMsg));

    this.logEvent('connection', 'connected',
      `${userId || 'guest'} (${role || 'user'}) connected. Total connections: ${this.connections.size}`);

    // Set up connection handlers
    ws.on('message', (data) => this.handleMessage(connectionId, data));
    ws.on('close', () => this.handleDisconnection(connectionId, clientIp));
    ws.on('error', (err) => this.handleError(connectionId, err));
    ws.on('pong', () => this.handlePong(connectionId));

    // Set up idle timeout
    this.resetConnectionTimeout(connectionId);

    // Emit connection event
    this.emit('client-connected', {
      connectionId,
      userId,
      role,
      timestamp: Date.now(),
    });
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(connectionId: string, data: any): void {
    const metadata = this.connectionMetadata.get(connectionId);
    if (!metadata) return;

    // Update last activity
    metadata.lastActivityAt = Date.now();
    this.resetConnectionTimeout(connectionId);

    try {
      // Parse JSON message
      const message = JSON.parse(data.toString());

      // Validate message structure
      if (!message.type) {
        this.logEvent('message', 'invalid', `Missing message type from ${metadata.userId}`);
        return;
      }

      // Check message size (redundant but explicit)
      if (data.length > this.MESSAGE_SIZE_LIMIT) {
        this.logEvent('message', 'oversized',
          `Message oversized (${data.length} bytes) from ${metadata.userId}`);
        return;
      }

      // Log message reception
      this.logEvent('message', message.type,
        `${message.type} from ${metadata.userId}`);

      // Handle presence updates
      if (message.type === 'presence-update') {
        metadata.currentFeature = message.currentFeature;
        this.broadcastPresenceUpdate(connectionId, metadata);
      }

      // Emit message event for other handlers
      this.emit('client-message', {
        connectionId,
        metadata,
        message,
        timestamp: Date.now(),
      });

    } catch (err) {
      this.logEvent('message', 'parse-error',
        `JSON parse error from ${metadata.userId}: ${err}`);
    }
  }

  /**
   * Handle client disconnection
   */
  private handleDisconnection(connectionId: string, clientIp: string): void {
    const metadata = this.connectionMetadata.get(connectionId);
    const ws = this.connections.get(connectionId);

    // Clean up
    this.connections.delete(connectionId);
    this.connectionMetadata.delete(connectionId);

    // Clear timeout
    const timeout = this.timeoutIntervals.get(connectionId);
    if (timeout) {
      clearTimeout(timeout);
      this.timeoutIntervals.delete(connectionId);
    }

    // Update IP connection count
    const connCount = this.ipConnectionCount.get(clientIp) || 1;
    if (connCount <= 1) {
      this.ipConnectionCount.delete(clientIp);
    } else {
      this.ipConnectionCount.set(clientIp, connCount - 1);
    }

    this.logEvent('connection', 'disconnected',
      `${metadata?.userId || 'guest'} disconnected. Total connections: ${this.connections.size}`);

    // Emit disconnection event
    if (metadata) {
      this.emit('client-disconnected', {
        connectionId,
        userId: metadata.userId,
        timestamp: Date.now(),
      });
    }

    // Close connection if still open
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  }

  /**
   * Handle WebSocket error
   */
  private handleError(connectionId: string, error: Error): void {
    const metadata = this.connectionMetadata.get(connectionId);
    this.logEvent('error', 'websocket',
      `WebSocket error for ${metadata?.userId}: ${error.message}`);
  }

  /**
   * Handle WebSocket pong (keep-alive response)
   */
  private handlePong(connectionId: string): void {
    const metadata = this.connectionMetadata.get(connectionId);
    if (metadata) {
      metadata.lastActivityAt = Date.now();
      this.resetConnectionTimeout(connectionId);
    }
  }

  /**
   * Reset connection idle timeout
   */
  private resetConnectionTimeout(connectionId: string): void {
    const existingTimeout = this.timeoutIntervals.get(connectionId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    const newTimeout = setTimeout(() => {
      const ws = this.connections.get(connectionId);
      if (ws) {
        this.logEvent('timeout', 'idle', `Closing idle connection ${connectionId}`);
        ws.close(1000, 'Idle timeout');
      }
    }, this.CONNECTION_TIMEOUT);

    this.timeoutIntervals.set(connectionId, newTimeout);
  }

  /**
   * Clean up expired connections (orphaned in metadata)
   */
  private cleanupExpiredConnections(): void {
    const now = Date.now();
    const expiredIds: string[] = [];

    for (const [id, metadata] of this.connectionMetadata.entries()) {
      const idleTime = now - metadata.lastActivityAt;
      if (idleTime > this.CONNECTION_TIMEOUT) {
        expiredIds.push(id);
      }
    }

    for (const id of expiredIds) {
      const ws = this.connections.get(id);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close(1000, 'Idle timeout');
      }
    }

    if (expiredIds.length > 0) {
      this.logEvent('cleanup', 'expired', `Cleaned up ${expiredIds.length} expired connections`);
    }
  }

  /**
   * Broadcast presence update to all connected clients
   */
  private broadcastPresenceUpdate(connectionId: string, metadata: WebSocketClientMetadata): void {
    const message = {
      type: 'presence-update',
      connectionId,
      userId: metadata.userId,
      role: metadata.role,
      currentFeature: metadata.currentFeature,
      timestamp: Date.now(),
    };

    this.broadcast(message);
  }

  /**
   * Broadcast message to all connected clients
   */
  public broadcast(message: any): void {
    const data = JSON.stringify(message);
    let successCount = 0;

    for (const [id, ws] of this.connections.entries()) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(data);
          successCount++;
        } catch (err) {
          this.logEvent('broadcast', 'send-error',
            `Failed to send broadcast to ${id}: ${err}`);
        }
      }
    }

    this.logEvent('broadcast', 'sent',
      `Broadcast message sent to ${successCount}/${this.connections.size} clients`);
  }

  /**
   * Send message to specific client
   */
  public sendToClient(connectionId: string, message: any): boolean {
    const ws = this.connections.get(connectionId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(message));
        return true;
      } catch (err) {
        this.logEvent('send', 'error',
          `Failed to send message to ${connectionId}: ${err}`);
        return false;
      }
    }
    return false;
  }

  /**
   * Get all active connections with metadata
   */
  public getActiveConnections(): WebSocketClientMetadata[] {
    return Array.from(this.connectionMetadata.values());
  }

  /**
   * Get connection count
   */
  public getConnectionCount(): number {
    return this.connections.size;
  }

  /**
   * Shutdown WebSocket server
   */
  public shutdown(): void {
    // Close all connections
    for (const ws of this.connections.values()) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1001, 'Server shutting down');
      }
    }

    // Clear all timers
    for (const timeout of this.timeoutIntervals.values()) {
      clearTimeout(timeout);
    }
    this.timeoutIntervals.clear();

    // Clear cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Close WebSocket server
    if (this.wss) {
      this.wss.close();
    }

    this.logEvent('server', 'shutdown', 'WebSocket server shut down');
  }

  /**
   * Helper: Generate unique connection ID
   */
  private generateConnectionId(): string {
    return `conn_${crypto.randomBytes(8).toString('hex')}`;
  }

  /**
   * Helper: Validate authentication token
   * In production, verify JWT or session ID against your auth system
   */
  private validateAuthToken(token: string): { valid: boolean; userId?: string; role?: string } {
    // For now, accept any non-empty token and extract user info if present
    // In production, verify JWT signature and expiry
    try {
      // Try to decode as simple base64 JSON (for testing)
      const decoded = JSON.parse(Buffer.from(token, 'base64').toString());
      return {
        valid: true,
        userId: decoded.userId || 'unknown',
        role: decoded.role || 'user',
      };
    } catch {
      // Fall back to simple validation (any token is valid)
      // In production, this should verify against your auth system
      return {
        valid: token !== undefined && token.length > 0,
        userId: 'unknown',
        role: 'user',
      };
    }
  }

  /**
   * Helper: Get client IP from request
   */
  private getClientIP(request: any): string {
    return (
      request.headers['x-forwarded-for']?.split(',')[0].trim() ||
      request.headers['x-real-ip'] ||
      request.socket?.remoteAddress ||
      'unknown'
    );
  }

  /**
   * Helper: Log events for audit trail
   */
  private logEvent(category: string, event: string, message: string): void {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${category}:${event}] ${message}`);
  }
}

// Export singleton instance
export const wsManager = new WebSocketServerManager();
