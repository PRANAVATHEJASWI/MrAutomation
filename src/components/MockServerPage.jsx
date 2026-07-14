import { useEffect, useMemo, useState } from "react";
import { mockApi } from "../utils/mockApi";
import Button from "./ui/button/Button";
import Input from "./ui/input/Input";
import Textarea from "./ui/textarea/Textarea";
import { toast } from "./ui/toast/toast";
import styles from "./MockServerPage.module.css";

const EMPTY_CONDITIONS = `[
  {
    "operator": "ALL",
    "whenExpr": "$.amount > 5000",
    "rules": [
      { "field": "amount", "operator": "gt", "value": 5000 }
    ],
    "response": {
      "status": 202,
      "headers": { "Content-Type": "application/json" },
      "body": { "decision": "MANUAL_REVIEW" }
    }
  }
]`;

const SCENARIO_FORM = {
  id: "",
  name: "",
  method: "ANY",
  endpoint: "/payments/authorize",
  delayMs: 0,
  randomDelayMinMs: 0,
  randomDelayMaxMs: 0,
  faultType: "NONE",
  conditionsJson: EMPTY_CONDITIONS,
};

const GENERATOR_FORM = {
  endpoint: "/payments/authorize",
  description: "Generate approve, reject, and manual-review outcomes.",
  sampleRequestBody: '{\n  "amount": 10000,\n  "customerTier": "gold"\n}',
  sampleHeaders: '{\n  "X-Tenant": "sandbox"\n}',
  sampleQueryParams: '{\n  "region": "IN"\n}',
  responseStructure: '{\n  "decision": "APPROVED",\n  "reason": "string"\n}',
};

const TRY_FORM = {
  method: "POST",
  path: "/payments/authorize",
  body: '{\n  "amount": 999,\n  "customerTier": "standard"\n}',
  headersJson: '{\n  "Content-Type": "application/json"\n}',
};

const METHOD_OPTIONS = ["ANY", "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const FAULT_OPTIONS = ["NONE", "TIMEOUT", "CONNECTION_RESET"];

function parseJsonArray(raw, fieldName) {
  const parsed = JSON.parse(raw || "[]");
  if (!Array.isArray(parsed)) throw new Error(`${fieldName} must be a JSON array`);
  return parsed;
}

function parseJsonObject(raw, fieldName, fallback = {}) {
  if (!raw?.trim()) return fallback;
  const parsed = JSON.parse(raw);
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${fieldName} must be a JSON object`);
  }
  return parsed;
}

function mapScenarioToForm(scenario) {
  const firstResponse = scenario?.conditions?.[0]?.response || {};
  return {
    id: scenario.id || "",
    name: scenario.name || "",
    method: (scenario.method || "ANY").toUpperCase(),
    endpoint: scenario.endpoint || "/",
    delayMs: typeof firstResponse.delayMs === "number" ? firstResponse.delayMs : 0,
    randomDelayMinMs: typeof firstResponse.randomDelayMinMs === "number" ? firstResponse.randomDelayMinMs : 0,
    randomDelayMaxMs: typeof firstResponse.randomDelayMaxMs === "number" ? firstResponse.randomDelayMaxMs : 0,
    faultType: (firstResponse.faultType || "NONE").toUpperCase(),
    conditionsJson: JSON.stringify(scenario.conditions || [], null, 2),
  };
}

function normalizeNumber(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function applyResponseControls(conditions, form) {
  return (Array.isArray(conditions) ? conditions : []).map((condition) => {
    const response = condition?.response && typeof condition.response === "object" ? condition.response : {};
    return {
      ...condition,
      response: {
        ...response,
        delayMs: normalizeNumber(form.delayMs, 0),
        randomDelayMinMs: normalizeNumber(form.randomDelayMinMs, 0),
        randomDelayMaxMs: normalizeNumber(form.randomDelayMaxMs, 0),
        faultType: String(form.faultType || "NONE").toUpperCase(),
      },
    };
  });
}

function normalizeScenariosByEndpoint(apiResponse) {
  if (!apiResponse || typeof apiResponse !== "object") return {};

  if (Array.isArray(apiResponse.scenarios)) {
    return apiResponse.scenarios.reduce((acc, scenario) => {
      const endpoint = scenario?.endpoint || "/";
      if (!acc[endpoint]) acc[endpoint] = [];
      acc[endpoint].push({ ...scenario, endpoint });
      return acc;
    }, {});
  }

  return Object.entries(apiResponse).reduce((acc, [endpoint, scenarios]) => {
    if (!Array.isArray(scenarios)) return acc;
    acc[endpoint] = scenarios.map((scenario) => ({
      ...scenario,
      endpoint: scenario?.endpoint || endpoint,
    }));
    return acc;
  }, {});
}

export default function MockServerPage() {
  const [loading, setLoading] = useState(false);
  const [scenariosByEndpoint, setScenariosByEndpoint] = useState({});
  const [selectedScenarioId, setSelectedScenarioId] = useState(null);
  const [scenarioForm, setScenarioForm] = useState(SCENARIO_FORM);
  const [generatorForm, setGeneratorForm] = useState(GENERATOR_FORM);
  const [draftScenario, setDraftScenario] = useState(null);
  const [generatingDraft, setGeneratingDraft] = useState(false);
  const [operators, setOperators] = useState({});
  const [tryForm, setTryForm] = useState(TRY_FORM);
  const [tryResponse, setTryResponse] = useState(null);
  const [tryError, setTryError] = useState("");
  const [tryLatencyMs, setTryLatencyMs] = useState(null);
  const [runningTry, setRunningTry] = useState(false);

  const allScenarios = useMemo(() => {
    return Object.entries(scenariosByEndpoint || {})
      .flatMap(([endpoint, scenarios]) =>
        (Array.isArray(scenarios) ? scenarios : []).map((scenario) => ({
          ...scenario,
          endpoint,
        }))
      )
      .sort((a, b) => {
        const endpointCompare = String(a.endpoint || "").localeCompare(String(b.endpoint || ""));
        if (endpointCompare !== 0) return endpointCompare;
        return String(a.name || "").localeCompare(String(b.name || ""));
      });
  }, [scenariosByEndpoint]);

  const selectedScenario = useMemo(() => {
    if (!selectedScenarioId) return null;
    return allScenarios.find((scenario) => String(scenario.id) === String(selectedScenarioId)) || null;
  }, [allScenarios, selectedScenarioId]);

  useEffect(() => {
    void loadPageData();
  }, []);

  useEffect(() => {
    if (!selectedScenarioId) return;
    const exists = allScenarios.some((scenario) => String(scenario.id) === String(selectedScenarioId));
    if (!exists) setSelectedScenarioId(null);
  }, [allScenarios, selectedScenarioId]);

  useEffect(() => {
    if (!selectedScenario) return;
    setGeneratorForm((prev) => ({
      ...prev,
      endpoint: selectedScenario.endpoint || prev.endpoint,
    }));
  }, [selectedScenario]);

  async function loadPageData() {
    setLoading(true);
    try {
      const [scenarioResult, operatorResult] = await Promise.all([
        mockApi.listScenarios(),
        mockApi.listOperators(),
      ]);
      setScenariosByEndpoint(normalizeScenariosByEndpoint(scenarioResult));
      setOperators(operatorResult && typeof operatorResult === "object" ? operatorResult : {});
    } catch (err) {
      toast.error("Failed to load Mock Spaces data: " + err.message);
    } finally {
      setLoading(false);
    }
  }

  function resetScenarioForm(endpoint = "/") {
    setScenarioForm({
      ...SCENARIO_FORM,
      endpoint,
    });
  }

  function handleEditScenario(scenario) {
    setScenarioForm(mapScenarioToForm(scenario));
    setSelectedScenarioId(null);
  }

  async function handleSaveScenario(e) {
    e.preventDefault();
    if (!scenarioForm.name.trim()) {
      toast.error("Scenario name is required");
      return;
    }
    if (!scenarioForm.endpoint.trim()) {
      toast.error("Endpoint is required");
      return;
    }

    try {
      const payload = {
        name: scenarioForm.name.trim(),
        method: String(scenarioForm.method || "ANY").toUpperCase(),
        endpoint: scenarioForm.endpoint.trim(),
        conditions: applyResponseControls(
          parseJsonArray(scenarioForm.conditionsJson, "Conditions"),
          scenarioForm
        ),
      };
      if (scenarioForm.id) payload.id = String(scenarioForm.id);

      const saved = await mockApi.upsertScenario(payload);
      toast.success(scenarioForm.id ? "Scenario updated" : "Scenario created");
      await loadPageData();
      if (saved?.id) setSelectedScenarioId(String(saved.id));
      resetScenarioForm(saved?.endpoint || payload.endpoint || "/");
    } catch (err) {
      toast.error("Failed to save scenario: " + err.message);
    }
  }

  async function handleDeleteScenario(scenario) {
    if (!window.confirm(`Delete scenario \"${scenario.name}\"?`)) return;

    try {
      await mockApi.deleteScenario(scenario.id);
      toast.success("Scenario deleted");
      await loadPageData();
      if (String(selectedScenarioId) === String(scenario.id)) setSelectedScenarioId(null);
      if (String(scenarioForm.id) === String(scenario.id)) resetScenarioForm(scenario.endpoint || "/");
    } catch (err) {
      toast.error("Failed to delete scenario: " + err.message);
    }
  }

  async function handleClearAll() {
    if (!window.confirm("Clear all scenarios in Mock Spaces?")) return;

    try {
      await mockApi.clearScenarios();
      toast.success("All scenarios cleared");
      setSelectedScenarioId(null);
      resetScenarioForm("/");
      await loadPageData();
    } catch (err) {
      toast.error("Failed to clear scenarios: " + err.message);
    }
  }

  async function handleGenerateDraft() {
    if (generatingDraft) return;
    if (!generatorForm.description.trim()) {
      toast.error("Generator description is required");
      return;
    }

    try {
      setGeneratingDraft(true);
      let draft;
      if (selectedScenario) {
        draft = await mockApi.modifyScenario({
          id: String(selectedScenario.id),
          existingScenario: selectedScenario,
          description: generatorForm.description,
          sampleRequestBody: generatorForm.sampleRequestBody,
          responseStructure: generatorForm.responseStructure,
        });
      } else {
        if (!generatorForm.endpoint.trim()) {
          toast.error("Generator endpoint is required");
          return;
        }
        draft = await mockApi.generateScenario({
          endpoint: generatorForm.endpoint.trim(),
          description: generatorForm.description,
          sampleRequestBody: generatorForm.sampleRequestBody,
          sampleHeaders: parseJsonObject(generatorForm.sampleHeaders, "Sample headers"),
          sampleQueryParams: parseJsonObject(generatorForm.sampleQueryParams, "Sample query params"),
          responseStructure: generatorForm.responseStructure,
        });
      }
      setDraftScenario(draft);
      toast.success(selectedScenario ? "Scenario modification draft generated" : "Scenario draft generated");
    } catch (err) {
      toast.error("Scenario generation failed: " + err.message);
    } finally {
      setGeneratingDraft(false);
    }
  }

  function applyDraftToEditor() {
    if (!draftScenario) return;
    setScenarioForm(mapScenarioToForm(draftScenario));
    setSelectedScenarioId(null);
    setDraftScenario(null);
    toast.success("Draft copied to scenario editor");
  }

  async function handleTryMock() {
    if (!tryForm.path.trim()) {
      toast.error("Mock path is required");
      return;
    }

    try {
      const headers = parseJsonObject(tryForm.headersJson, "Request headers");
      setRunningTry(true);
      setTryError("");

      const started = Date.now();
      const response = await mockApi.invokeMock({
        method: tryForm.method,
        path: tryForm.path,
        body: tryForm.body,
        headers,
      });
      setTryLatencyMs(Date.now() - started);
      setTryResponse(response);
    } catch (err) {
      setTryError(err.message);
      setTryResponse(null);
    } finally {
      setRunningTry(false);
    }
  }

  function copyMockUrl() {
    const target = `${mockApi.getBaseUrl()}/mock${tryForm.path.startsWith("/") ? "" : "/"}${tryForm.path}`;
    navigator.clipboard.writeText(target);
    toast.success("Mock URL copied");
  }

  return (
    <div className={styles.page}>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <h2>Mock Spaces</h2>
          <Button size="small" variant="secondary" disabled={loading} onClick={loadPageData}>
            Refresh
          </Button>
        </div>

        <div className={styles.sidebarActions}>
          <Button
            variant="secondary"
            onClick={() => {
              resetScenarioForm(selectedScenario?.endpoint || "/new-endpoint");
              setSelectedScenarioId(null);
            }}
          >
            Create Scenario
          </Button>
          <Button variant="danger" onClick={handleClearAll}>
            Clear All
          </Button>
        </div>

        <p className={styles.sidebarHint}>Scenarios from /mock-admin/scenarios</p>

        <div className={styles.endpointList}>
          {allScenarios.map((scenario) => (
            <button
              key={scenario.id}
              type="button"
              className={`${styles.endpointItem} ${String(scenario.id) === String(selectedScenarioId) ? styles.endpointItemActive : ""}`}
              onClick={() => {
                setSelectedScenarioId(String(scenario.id));
              }}
            >
              <strong>{scenario.name || `Scenario ${scenario.id}`}</strong>
              <span>{scenario.endpoint}</span>
              <span>{(scenario.conditions || []).length} conditions</span>
            </button>
          ))}
          {allScenarios.length === 0 && <div className={styles.emptySmall}>No scenarios configured yet.</div>}
        </div>
      </aside>

      <main className={styles.main}>
        <section className={styles.hero}>
          <div>
            <h1>Scenario-Driven Mock Spaces</h1>
            <p>
              Design conditions via /mock-admin/scenarios, generate drafts via /mock-admin/scenarios/generate,
              and test runtime output through /mock/**.
            </p>
            <code>{mockApi.getBaseUrl()}</code>
          </div>
          <div className={styles.heroActions}>
            <Button variant="secondary" onClick={copyMockUrl}>Copy Active Mock URL</Button>
          </div>
        </section>

        <div className={styles.grid}>
          <section className={`${styles.card} ${styles.fullWidth}`}>
            <h3>Supported Operators</h3>
            <div className={styles.operatorGrid}>
              {Object.entries(operators).map(([group, values]) => (
                <div key={group} className={styles.operatorGroup}>
                  <strong>{group}</strong>
                  <div className={styles.operatorChips}>
                    {(Array.isArray(values) ? values : []).map((value) => (
                      <span key={value} className={styles.operatorChip}>{value}</span>
                    ))}
                  </div>
                </div>
              ))}
              {Object.keys(operators).length === 0 && (
                <div className={styles.emptySmall}>No operators returned by API.</div>
              )}
            </div>
          </section>

          <div className={styles.leftStack}>
            {!selectedScenario ? (
              <section className={styles.card}>
                <div className={styles.cardHeader}>
                  <h3>{scenarioForm.id ? "Edit Scenario" : "Create Scenario"}</h3>
                  {scenarioForm.id && (
                    <Button size="small" variant="secondary" onClick={() => resetScenarioForm(scenarioForm.endpoint || "/")}>
                      Cancel Edit
                    </Button>
                  )}
                </div>
                <form className={styles.editorForm} onSubmit={handleSaveScenario}>
                  <Input
                    label="Scenario Name"
                    value={scenarioForm.name}
                    onChange={(e) => setScenarioForm((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder="High value payments"
                    required
                  />
                  <div className={styles.rowGrid}>
                    <label className={styles.labelField}>
                      Method Type
                      <select
                        value={scenarioForm.method}
                        onChange={(e) => setScenarioForm((prev) => ({ ...prev, method: e.target.value }))}
                      >
                        {METHOD_OPTIONS.map((method) => (
                          <option key={method} value={method}>{method}</option>
                        ))}
                      </select>
                    </label>
                    <Input
                      label="Endpoint"
                      value={scenarioForm.endpoint}
                      onChange={(e) => setScenarioForm((prev) => ({ ...prev, endpoint: e.target.value }))}
                      placeholder="/payments/authorize"
                      required
                    />
                  </div>
                  <div className={styles.responseControlsGrid}>
                    <Input
                      label="delayMs"
                      type="number"
                      value={scenarioForm.delayMs}
                      onChange={(e) => setScenarioForm((prev) => ({ ...prev, delayMs: e.target.value }))}
                    />
                    <Input
                      label="randomDelayMinMs"
                      type="number"
                      value={scenarioForm.randomDelayMinMs}
                      onChange={(e) => setScenarioForm((prev) => ({ ...prev, randomDelayMinMs: e.target.value }))}
                    />
                    <Input
                      label="randomDelayMaxMs"
                      type="number"
                      value={scenarioForm.randomDelayMaxMs}
                      onChange={(e) => setScenarioForm((prev) => ({ ...prev, randomDelayMaxMs: e.target.value }))}
                    />
                    <label className={styles.labelField}>
                      faultType
                      <select
                        value={scenarioForm.faultType}
                        onChange={(e) => setScenarioForm((prev) => ({ ...prev, faultType: e.target.value }))}
                      >
                        {FAULT_OPTIONS.map((faultType) => (
                          <option key={faultType} value={faultType}>{faultType}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <Textarea
                    label="Conditions JSON"
                    rows={15}
                    mono
                    value={scenarioForm.conditionsJson}
                    onChange={(e) => setScenarioForm((prev) => ({ ...prev, conditionsJson: e.target.value }))}
                  />
                  <Button type="submit">{scenarioForm.id ? "Update Scenario" : "Create Scenario"}</Button>
                </form>
              </section>
            ) : (
              <section className={styles.card}>
                <div className={styles.cardHeader}>
                  <h3>Scenario Details</h3>
                  <div className={styles.rowActions}>
                    <Button size="small" variant="secondary" onClick={() => handleEditScenario(selectedScenario)}>
                      Edit in Form
                    </Button>
                    <Button size="small" variant="danger" onClick={() => handleDeleteScenario(selectedScenario)}>
                      Delete
                    </Button>
                  </div>
                </div>
                <div className={styles.detailsBlock}>
                  <div className={styles.detailRow}><span>Name</span><strong>{selectedScenario.name}</strong></div>
                  <div className={styles.detailRow}><span>ID</span><strong>{selectedScenario.id}</strong></div>
                  <div className={styles.detailRow}><span>Endpoint</span><strong>{selectedScenario.endpoint}</strong></div>
                  <div className={styles.detailRow}><span>Conditions</span><strong>{(selectedScenario.conditions || []).length}</strong></div>
                </div>
                <Textarea label="Conditions JSON" rows={16} mono value={JSON.stringify(selectedScenario.conditions || [], null, 2)} readOnly />
              </section>
            )}

            <section className={styles.card}>
              <h3>Live Mock Request</h3>
              <div className={styles.tryForm}>
                <div className={styles.rowGrid}>
                  <label className={styles.labelField}>
                    Method
                    <select
                      value={tryForm.method}
                      onChange={(e) => setTryForm((prev) => ({ ...prev, method: e.target.value }))}
                    >
                      {["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].map((method) => (
                        <option key={method} value={method}>{method}</option>
                      ))}
                    </select>
                  </label>
                  <Input
                    label="Path"
                    value={tryForm.path}
                    onChange={(e) => setTryForm((prev) => ({ ...prev, path: e.target.value }))}
                    placeholder="/payments/authorize"
                  />
                </div>
                <Textarea
                  label="Headers JSON"
                  rows={4}
                  mono
                  value={tryForm.headersJson}
                  onChange={(e) => setTryForm((prev) => ({ ...prev, headersJson: e.target.value }))}
                />
                <Textarea
                  label={tryForm.method === "GET" ? "Body Query Payload (sent as ?body=...)" : "Body"}
                  rows={7}
                  mono
                  value={tryForm.body}
                  onChange={(e) => setTryForm((prev) => ({ ...prev, body: e.target.value }))}
                />
                <div className={styles.rowActions}>
                  <Button onClick={handleTryMock} disabled={runningTry}>{runningTry ? "Sending..." : "Send Request"}</Button>
                  {tryLatencyMs != null && <span className={styles.muted}>{tryLatencyMs} ms</span>}
                </div>
                {tryError ? <div className={styles.errorBanner}>{tryError}</div> : null}
                {tryResponse != null ? <pre className={styles.codeBlock}>{JSON.stringify(tryResponse, null, 2)}</pre> : null}
              </div>
            </section>
          </div>

          <section className={styles.card}>
            <h3>LLM Scenario Draft</h3>
            <div className={styles.editorForm}>
              {selectedScenario ? (
                <span className={styles.muted}>Modify mode for selected scenario: {selectedScenario.name}</span>
              ) : (
                <span className={styles.muted}>Generate mode for a new scenario.</span>
              )}
              <Input
                label="Endpoint"
                value={generatorForm.endpoint}
                onChange={(e) => setGeneratorForm((prev) => ({ ...prev, endpoint: e.target.value }))}
                readOnly={!!selectedScenario}
              />
              <Textarea
                label="Description"
                rows={3}
                value={generatorForm.description}
                onChange={(e) => setGeneratorForm((prev) => ({ ...prev, description: e.target.value }))}
              />
              <Textarea
                label="Sample Request Body"
                rows={5}
                mono
                value={generatorForm.sampleRequestBody}
                onChange={(e) => setGeneratorForm((prev) => ({ ...prev, sampleRequestBody: e.target.value }))}
              />
              <Textarea
                label="Sample Headers JSON"
                rows={4}
                mono
                value={generatorForm.sampleHeaders}
                onChange={(e) => setGeneratorForm((prev) => ({ ...prev, sampleHeaders: e.target.value }))}
              />
              <Textarea
                label="Sample Query Params JSON"
                rows={4}
                mono
                value={generatorForm.sampleQueryParams}
                onChange={(e) => setGeneratorForm((prev) => ({ ...prev, sampleQueryParams: e.target.value }))}
              />
              <Textarea
                label="Response Structure"
                rows={4}
                mono
                value={generatorForm.responseStructure}
                onChange={(e) => setGeneratorForm((prev) => ({ ...prev, responseStructure: e.target.value }))}
              />
              <div className={styles.rowActions}>
                <Button variant="secondary" onClick={handleGenerateDraft} disabled={generatingDraft}>
                  {generatingDraft
                    ? (selectedScenario ? "Modifying..." : "Generating...")
                    : (selectedScenario ? "Modify Selected Scenario" : "Generate Draft")}
                </Button>
                <Button onClick={applyDraftToEditor} disabled={!draftScenario || generatingDraft}>Apply Draft</Button>
              </div>
              {draftScenario && <pre className={styles.codeBlock}>{JSON.stringify(draftScenario, null, 2)}</pre>}
            </div>
          </section>

        </div>
      </main>
    </div>
  );
}
