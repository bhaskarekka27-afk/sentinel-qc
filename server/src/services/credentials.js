import { config, refreshCapabilities } from '../config.js';

/**
 * Simplified credentials — only the LLAMA service URL is configurable.
 * No API keys needed since everything runs locally.
 */

export function getCredentialsMasked() {
  return {
    LLAMA_SERVICE_URL: { set: true, value: config.llama.serviceUrl },
  };
}

export function updateCredentials(updates) {
  if (updates.LLAMA_SERVICE_URL) {
    config.llama.serviceUrl = updates.LLAMA_SERVICE_URL;
  }
  refreshCapabilities();
  return getCredentialsMasked();
}

export function loadStoredCredentials() {
  refreshCapabilities();
}
