/**
 * HTTP API Client using Axios with interceptors
 */
import axios, { type AxiosInstance, type AxiosRequestConfig, type InternalAxiosRequestConfig, type AxiosResponse, type AxiosError } from "axios";
import { config } from "../config/env";
import { logger } from "./logger";
import { DEMO_MODE, demoRequest } from "./demo-data";

class ApiClient {
  private client: AxiosInstance;

  private createRequestId(): string {
    return `fe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  constructor(baseURL: string, timeout: number, apiKey: string) {
    this.client = axios.create({
      baseURL,
      timeout,
      withCredentials: false,
      // No key when the reverse proxy authenticates the user: the session cookie
      // rides along on these same-origin calls and the backend reads the email
      // the proxy forwards. Sending "Bearer " with an empty key would be treated
      // as a bad credential rather than as absent one.
      headers: apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {},
    });

    // Request logging
    this.client.interceptors.request.use((request: InternalAxiosRequestConfig) => {
      const requestId = this.createRequestId();
      const startedAt = Date.now();
      request.headers.set('x-request-id', requestId);
      (request as InternalAxiosRequestConfig & { metadata?: { startedAt: number; requestId: string } }).metadata = {
        startedAt,
        requestId,
      };

      const body = request.data as { events?: unknown[]; session_id?: string } | undefined;
      logger.debug("HTTP request", {
        requestId,
        method: request.method,
        url: `${request.baseURL ?? ""}${request.url ?? ""}`,
        params: request.params,
        sessionId: body?.session_id,
        eventsCount: Array.isArray(body?.events) ? body.events.length : undefined,
      });
      return request;
    });

    // Response logging and error handling
    this.client.interceptors.response.use(
      (response: AxiosResponse) => {
        const metadata = (response.config as InternalAxiosRequestConfig & { metadata?: { startedAt: number; requestId: string } }).metadata;
        logger.debug("HTTP response", {
          requestId: metadata?.requestId,
          status: response.status,
          url: response.config.url,
          durationMs: metadata ? Date.now() - metadata.startedAt : undefined,
          source: (response.data as { source?: string })?.source,
        });
        return response;
      },
      (error: AxiosError) => {
        const status = error?.response?.status;
        const cfg = error?.config as (InternalAxiosRequestConfig & { metadata?: { startedAt: number; requestId: string } }) | undefined;
        const url = cfg?.url;
        logger.error("HTTP error", {
          requestId: cfg?.metadata?.requestId,
          status,
          url,
          durationMs: cfg?.metadata ? Date.now() - cfg.metadata.startedAt : undefined,
          errorMessage: error.message,
          responseData: error.response?.data,
        });
        // The backend returns {success:false, error:"<message>"} on failure. Surface that
        // message so hooks/UI that read error.message show the real cause instead of the
        // generic axios "Request failed with status code 500".
        const serverError = (error.response?.data as { error?: string } | undefined)?.error;
        if (serverError) error.message = serverError;
        return Promise.reject(error);
      }
    );
  }

  // Demo mode short-circuits here rather than in each hook, so every caller —
  // hooks, pages, components — is unaware there is no backend.
  async get<T>(endpoint: string, configOverrides?: AxiosRequestConfig): Promise<T> {
    if (DEMO_MODE) {
      return (await demoRequest("get", endpoint, configOverrides?.params ?? {})) as T;
    }
    const res = await this.client.get<T>(endpoint, configOverrides);
    return res.data;
  }

  async post<T>(endpoint: string, data?: unknown, configOverrides?: AxiosRequestConfig): Promise<T> {
    if (DEMO_MODE) {
      return (await demoRequest("post", endpoint, configOverrides?.params ?? {}, data)) as T;
    }
    const res = await this.client.post<T>(endpoint, data, configOverrides);
    return res.data;
  }

  async put<T>(endpoint: string, data?: unknown, configOverrides?: AxiosRequestConfig): Promise<T> {
    const res = await this.client.put<T>(endpoint, data, configOverrides);
    return res.data;
  }

  async delete<T>(endpoint: string, configOverrides?: AxiosRequestConfig): Promise<T> {
    const res = await this.client.delete<T>(endpoint, configOverrides);
    return res.data;
  }
}

export const apiClient = new ApiClient(config.api.baseUrl, config.api.timeout, config.api.apiKey);
