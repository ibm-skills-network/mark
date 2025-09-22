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
  onError: (error: Error) => void;
  onConnect: () => void;
  onDisconnect: () => void;
}

export class NotificationSSEClient {
  private eventSource: EventSource | null = null;
  private callbacks: NotificationSSECallbacks;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000; // Start with 1 second
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
        this.reconnectDelay = 1000;
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

        if (
          this.shouldReconnect &&
          this.reconnectAttempts < this.maxReconnectAttempts
        ) {
          this.reconnectAttempts++;
          const delay = Math.min(
            this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
            30000,
          );

          setTimeout(() => {
            if (this.shouldReconnect) {
              this.connect();
            }
          }, delay);
        } else if (this.reconnectAttempts >= this.maxReconnectAttempts) {
          this.callbacks.onError(
            new Error("Max reconnection attempts reached"),
          );
        }
      };
    } catch (error) {
      this.callbacks.onError(
        new Error(
          `Failed to create SSE connection: ${error instanceof Error ? error.message : "Unknown error"}`,
        ),
      );
    }
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.isConnected = false;

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
    onError:
      callbacks.onError ||
      ((error) => console.error("Notification SSE error:", error)),
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
