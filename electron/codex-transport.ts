import { spawn } from "node:child_process";
import { createConnection, Socket } from "node:net";
import { createInterface } from "node:readline";
import WebSocket from "ws";

export interface JsonRpcTransport {
  send(message: string): void;
  close(): void;
}

export interface JsonRpcTransportHandlers {
  onMessage(message: string): void;
  onClose(): void;
  onError(error: Error): void;
  onDiagnostic?(message: string): void;
}

export function connectUnixSocketWebSocket(
  socketPath: string,
  handlers: JsonRpcTransportHandlers,
  handshakeTimeoutMs = 5_000
): Promise<JsonRpcTransport> {
  return new Promise((resolve, reject) => {
    let opened = false;
    let settled = false;
    let socket: Socket | undefined;
    const webSocket = new WebSocket("ws://localhost/", {
      createConnection: () => {
        socket = createConnection(socketPath);
        return socket;
      },
      handshakeTimeout: handshakeTimeoutMs,
      perMessageDeflate: false
    });
    const handshakeTimeout = setTimeout(() => {
      const error = new Error("Codex daemon WebSocket handshake timed out");
      if (settled) return;
      settled = true;
      socket?.destroy();
      webSocket.terminate();
      reject(error);
    }, handshakeTimeoutMs);
    handshakeTimeout.unref();

    const failBeforeOpen = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(handshakeTimeout);
      reject(error);
    };

    webSocket.on("message", (data) => handlers.onMessage(data.toString()));
    webSocket.on("close", () => {
      if (opened) handlers.onClose();
      else failBeforeOpen(new Error("Codex daemon WebSocket closed before handshake"));
    });
    webSocket.on("error", (error) => {
      if (opened) handlers.onError(error);
      else failBeforeOpen(error);
    });
    webSocket.once("open", () => {
      if (settled) {
        webSocket.close();
        return;
      }
      opened = true;
      settled = true;
      clearTimeout(handshakeTimeout);
      resolve({
        send: (message) => webSocket.send(message),
        close: () => webSocket.close()
      });
    });
  });
}

export function connectStdioJsonRpc(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  handlers: JsonRpcTransportHandlers
): Promise<JsonRpcTransport> {
  return new Promise((resolve, reject) => {
    let spawned = false;
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], env });
    const lines = createInterface({ input: child.stdout });
    lines.on("line", handlers.onMessage);
    child.stderr.on("data", (data) => handlers.onDiagnostic?.(String(data)));
    child.once("exit", () => handlers.onClose());
    child.once("error", (error) => {
      if (spawned) handlers.onError(error);
      else reject(error);
    });
    child.once("spawn", () => {
      spawned = true;
      resolve({
        send: (message) => child.stdin.write(`${message}\n`),
        close: () => {
          lines.close();
          child.kill();
        }
      });
    });
  });
}
