// Shared HTTP server reference for graceful shutdown.
// The restart tool calls shutdown() to release the port before process.exit().

let httpServer: { stop(closeActiveConnections?: boolean): Promise<void> } | null = null;

export function setHttpServer(server: { stop(closeActiveConnections?: boolean): Promise<void> }): void {
  httpServer = server;
}

export async function shutdownHttpServer(): Promise<void> {
  if (httpServer) {
    await httpServer.stop(true);
    httpServer = null;
  }
}
