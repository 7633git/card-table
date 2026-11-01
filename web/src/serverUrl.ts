import { resolveServerUrl } from "../../src/server/public-url.js";

export function defaultServerUrl(): string {
  const configured = import.meta.env.VITE_SERVER_URL;
  if (typeof window === "undefined") {
    return resolveServerUrl({
      configured,
      protocol: "http:",
      hostname: "127.0.0.1",
      port: "2567",
      origin: "http://127.0.0.1:2567",
    });
  }
  return resolveServerUrl({
    configured,
    protocol: window.location.protocol,
    hostname: window.location.hostname,
    port: window.location.port,
    origin: window.location.origin,
  });
}
