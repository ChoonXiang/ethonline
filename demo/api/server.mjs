// @ts-check
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

export function createDemoServer() {
  const identity = {
    service: "[project-name]-demo-api",
    version: "1.0.0",
    instanceId: randomUUID(),
  };

  return createServer((request, response) => {
    let path;

    try {
      path = new URL(request.url ?? "/", "http://localhost").pathname;
    } catch {
      response.writeHead(400).end();
      return;
    }

    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");

    if (path !== "/healthz" && path !== "/api/message") {
      response.writeHead(404).end(JSON.stringify({ error: "Not found" }));
      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      response.setHeader("Allow", "GET, HEAD");
      response.writeHead(405).end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    const body =
      path === "/healthz"
        ? { status: "ok", ...identity }
        : { message: "[project-name] demo API is available", ...identity };

    response
      .writeHead(200)
      .end(request.method === "HEAD" ? undefined : JSON.stringify(body));
  });
}
