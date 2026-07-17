import { getAuthToken } from "./api";

const MOCK_API_BASE_URL =
  import.meta.env.VITE_MOCK_API_BASE_URL?.replace(/\/$/, "") ||
  "http://localhost:8010";

function authHeaders() {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request(path, options = {}) {
  const { includeMeta = false, ...fetchOptions } = options;
  const url = `${MOCK_API_BASE_URL}${path}`;
  const response = await fetch(url, {
    ...fetchOptions,
    headers: {
      ...authHeaders(),
      ...(fetchOptions.headers || {}),
    },
  });

  const contentType = (response.headers.get("content-type") || "").toLowerCase();

  let payload = null;
  try {
    if (contentType.includes("application/json")) {
      payload = await response.json();
    } else {
      payload = await response.text();
    }
  } catch {
    payload = null;
  }

  if (includeMeta) {
    return {
      ok: response.ok,
      statusCode: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      body: payload,
    };
  }

  if (!response.ok) {
    if (typeof payload === "string" && payload.trim()) throw new Error(payload);
    if (payload && typeof payload === "object") {
      throw new Error(
        payload.message ||
          payload.error ||
          Object.entries(payload)
            .map(([key, value]) => `${key}: ${value}`)
            .join(", ") ||
          `Request failed with ${response.status}`
      );
    }
    throw new Error(`Request failed with ${response.status}`);
  }

  return payload;
}

function asJsonBody(data) {
  return {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  };
}

export const mockApi = {
  getBaseUrl() {
    return MOCK_API_BASE_URL;
  },

  listScenarios() {
    return request("/mock-admin/scenarios");
  },

  listScenariosByEndpointAndMethod(endpoint, method) {
    const query = new URLSearchParams({ endpoint, method });
    return request(`/mock-admin/scenarios/filter?${query.toString()}`);
  },

  upsertScenario(payload) {
    return request("/mock-admin/scenarios", {
      method: "POST",
      ...asJsonBody(payload),
    });
  },

  deleteScenario(id) {
    return request(`/mock-admin/scenarios/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },

  clearScenarios() {
    return request("/mock-admin/scenarios", {
      method: "DELETE",
    });
  },

  generateScenario(payload) {
    return request("/mock-admin/scenarios/generate", {
      method: "POST",
      ...asJsonBody(payload),
    });
  },

  modifyScenario(payload) {
    return request("/mock-admin/scenarios/modify", {
      method: "POST",
      ...asJsonBody(payload),
    });
  },

  addDefaultScenario(payload) {
    return request("/mock-admin/scenarios/default", {
      method: "POST",
      ...asJsonBody(payload),
    });
  },

  listOperators() {
    return request("/mock-admin/operators");
  },

  async invokeMock({ method, path, body, headers }) {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const upperMethod = String(method || "GET").toUpperCase();

    if (upperMethod === "GET") {
      const query = new URLSearchParams();
      query.set("body", body || "{}");
      return request(`/mock${normalizedPath}?${query.toString()}`, {
        includeMeta: true,
        method: "GET",
        headers: {
          ...(headers || {}),
        },
      });
    }

    return request(`/mock${normalizedPath}`, {
      includeMeta: true,
      method: upperMethod,
      headers: {
        "Content-Type": "application/json",
        ...(headers || {}),
      },
      body: body || "{}",
    });
  },
};
