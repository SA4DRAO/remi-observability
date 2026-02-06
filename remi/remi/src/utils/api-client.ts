/**
 * HTTP API Client using Axios with interceptors
 */
import axios, { type AxiosInstance, type AxiosRequestConfig, type AxiosResponse, type AxiosError } from "axios";
import { config } from "../config/env";
import { logger } from "./logger";

class ApiClient {
  private client: AxiosInstance;

  constructor(baseURL: string, timeout: number) {
    this.client = axios.create({ baseURL, timeout, withCredentials: false });

    // Request logging
    this.client.interceptors.request.use((request: AxiosRequestConfig) => {
      logger.debug("HTTP request", {
        method: request.method,
        url: `${request.baseURL ?? ""}${request.url ?? ""}`,
      });
      return request;
    });

    // Response logging and error handling
    this.client.interceptors.response.use(
      (response: AxiosResponse) => {
        logger.debug("HTTP response", {
          status: response.status,
          url: response.config.url,
        });
        return response;
      },
      (error: AxiosError) => {
        const status = error?.response?.status;
        const url = (error?.config as AxiosRequestConfig | undefined)?.url;
        logger.error("HTTP error", { status, url, error });
        return Promise.reject(error);
      }
    );
  }

  async get<T>(endpoint: string, configOverrides?: AxiosRequestConfig): Promise<T> {
    const res = await this.client.get<T>(endpoint, configOverrides);
    return res.data;
  }

  async post<T>(endpoint: string, data?: unknown, configOverrides?: AxiosRequestConfig): Promise<T> {
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

export const apiClient = new ApiClient(config.api.baseUrl, config.api.timeout);
