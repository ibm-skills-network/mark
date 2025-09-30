/* eslint-disable @typescript-eslint/no-empty-function */
import { getBaseApiPath } from "@/config/constants";

export interface Notification {
  id: number;
  title: string;
  message: string;
  type: string;
  createdAt: string;
  read: boolean;
  userId: string;
  metadata?: string;
}

export interface NotificationSSECallbacks {
  onInitial: (notifications: Notification[]) => void;
  onNew: (notification: Notification) => void;
  onRead: (notificationId: number) => void;
  onReadAll: () => void;
  onError: (error: Error) => void;
  onConnect: () => void;
  onDisconnect: () => void;
}

export class NotificationSSEClient {
  private eventSource: EventSource | null = null;
  private callbacks: NotificationSSECallbacks;
  private reconnectAttempts = 0;
  private reconnectInterval = 300000; // 5 minutes in milliseconds
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isConnected = false;
  private shouldReconnect = true;

  constructor(callbacks: NotificationSSECallbacks) {
    this.callbacks = callbacks;
  }

  connect(): void {
    if (
      this.eventSource &&
      this.eventSource.readyState !== EventSource.CLOSED
    ) {
      return; // Already connected or connecting
    }

    this.shouldReconnect = true;
    const url = `${getBaseApiPath("v1")}/notifications/stream`;

    try {
      this.eventSource = new EventSource(url, {
        withCredentials: true,
      });

      this.eventSource.onopen = () => {
        this.isConnected = true;
        this.reconnectAttempts = 0;
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
        this.callbacks.onConnect();
      };

      this.eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          switch (data.type) {
            case "initial":
              this.callbacks.onInitial(data.notifications);
              break;
            case "new":
              this.callbacks.onNew(data.notification);
              break;
            case "read":
              this.callbacks.onRead(data.notificationId);
              break;
            case "read-all":
              this.callbacks.onReadAll();
              break;
            case "heartbeat":
              // Keep connection alive - no action needed
              break;
            default:
              console.warn("Unknown SSE message type:", data.type);
          }
        } catch (error) {
          this.callbacks.onError(
            new Error(
              `Failed to parse SSE message: ${error instanceof Error ? error.message : "Unknown error"}`,
            ),
          );
        }
      };

      this.eventSource.onerror = (event) => {
        this.isConnected = false;
        this.callbacks.onDisconnect();

        if (this.shouldReconnect) {
          this.scheduleReconnect();
        }
      };
    } catch (error) {
      if (this.shouldReconnect) {
        this.scheduleReconnect();
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectTimer = setTimeout(() => {
      if (this.shouldReconnect) {
        this.connect();
      }
    }, this.reconnectInterval);
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.isConnected = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    this.callbacks.onDisconnect();
  }

  isConnectedState(): boolean {
    return this.isConnected;
  }

  getReadyState(): number | null {
    return this.eventSource?.readyState || null;
  }
}

// Utility hook for React components
export function useNotificationSSE(
  callbacks: Partial<NotificationSSECallbacks>,
) {
  const client = new NotificationSSEClient({
    onInitial: callbacks.onInitial || (() => {}),
    onNew: callbacks.onNew || (() => {}),
    onRead: callbacks.onRead || (() => {}),
    onReadAll: callbacks.onReadAll || (() => {}),
    onError: callbacks.onError || (() => {}),
    onConnect: callbacks.onConnect || (() => {}),
    onDisconnect: callbacks.onDisconnect || (() => {}),
  });

  return {
    connect: () => client.connect(),
    disconnect: () => client.disconnect(),
    isConnected: () => client.isConnectedState(),
    getReadyState: () => client.getReadyState(),
  };
}
