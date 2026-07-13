// const BASE_URL = "https://api-orchestration.onrender.com";
const BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ||
  "http://localhost:8060";

export function getApiBaseUrl() {
  return BASE_URL;
}

// ─── Auth token storage ──────────────────────────────────────────────────────
const TOKEN_STORAGE_KEY = "mr_auto_auth_token";
const authListeners = new Set();

export function getAuthToken() {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

export function setAuthToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token);
    else localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  authListeners.forEach((fn) => {
    try { fn(token); } catch { /* ignore */ }
  });
}

export function onUnauthorized(handler) {
  authListeners.add(handler);
  return () => authListeners.delete(handler);
}

function authHeaders() {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Run a fetch with the auth header attached and clear the token on 401. */
async function fetchWithAuth(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...authHeaders(),
      ...(options.headers || {}),
    },
  });
  if (response.status === 401 && !url.includes("/auth/")) {
    setAuthToken(null);
  }
  return response;
}

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const response = await fetchWithAuth(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (response.status === 204) return null;

  let data;
  try {
    data = await response.json();
  } catch (e) {
    if (!response.ok) {
      throw new Error(`Server error: ${response.status} ${response.statusText}`, { cause: e });
    }
    return null;
  }

  if (!response.ok) {
    const errorMsg =
      typeof data === "object" && !data.error
        ? Object.entries(data).map(([k, v]) => `${k}: ${v}`).join(", ")
        : data.error || "Something went wrong";
    throw new Error(errorMsg);
  }
  return data;
}

/**
 * Fetch a PDF from the backend with auth, validate the response, and open it
 * in a new tab. Throws a friendly Error on auth/server failure so callers can
 * show a toast — never tries to render an HTML/JSON error body as a PDF.
 */
export async function openPdfInTab(path) {
  const url = path.startsWith("http") ? path : `${BASE_URL}${path}`;
  let response;
  try {
    response = await fetchWithAuth(url);
  } catch (e) {
    throw new Error("Network error while downloading the report.", { cause: e });
  }

  if (response.status === 401) {
    throw new Error("Your session has expired. Please sign in again.");
  }
  if (response.status === 403) {
    throw new Error("You don't have permission to download this report.");
  }
  if (!response.ok) {
    throw new Error(`Failed to download report (${response.status} ${response.statusText}).`);
  }

  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  const blob = await response.blob();
  if (!contentType.includes("application/pdf") && !contentType.includes("octet-stream")) {
    // Backend returned something that isn't a PDF — surface its message instead.
    let detail = "";
    try { detail = await blob.text(); } catch { /* ignore */ }
    throw new Error(detail?.slice(0, 240) || "The server did not return a PDF report.");
  }

  const blobUrl = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
  window.open(blobUrl, "_blank");
  // Revoke later so the new tab has time to load it.
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  return blobUrl;
}

// ─── Mappers ─────────────────────────────────────────────────────────────────

const DEFAULT_TIMEZONE = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

function timeToCronExpression(time = "00:00") {
  const [hour = "0", minute = "0"] = String(time).split(":");
  return `${parseInt(minute, 10) || 0} ${parseInt(hour, 10) || 0} * * *`;
}

function cronExpressionToTime(cronExpression) {
  if (!cronExpression || typeof cronExpression !== "string") return null;
  const [minute, hour] = cronExpression.trim().split(/\s+/);
  if (minute == null || hour == null || minute.includes("*") || hour.includes("*")) {
    return null;
  }

  const parsedHour = parseInt(hour, 10);
  const parsedMinute = parseInt(minute, 10);
  if (Number.isNaN(parsedHour) || Number.isNaN(parsedMinute)) return null;

  return `${String(parsedHour).padStart(2, "0")}:${String(parsedMinute).padStart(2, "0")}`;
}

export function normalizeSchedule(schedule) {
  if (!schedule) return null;

  const time =
    schedule.time ||
    schedule.executionTime ||
    schedule.localTime ||
    cronExpressionToTime(schedule.cronExpression) ||
    "00:00";

  return {
    ...schedule,
    time,
    timezone: schedule.timezone || schedule.zoneId || DEFAULT_TIMEZONE(),
    active: schedule.active !== false && schedule.enabled !== false,
    cronExpression: schedule.cronExpression || timeToCronExpression(time),
  };
}

export function mapScheduleToApi(data) {
  const time = data?.time || cronExpressionToTime(data?.cronExpression) || "00:00";
  const timezone = data?.timezone || DEFAULT_TIMEZONE();

  return {
    time,
    timezone,
  };
}

export function sanitizeSkipCondition(skipCondition) {
  if (!skipCondition) return null;

  const source = skipCondition.skipCondition || skipCondition;
  const conditions = Array.isArray(source.conditions)
    ? source.conditions.map((condition) => {
      const cleaned = {
        path: condition.path,
        operator: condition.operator,
      };

      if (Object.prototype.hasOwnProperty.call(condition, "value")) {
        cleaned.value = condition.value;
      }

      return cleaned;
    })
    : [];

  return {
    logic: source.logic || "AND",
    conditions,
  };
}

/** Frontend Test shape → Backend Step body */
export const mapTestToStep = (test) => ({
  name: test.name,
  description: test.description || "",
  method: test.method || "GET",
  url: test.endpoint || "https://api.example.com",
  headersJson:
    test.headers && test.headers.length > 0
      ? JSON.stringify(
        test.headers.reduce((acc, h) => {
          if (h.key && h.enabled !== false) acc[h.key] = h.value;
          return acc;
        }, {})
      )
      : null,
  bodyJson: test.payload || null,
  inheritBodyFromPreviousStep: !!test.inheritBodyFromPreviousStep,
  bodySourceStepId:
    test.inheritBodyFromPreviousStep && test.bodySourceStepId
      ? (typeof test.bodySourceStepId === "number"
        ? test.bodySourceStepId
        : parseInt(test.bodySourceStepId) || null)
      : null,
  assertions: test.assertions || null,
  skipCondition: sanitizeSkipCondition(test.skipCondition),
  retryCount: typeof test.retryCount === "number" ? test.retryCount : (parseInt(test.retryCount) || 0),
  retryDelayMs: typeof test.retryDelayMs === "number" ? test.retryDelayMs : (parseInt(test.retryDelayMs) || 0),
  initialDelayMs: typeof test.initialDelayMs === "number" ? test.initialDelayMs : (parseInt(test.initialDelayMs) || 0),
  pollUntilSuccess: !!test.pollUntilSuccess,
  pollIntervalMs: typeof test.pollIntervalMs === "number" ? test.pollIntervalMs : (parseInt(test.pollIntervalMs) || 0),
  pollMaxAttempts: typeof test.pollMaxAttempts === "number" ? test.pollMaxAttempts : (parseInt(test.pollMaxAttempts) || 0),
  pollExpectedStatus: typeof test.pollExpectedStatus === "number" ? test.pollExpectedStatus : (parseInt(test.pollExpectedStatus) || 0),
  pollConditionJson: test.pollConditionJson || null,
});

/** Backend Step → Frontend Test shape */
export const mapStepToTest = (step) => {
  let cachedResponse = null;
  try {
    const raw = localStorage.getItem(`mr_auto_step_response_${step.id}`);
    if (raw) {
      cachedResponse = JSON.parse(raw);
    }
  } catch (e) {
    console.warn("Failed to read/parse cached response from localStorage:", e);
  }

  return {
    id: step.id,
    stepOrder: step.stepOrder,
    name: step.name,
    description: step.description || "",
    method: step.method,
    endpoint: step.url,
    headers: (() => {
      try {
        return step.headersJson
          ? Object.entries(JSON.parse(step.headersJson)).map(([key, value]) => ({
            key,
            value,
            enabled: true,
          }))
          : [];
      } catch {
        console.warn("Failed to parse headersJson:", step.headersJson);
        return [];
      }
    })(),
    payload: step.bodyJson,
    inheritBodyFromPreviousStep:
      step.inheritBodyFromPreviousStep != null
        ? !!step.inheritBodyFromPreviousStep
        : step.bodySourceStepId != null,
    bodySourceStepId: step.bodySourceStepId ?? null,
    assertions: step.assertionsJson ? JSON.parse(step.assertionsJson) : null,
    skipCondition: (() => {
      if (step.skipCondition) return sanitizeSkipCondition(step.skipCondition);
      try {
        return step.skipConditionJson ? sanitizeSkipCondition(JSON.parse(step.skipConditionJson)) : null;
      } catch {
        return null;
      }
    })(),
    retryCount: step.retryCount || 0,
    retryDelayMs: step.retryDelayMs || 0,
    initialDelayMs: step.initialDelayMs || 0,
    pollUntilSuccess: !!step.pollUntilSuccess,
    pollIntervalMs: step.pollIntervalMs || 0,
    pollMaxAttempts: step.pollMaxAttempts || 0,
    pollExpectedStatus: step.pollExpectedStatus || 0,
    pollConditionJson: step.pollConditionJson || (step.pollCondition ? (typeof step.pollCondition === "string" ? step.pollCondition : JSON.stringify(step.pollCondition)) : null),
    payloadVariants: Array.isArray(step.payloadVariants) ? step.payloadVariants : [],
    response: cachedResponse,
  };
};


// ─── API ──────────────────────────────────────────────────────────────────────

export const api = {
  // ── Auth ─────────────────────────────────────────────────────────────────
  /** POST /auth/register → { token, user } */
  register: ({ email, name, password }) =>
    request(`/auth/register`, {
      method: "POST",
      body: JSON.stringify({ email, name, password }),
    }),
  /** POST /auth/login → { token, user } */
  login: ({ email, password }) =>
    request(`/auth/login`, {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  /** GET /auth/me → UserProfile (requires Bearer token) */
  me: () => request(`/auth/me`),
  /** GET /auth/google-login-url?redirectTo= → { url } */
  googleLoginUrl: (redirectTo = `${window.location.origin}/auth/callback`) =>
    request(`/auth/google-login-url?redirectTo=${encodeURIComponent(redirectTo)}`),

  // ── User Profile & Dashboard ──────────────────────────────────────────────
  /** PUT /users/me → UserProfile */
  updateProfile: (data) =>
    request(`/users/me`, { method: "PUT", body: JSON.stringify(data) }),
  /** DELETE /users/me */
  deleteAccount: () =>
    request(`/users/me`, { method: "DELETE" }),
  /** GET /users/me/dashboard */
  getDashboard: () =>
    request(`/users/me/dashboard`),

  // ── Feedback ─────────────────────────────────────────────────────────────
  /** POST /feedback → FeedbackResponse */
  submitFeedback: (body) =>
    request(`/feedback`, { method: "POST", body: JSON.stringify(body) }),
  /** GET /feedback/mine?page&size → PageFeedbackResponse */
  listMyFeedback: ({ page = 0, size = 20 } = {}) =>
    request(`/feedback/mine?page=${page}&size=${size}`),
  /** GET /feedback?page&size&status&type → PageFeedbackResponse (admin only) */
  listAllFeedback: ({ page = 0, size = 20, status, type } = {}) => {
    const params = new URLSearchParams({ page: String(page), size: String(size) });
    if (status) params.set("status", status);
    if (type) params.set("type", type);
    return request(`/feedback?${params.toString()}`);
  },
  /** PATCH /feedback/{id}/status?status= → FeedbackResponse (admin only) */
  updateFeedbackStatus: (id, status) =>
    request(`/feedback/${id}/status?status=${encodeURIComponent(status)}`, { method: "PATCH" }),

  // ── Modules ──────────────────────────────────────────────────────────────
  getModules: () => request("/modules"),
  getModule: (id) => request(`/modules/${id}`),
  createModule: (data) =>
    request("/modules", { method: "POST", body: JSON.stringify(data) }),
  /** FIX: was missing from original api.js — UpdateModuleModal needs this */
  updateModule: (id, data) =>
    request(`/modules/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteModule: (id) => request(`/modules/${id}`, { method: "DELETE" }),

  // ── Flows ─────────────────────────────────────────────────────────────────
  getFlows: () => request("/flows"),
  getFlow: (id) => request(`/flows/${id}`),
  getFlowsByModule: (moduleName) =>
    request(`/flows/module/${encodeURIComponent(moduleName)}`),
  createFlow: (data, moduleName) =>
    request("/flows", {
      method: "POST",
      body: JSON.stringify({
        name: data.name,
        description: data.description,
        module: moduleName,
        environmentId: data.environmentId,
      }),
    }),
  updateFlow: (id, data, moduleName) =>
    request(`/flows/${id}`, {
      method: "PUT",
      body: JSON.stringify({
        name: data.name,
        description: data.description,
        module: moduleName,
      }),
    }),
  deleteFlow: (id) => request(`/flows/${id}`, { method: "DELETE" }),
  duplicateFlow: (id, data) =>
    request(`/flows/${id}/duplicate`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  /** PUT /flows/:id/environment/:envId — assign an environment to a flow */
  updateFlowEnv: (id, envId) =>
    request(`/flows/${id}/environment/${envId}`, { method: "PUT" }),
  /** DELETE /flows/:id/environment — clear environment from a flow */
  clearFlowEnv: (id) =>
    request(`/flows/${id}/environment`, { method: "DELETE" }),

  // ── UI Automation ────────────────────────────────────────────────────────
  /**
   * POST /ui-automation/generate → UIAutomationResult
   * Required: url, steps, moduleName, flowName. Optional: authHeader, cookiesJson.
   */
  generateUiAutomation: ({ url, steps, moduleName, flowName, authHeader, cookiesJson } = {}) =>
    request(`/ui-automation/generate`, {
      method: "POST",
      body: JSON.stringify({
        url,
        steps,
        moduleName,
        flowName,
        ...(authHeader ? { authHeader } : {}),
        ...(cookiesJson ? { cookiesJson } : {}),
      }),
    }),

  // ── Steps ─────────────────────────────────────────────────────────────────
  getSteps: (flowId) => request(`/flows/${flowId}/steps`),
  getStep: (flowId, stepId) => request(`/flows/${flowId}/steps/${stepId}`),
  getPollFields: (flowId, stepId) => request(`/flows/${flowId}/steps/${stepId}/poll-fields`),
  runStep: (flowId, stepId, envId) => {
    const query = envId ? `?envId=${envId}` : "";
    return request(`/flows/${flowId}/steps/${stepId}/run${query}`, { method: "POST" });
  },
  captureToEnv: (flowId, stepId, environmentId, mappings) =>
    request(`/flows/${flowId}/steps/${stepId}/capture-to-env`, {
      method: "POST",
      body: JSON.stringify({ environmentId, mappings }),
    }),
  createStep: (flowId, test) =>
    request(`/flows/${flowId}/steps`, {
      method: "POST",
      body: JSON.stringify(mapTestToStep(test)),
    }),
  updateStep: (flowId, stepId, test) =>
    request(`/flows/${flowId}/steps/${stepId}`, {
      method: "PUT",
      body: JSON.stringify(mapTestToStep(test)),
    }),
  deleteStep: (flowId, stepId) =>
    request(`/flows/${flowId}/steps/${stepId}`, { method: "DELETE" }),
  duplicateStep: (flowId, stepId, name) =>
    request(`/flows/${flowId}/steps/${stepId}/duplicate`, {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  reorderSteps: (flowId, steps) =>
    request(`/flows/${flowId}/steps/reorder`, {
      method: "PUT",
      body: JSON.stringify({ steps }),
    }),
  createStepFromVariant: (flowId, stepId, data) =>
    request(`/flows/${flowId}/steps/${stepId}/variants/create-step`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  // ── Environments ──────────────────────────────────────────────────────────
  getModuleEnvironments: (moduleId) =>
    request(`/modules/${moduleId}/environments`),
  getEnvironment: (moduleId, envId) =>
    request(`/modules/${moduleId}/environments/${envId}`),
  createEnvironment: (moduleId, data) =>
    request(`/modules/${moduleId}/environments`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateEnvironment: (moduleId, envId, data) =>
    request(`/modules/${moduleId}/environments/${envId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteEnvironment: (moduleId, envId) =>
    request(`/modules/${moduleId}/environments/${envId}`, { method: "DELETE" }),

  // ── Scheduler ─────────────────────────────────────────────────────────────
  getModuleSchedule: async (moduleId) =>
    normalizeSchedule(await request(`/schedule/modules/${moduleId}`)),
  /** POST /schedule/modules/:moduleId  body: { time, timezone } */
  setModuleSchedule: async (moduleId, data) =>
    normalizeSchedule(await request(`/schedule/modules/${moduleId}`, {
      method: "POST",
      body: JSON.stringify(mapScheduleToApi(data)),
    })),
  deleteModuleSchedule: (moduleId) =>
    request(`/schedule/modules/${moduleId}`, { method: "DELETE" }),
  getModuleScheduleRuns: (moduleId, page = 0, size = 20) =>
    request(`/schedule/modules/${moduleId}/runs?page=${page}&size=${size}`),
  getLatestModuleScheduleRun: (moduleId) =>
    request(`/schedule/modules/${moduleId}/runs/latest`),
  getModuleScheduleRunDetail: (executionId) =>
    request(`/schedule/modules/runs/${executionId}`),

  // ── Execution ─────────────────────────────────────────────────────────────
  executeFlow: (flowId, envId) =>
    request(`/execute/flows/${flowId}/async`, {
      method: "POST",
      body: JSON.stringify({ environmentId: envId ? parseInt(envId) : null }),
    }),
  getFlowExecutionStatus: (executionId) =>
    request(`/execute/flows/runs/${executionId}/status`),
  /** POST /execute/modules/:moduleId?envId=...&parallel=... */
  executeModule: (moduleId, envId, parallel = false) => {
    const params = new URLSearchParams();
    if (envId) params.set("envId", envId);
    params.set("parallel", String(parallel));
    return request(`/execute/modules/${moduleId}?${params.toString()}`, { method: "POST" });
  },
  /** POST /execute/modules/bulk  body: { ids, envIds? } */
  executeBulkModules: (ids, envIds) =>
    request("/execute/modules/bulk", {
      method: "POST",
      body: JSON.stringify({ ids, envIds }),
    }),
  /** POST /execute/flows/bulk  body: { ids, envIds? } */
  executeBulkFlows: (ids, envIds) =>
    request("/execute/flows/bulk", {
      method: "POST",
      body: JSON.stringify({ ids, envIds }),
    }),
  /** Convenience: picks endpoint by type ('module'|'flow') */
  executeBulk: (type, ids, envIds) => {
    const path =
      type === "module" ? "/execute/modules/bulk" : "/execute/flows/bulk";
    return request(path, {
      method: "POST",
      body: JSON.stringify({
        ids: (ids || []).map(id => parseInt(id)),
        envIds: (envIds || []).map(id => id ? parseInt(id) : null)
      }),
    });
  },
  /** GET /execute/bulk/:bulkJobId — poll job status */
  getBulkJobStatus: (bulkJobId) => request(`/execute/bulk/${bulkJobId}`),

  // ── Reports — PDF download URLs ───────────────────────────────────────────
  getFlowReport: (flowId) =>
    `${BASE_URL}/report/flows/${flowId}`,
  getModuleReport: (moduleExecutionId) =>
    `${BASE_URL}/report/module-executions/${moduleExecutionId}`,
  getBulkReport: (bulkJobId) => `${BASE_URL}/report/bulk/${bulkJobId}`,

  // ── Reports — JSON data ───────────────────────────────────────────────────
  /** GET /report/flows/:flowId/data */
  getFlowReportData: (flowId) =>
    request(`/report/flows/${flowId}/data`),
  /** GET /report/module-executions/:moduleExecutionId/data */
  getModuleReportData: (moduleExecutionId) =>
    request(`/report/module-executions/${moduleExecutionId}/data`),
  /** GET /report/bulk/:bulkJobId/data */
  getBulkReportData: (bulkJobId) =>
    request(`/report/bulk/${bulkJobId}/data`),

  // ── Assertions & Skip Conditions ─────────────────────────────────────────
  generateAssertions: ({ stepId, description }) =>
    request("/assertions/generate", {
      method: "POST",
      body: JSON.stringify({ stepId, description }),
    }),
  generateSchemaValidation: async (stepId) => {
    try {
      return await request(`/assettions/schema/${stepId}`, {
        method: "POST",
      });
    } catch {
      return request(`/assertions/schema/${stepId}`, {
        method: "POST",
      });
    }
  },
  getStepAssertions: async (stepId) => {
    try {
      return await request(`/assertions/${stepId}`);
    } catch {
      return request(`/assettions/${stepId}`);
    }
  },
  generateSkipCondition: ({ flowId, targetStepOrder, description }) =>
    request("/skip-condition/generate", {
      method: "POST",
      body: JSON.stringify({ flowId, targetStepOrder, description }),
    }),

  // ── Custom Methods ───────────────────────────────────────────────────────
  getAllMethods: () =>
    request("/methods"),
  getAllMethodsIncludingDrafts: () =>
    request("/methods/all"),
  getMethodParameterTypes: () =>
    request("/methods/parameter-types"),
  getMethodDetail: (methodId) =>
    request(`/methods/${methodId}`),
  updateMethod: (methodId, data) =>
    request(`/methods/${methodId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  saveMethod: (methodId) =>
    request(`/methods/${methodId}/save`, {
      method: "POST",
    }),
  discardMethod: (methodId) =>
    request(`/methods/${methodId}/discard`, {
      method: "DELETE",
    }),
  deleteMethod: (methodId) =>
    request(`/methods/${methodId}`, {
      method: "DELETE",
    }),
  generateMethod: (data) =>
    request("/methods/generate", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  testMethod: (methodId, parameters) =>
    request("/methods/test", {
      method: "POST",
      body: JSON.stringify({ methodId, parameters }),
    }),
  attachMethodToStep: (flowId, stepId, data) =>
    request(`/flows/${flowId}/steps/${stepId}/methods`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  getStepMethods: (flowId, stepId) =>
    request(`/flows/${flowId}/steps/${stepId}/methods`),
  reorderStepMethods: (flowId, stepId, stepMethodIds) =>
    request(`/flows/${flowId}/steps/${stepId}/methods/reorder`, {
      method: "PUT",
      body: JSON.stringify(stepMethodIds),
    }),
  detachMethodFromStep: (stepMethodId) =>
    request(`/step-methods/${stepMethodId}`, { method: "DELETE" }),

  // ── Trends, History, & Graph ─────────────────────────────────────────────
  getStepTrends: (flowId) => request(`/api/flows/${flowId}/trends`),
  getFlowHistory: (flowId) => request(`/api/flows/${flowId}/history`),
  getDependencyGraph: (flowId) => request(`/api/flows/${flowId}/dependency-graph`),

  // ── Import ────────────────────────────────────────────────────────────────
  /** POST /import/postman  multipart: { file, flowName, moduleId } */
  importPostman: (file, flowName, moduleId) => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("flowName", flowName);
    formData.append("moduleId", moduleId);

    return fetchWithAuth(`${BASE_URL}/import/postman`, {
      method: "POST",
      body: formData,
    }).then(async (res) => {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      return data;
    });
  },

  /** POST /import/swagger  multipart: { file, flowName, moduleId } */
  importSwagger: (file, flowName, moduleId) => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("flowName", flowName);
    formData.append("moduleId", moduleId);

    return fetchWithAuth(`${BASE_URL}/import/swagger`, {
      method: "POST",
      body: formData,
    }).then(async (res) => {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      return data;
    });
  },

  /** POST /import/har  multipart: { file, flowName, moduleId } */
  importHar: (file, flowName, moduleId) => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("flowName", flowName);
    formData.append("moduleId", moduleId);

    return fetchWithAuth(`${BASE_URL}/import/har`, {
      method: "POST",
      body: formData,
    }).then(async (res) => {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      return data;
    });
  },

  // ── Browser Recording ─────────────────────────────────────────────────────
  /** POST /record/start  body: { url, moduleId, flowName, port?, attach?, include?, chromePath?, redactedHeaders?, flowId? } */
  startRecording: (body) =>
    request(`/record/start`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** GET /record/{sessionId} */
  getRecordingStatus: (sessionId) => request(`/record/${sessionId}`),

  /** GET /record */
  listRecordings: () => request(`/record`),

  /** POST /record/{sessionId}/stop  → FlowDetailedDTO */
  stopAndImportRecording: (sessionId) =>
    request(`/record/${sessionId}/stop`, { method: "POST" }),

  /** POST /record/{sessionId}/preview  → RecordedRequest[] */
  stopAndPreviewRecording: (sessionId) =>
    request(`/record/${sessionId}/preview`, { method: "POST" }),

  /** POST /record/{sessionId}/import?moduleId=&flowName= → FlowDetailedDTO */
  importRecordingPreview: (sessionId, { moduleId, flowName, flowId } = {}) => {
    const params = new URLSearchParams();
    if (moduleId != null) params.append("moduleId", moduleId);
    if (flowName) params.append("flowName", flowName);
    if (flowId != null) params.append("flowId", flowId);
    return request(`/record/${sessionId}/import?${params.toString()}`, {
      method: "POST",
    });
  },

  /** DELETE /record/{sessionId} */
  discardRecording: (sessionId) =>
    request(`/record/${sessionId}`, { method: "DELETE" }),
  /** POST /record/{sessionId}/pause */
  pauseRecording: (sessionId) =>
    request(`/record/${sessionId}/pause`, { method: "POST" }),
  /** POST /record/{sessionId}/resume */
  resumeRecording: (sessionId) =>
    request(`/record/${sessionId}/resume`, { method: "POST" }),

  // ── Application Assistant ─────────────────────────────────────────────────
  /** POST /assistant/chat → AssistantChatResponse */
  assistantChat: ({ message, executeActions = false, history = [] } = {}) =>
    request(`/assistant/chat`, {
      method: "POST",
      body: JSON.stringify({ message, executeActions, history }),
    }),

  /**
   * POST /assistant/upload (multipart) → FlowDetailedDTO
   * Auto-detects type (Postman / Swagger / HAR) on the backend.
   * `filterDomain` and `flowId` are only used for HAR imports.
   */
  assistantUpload: ({ file, moduleId, flowName, flowId, filterDomain } = {}) => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("moduleId", String(moduleId));
    formData.append("flowName", flowName);
    if (flowId != null && flowId !== "") formData.append("flowId", String(flowId));
    if (filterDomain) formData.append("filterDomain", filterDomain);

    return fetchWithAuth(`${BASE_URL}/assistant/upload`, {
      method: "POST",
      body: formData,
    }).then(async (res) => {
      const ct = res.headers.get("content-type") || "";
      const data = ct.includes("application/json")
        ? await res.json().catch(() => ({}))
        : await res.text().catch(() => "");
      if (!res.ok) {
        const msg =
          (data && typeof data === "object" && (data.error || data.message)) ||
          (typeof data === "string" && data) ||
          `Upload failed (${res.status})`;
        throw new Error(msg);
      }
      return data;
    });
  },
};
