import type { FastifyRequest } from "fastify";

/** The proxies the server knows how to sit behind (PROXY). */
export const PROXIES = ["fly"] as const;
export type Proxy = (typeof PROXIES)[number];

/**
 * The client's address. Behind Fly's proxy every connection comes from the
 * proxy, which names the client in Fly-Client-IP ("the IP address of the
 * client from the perspective of Fly Proxy"). That header is trusted only
 * when the config says the server is behind Fly: anywhere else, any client
 * could send it and choose its own address.
 *
 * Not X-Forwarded-For, and so not Fastify's trustProxy, which reads it: Fly
 * does not document whether it keeps an X-Forwarded-For the client sent,
 * and its rightmost entry is the app's own address, not the client's.
 * Without the header (a request that did not come through the proxy), the
 * socket's address.
 */
export function clientIp(
  request: FastifyRequest,
  proxy: Proxy | undefined,
): string {
  if (proxy === "fly") {
    const header = request.headers["fly-client-ip"];
    if (typeof header === "string" && header !== "") return header;
  }
  return request.ip;
}
