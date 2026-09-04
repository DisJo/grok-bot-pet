import { createServer } from "node:http";
import { createServer as createSocketServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { connectStdioJsonRpc, connectUnixSocketWebSocket, JsonRpcTransport } from "./codex-transport";

describe("Codex daemon WebSocket transport", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("exchanges JSON-RPC messages over a Unix socket WebSocket", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "grok-ws-"));
    roots.push(root);
    const socketPath = path.join(root, "control.sock");
    const server = createServer();
    const webSockets = new WebSocketServer({ noServer: true });
    let extensionHeader: string | undefined;
    server.on("upgrade", (request, socket, head) => {
      extensionHeader = request.headers["sec-websocket-extensions"];
      webSockets.handleUpgrade(request, socket, head, (webSocket) => {
        webSockets.emit("connection", webSocket, request);
      });
    });
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));

    const serverReceived = new Promise<string>((resolve) => {
      webSockets.once("connection", (webSocket) => {
        webSocket.once("message", (data) => {
          resolve(data.toString());
          webSocket.send(JSON.stringify({ id: 1, result: { ready: true } }));
        });
      });
    });
    let resolveClientMessage!: (message: string) => void;
    const clientReceived = new Promise<string>((resolve) => { resolveClientMessage = resolve; });
    let transport: JsonRpcTransport | undefined;
    try {
      transport = await connectUnixSocketWebSocket(socketPath, {
        onMessage: resolveClientMessage,
        onClose: () => {},
        onError: () => {}
      });
      expect(extensionHeader).toBeUndefined();
      transport.send(JSON.stringify({ id: 1, method: "initialize", params: {} }));

      await expect(serverReceived).resolves.toBe(JSON.stringify({ id: 1, method: "initialize", params: {} }));
      await expect(clientReceived).resolves.toBe(JSON.stringify({ id: 1, result: { ready: true } }));
    } finally {
      transport?.close();
      await new Promise<void>((resolve) => webSockets.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("rejects a missing socket without forwarding pre-open lifecycle events", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "grok-ws-missing-"));
    roots.push(root);
    const events: string[] = [];

    await expect(connectUnixSocketWebSocket(path.join(root, "missing.sock"), {
      onMessage: () => {},
      onClose: () => events.push("close"),
      onError: () => events.push("error")
    })).rejects.toThrow();
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(events).toEqual([]);
  });

  it("bounds a stalled daemon handshake", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "grok-ws-timeout-"));
    roots.push(root);
    const socketPath = path.join(root, "control.sock");
    const sockets = new Set<import("node:net").Socket>();
    let resolveSocketClose!: () => void;
    const socketClosed = new Promise<void>((resolve) => { resolveSocketClose = resolve; });
    const server = createSocketServer((socket) => {
      sockets.add(socket);
      socket.once("close", () => { sockets.delete(socket); resolveSocketClose(); });
      socket.resume();
    });
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));

    try {
      await expect(connectUnixSocketWebSocket(socketPath, {
        onMessage: () => {},
        onClose: () => {},
        onError: () => {}
      }, 20)).rejects.toThrow(/handshake|timeout/i);
      if (sockets.size > 0) {
        await Promise.race([
          socketClosed,
          new Promise<void>((resolve) => setTimeout(resolve, 250))
        ]);
      }
      expect(sockets.size).toBe(0);
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("Codex stdio transport", () => {
  it("keeps newline-delimited JSON-RPC as the fallback protocol", async () => {
    let resolveClientMessage!: (message: string) => void;
    const clientReceived = new Promise<string>((resolve) => { resolveClientMessage = resolve; });
    const transport = await connectStdioJsonRpc(
      process.execPath,
      ["-e", [
        "const readline = require('node:readline');",
        "const lines = readline.createInterface({ input: process.stdin });",
        "lines.once('line', (line) => process.stdout.write(line + '\\n'));"
      ].join("")],
      process.env,
      {
        onMessage: resolveClientMessage,
        onClose: () => {},
        onError: () => {}
      }
    );
    const request = JSON.stringify({ id: 2, method: "thread/list", params: {} });

    try {
      transport.send(request);
      await expect(clientReceived).resolves.toBe(request);
    } finally {
      transport.close();
    }
  });
});
