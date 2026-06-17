/**
 * Spark AI Kit — Vanilla JS adapter
 * Same API as spark-ai.tsx but without React dependencies.
 * See readme.txt for full documentation.
 */
(() => {
  const SPARK_BASE = 'https://sparkbrain.app';
  let _baseUrl = SPARK_BASE;
  let _apiKey = null;

  function configure(opts) {
    if (opts.baseUrl !== undefined) _baseUrl = opts.baseUrl;
    if (opts.apiKey) _apiKey = opts.apiKey;
  }

  function headers() {
    return {
      'Content-Type': 'application/json',
      ...(_apiKey && { 'X-Api-Key': _apiKey }),
    };
  }

  /**
   * Free-form text prompt
   * @param {string} message
   * @returns {Promise<{reply: string} | {error: string, status?: number}>}
   */
  async function ask(message) {
    try {
      const res = await fetch(`${_baseUrl}/api/ai`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ message }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        return { error: text || `HTTP ${res.status}`, status: res.status };
      }
      return await res.json();
    } catch (err) {
      return { error: err.message || 'Network error' };
    }
  }

  /**
   * Structured backend action
   * @param {string} name - Action name (e.g. 'rephrase', 'structured-output')
   * @param {object} params - Action parameters
   * @returns {Promise<{type: string, result: any} | {error: string, status?: number}>}
   */
  async function action(name, params) {
    try {
      const res = await fetch(`${_baseUrl}/api/ai/action`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ action: name, ...params }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        return { error: text || `HTTP ${res.status}`, status: res.status };
      }
      return await res.json();
    } catch (err) {
      return { error: err.message || 'Network error' };
    }
  }

  /**
   * Check if AI is available
   * @returns {Promise<boolean>}
   */
  async function checkAvailable() {
    if (_apiKey) return true;
    try {
      const res = await fetch(`${_baseUrl}/api/ai`, { headers: headers() });
      if (!res.ok) return false;
      const data = await res.json();
      return data.available === true;
    } catch {
      return false;
    }
  }

  // Export to global
  window.SparkAI = { configure, ask, action, checkAvailable };
})();
