/**
 * Shared gateway client for UI components.
 * Reads connection info from localStorage (set by App.svelte).
 */
import { GatewayClient } from "$contracts/client";

let _client: GatewayClient | null = null;

export function getGatewayClient(): GatewayClient {
  if (!_client) {
    const baseUrl = localStorage.getItem("vs-gateway-url") ?? "http://127.0.0.1:5198";
    const token = localStorage.getItem("vs-gateway-token") ?? "dev-token";
    _client = new GatewayClient({
      baseUrl,
      tokenProvider: () => token,
    });
  }
  return _client;
}

export function resetGatewayClient(): void {
  _client = null;
}
