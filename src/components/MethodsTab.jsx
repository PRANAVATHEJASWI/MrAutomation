import { useState, useEffect } from "react";
import { api } from "../utils/api";
import { toast } from "./ui/toast/toast";
import { confirm } from "./ui/confirm/confirm";
import Button from "./ui/button/Button";
import Input from "./ui/input/Input";
import Textarea from "./ui/textarea/Textarea";
import IconButton from "./ui/icon-button/IconButton";
import Modal from "./ui/modal/Modal";
import { IconDelete, IconEdit } from "./ui/icons/Icons";
import styles from "./MethodsTab.module.css";

const USAGE_HINTS_CACHE_KEY = "mr_auto_method_usage_hints";

function parseHintsFromJson(raw) {
  if (!raw || typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter(Boolean).map(String);
    if (typeof parsed === "string" && parsed.trim()) return [parsed.trim()];
    return [];
  } catch {
    return [];
  }
}

function extractUsageHints(method) {
  if (!method || typeof method !== "object") return [];

  const direct = method.usageHints;
  if (Array.isArray(direct)) return direct.filter(Boolean).map(String);
  if (typeof direct === "string" && direct.trim()) return [direct.trim()];

  const misspelled = method.usageHinds;
  if (Array.isArray(misspelled)) return misspelled.filter(Boolean).map(String);
  if (typeof misspelled === "string" && misspelled.trim()) return [misspelled.trim()];

  const alt = method.usageHint;
  if (Array.isArray(alt)) return alt.filter(Boolean).map(String);
  if (typeof alt === "string" && alt.trim()) return [alt.trim()];

  const nested = method.metadata?.usageHints || method.hints?.usageHints;
  if (Array.isArray(nested)) return nested.filter(Boolean).map(String);
  if (typeof nested === "string" && nested.trim()) return [nested.trim()];

  const jsonHints = parseHintsFromJson(method.usageHintsJson || method.usageHintsText || method.hintsJson);
  if (jsonHints.length > 0) return jsonHints;

  return [];
}

function readHintsCache() {
  try {
    const raw = localStorage.getItem(USAGE_HINTS_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeHintsCache(cache) {
  try {
    localStorage.setItem(USAGE_HINTS_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Ignore storage failures.
  }
}

function mergeMethodWithHints(method, cache) {
  const fromPayload = extractUsageHints(method);
  const fromCache = cache?.[method?.id] || [];
  const merged = fromPayload.length > 0 ? fromPayload : fromCache;
  return { ...method, usageHints: merged };
}

function getMethodIdentifier(payload, fallbackId = null) {
  return payload?.id ?? payload?.methodId ?? fallbackId;
}

function MethodsTab({ flowId, stepId }) {
  const [methods, setMethods] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showGenerateForm, setShowGenerateForm] = useState(false);
  
  // Form state for generating custom method
  const [methodName, setMethodName] = useState("");
  const [methodDescription, setMethodDescription] = useState("");
  const [parameters, setParameters] = useState([{ name: "", type: "", description: "", required: false }]);
  const [generatingMethod, setGeneratingMethod] = useState(false);
  
  // Form state for testing method
  const [testMethodId, setTestMethodId] = useState("");
  const [testParameters, setTestParameters] = useState({});
  const [testingMethod, setTestingMethod] = useState(false);
  const [testResult, setTestResult] = useState(null);

  // Form state for editing existing method
  const [editingMethodId, setEditingMethodId] = useState(null);
  const [editMethodName, setEditMethodName] = useState("");
  const [editMethodDescription, setEditMethodDescription] = useState("");
  const [editMethodScript, setEditMethodScript] = useState("");
  const [editParameters, setEditParameters] = useState([
    { name: "", type: "", description: "", required: false },
  ]);
  const [updatingMethod, setUpdatingMethod] = useState(false);
  const [savingMethodId, setSavingMethodId] = useState(null);
  const [discardingMethodId, setDiscardingMethodId] = useState(null);

  // Form state for attaching method to step
  const [attachingMethodId, setAttachingMethodId] = useState(null);
  const [attachParameterBindings, setAttachParameterBindings] = useState({});
  const [attachingToStep, setAttachingToStep] = useState(false);

  const [stepMethods, setStepMethods] = useState([]);
  const [detachingStepMethodId, setDetachingStepMethodId] = useState(null);
  const [reorderingStepMethods, setReorderingStepMethods] = useState(false);

  // Parameter types
  const [availableParameterTypes, setAvailableParameterTypes] = useState([]);

  useEffect(() => {
    fetchMethods();
    fetchStepMethods();
    fetchParameterTypes();
  }, [flowId, stepId]);

  async function fetchParameterTypes() {
    try {
      const types = await api.getMethodParameterTypes();
      setAvailableParameterTypes(Array.isArray(types) ? types : ["string", "number", "boolean"]);
    } catch (err) {
      console.warn("Failed to fetch parameter types, using defaults", err);
      setAvailableParameterTypes(["string", "number", "boolean"]);
    }
  }

  async function fetchStepMethods() {
    if (!flowId || !stepId) return;
    try {
      const data = await api.getStepMethods(flowId, stepId);
      setStepMethods(Array.isArray(data) ? data : []);
    } catch (err) {
      console.warn("[MethodsTab] getStepMethods failed:", err);
      setStepMethods([]);
    }
  }

  function getAttachedStepMethod(methodId) {
    return (
      stepMethods.find(
        (sm) => sm?.methodId === methodId || sm?.method?.id === methodId
      ) || null
    );
  }

  function getStepMethodId(attached) {
    if (!attached) return null;
    return attached.stepMethodId ?? attached.id ?? null;
  }

  function getStepMethodName(attached) {
    if (!attached) return "Method";
    return attached.methodName || attached.method?.name || attached.name || `Method ${attached.methodId || attached.method?.id || ""}`;
  }

  function getSortedStepMethods(list = stepMethods) {
    return [...(Array.isArray(list) ? list : [])].sort((a, b) => {
      const parsedOrderA = parseInt(a?.executionOrder);
      const parsedOrderB = parseInt(b?.executionOrder);
      const orderA = Number.isFinite(parsedOrderA) ? parsedOrderA : 999999;
      const orderB = Number.isFinite(parsedOrderB) ? parsedOrderB : 999999;
      if (orderA !== orderB) return orderA - orderB;
      return (getStepMethodId(a) || 0) - (getStepMethodId(b) || 0);
    });
  }

  function getAttachedOrder(attached) {
    if (!attached) return null;
    const attachedId = getStepMethodId(attached);
    const idx = getSortedStepMethods().findIndex((sm) => getStepMethodId(sm) === attachedId);
    return idx >= 0 ? idx + 1 : null;
  }

  function getStepMethodBindings(attached) {
    if (!attached) return {};
    if (attached.parameterBindings && typeof attached.parameterBindings === "object") {
      return attached.parameterBindings;
    }
    return parseBindingsJson(attached.parameterBindingsJson);
  }

  function parseBindingsJson(json) {
    if (!json) return {};
    if (typeof json === "object") return json;
    try {
      return JSON.parse(json) || {};
    } catch {
      return {};
    }
  }

  async function fetchMethods() {
    setLoading(true);
    try {
      const data = await api.getAllMethodsIncludingDrafts();
      const cache = readHintsCache();
      const list = Array.isArray(data) ? data : [];
      const merged = list.map((m) => mergeMethodWithHints(m, cache));

      // Try to enrich missing hints from detail endpoint and cache them.
      const missingHintMethods = merged.filter((m) => !extractUsageHints(m).length);
      if (missingHintMethods.length > 0) {
        await Promise.all(
          missingHintMethods.map(async (m) => {
            try {
              const detail = await api.getMethodDetail(m.id);
              const detailHints = extractUsageHints(detail);
              if (detailHints.length > 0) {
                cache[m.id] = detailHints;
              }
            } catch {
              // Ignore detail errors and keep list usable.
            }
          })
        );
      }

      // Persist any hints seen from either list or detail.
      merged.forEach((m) => {
        const hints = extractUsageHints(m);
        if (hints.length > 0) cache[m.id] = hints;
      });
      writeHintsCache(cache);

      setMethods(merged.map((m) => mergeMethodWithHints(m, cache)));
    } catch (err) {
      try {
        const fallbackData = await api.getAllMethods();
        const cache = readHintsCache();
        const list = Array.isArray(fallbackData) ? fallbackData : [];
        const merged = list.map((m) => mergeMethodWithHints(m, cache));
        setMethods(merged);
      } catch (fallbackErr) {
        toast.error("Failed to fetch methods: " + fallbackErr.message);
      }
    } finally {
      setLoading(false);
    }
  }

  function isUserDefinedMethod(method) {
    return method?.type === "USER_DEFINED";
  }

  function rememberUsageHints(payload, fallbackMethodId = null) {
    const hints = extractUsageHints(payload);
    const methodId = getMethodIdentifier(payload, fallbackMethodId);
    if (hints.length === 0 || methodId == null) return;

    const cache = readHintsCache();
    cache[methodId] = hints;
    writeHintsCache(cache);

    setMethods((current) =>
      current.map((method) =>
        String(method.id) === String(methodId)
          ? { ...method, usageHints: hints }
          : method
      )
    );
  }

  function startEditMethod(method) {
    setEditingMethodId(method.id);
    setEditMethodName(method.name || "");
    setEditMethodDescription(method.description || "");
    setEditMethodScript(method.groovyScript || "");

    if (Array.isArray(method.parameters) && method.parameters.length > 0) {
      setEditParameters(
        method.parameters.map((param) => ({
          name: param.name || "",
          type: param.type || "",
          description: param.description || "",
          required: !!param.required,
        }))
      );
      return;
    }

    setEditParameters([{ name: "", type: "", description: "", required: false }]);
  }

  function cancelEditMethod() {
    setEditingMethodId(null);
    setEditMethodName("");
    setEditMethodDescription("");
    setEditMethodScript("");
    setEditParameters([{ name: "", type: "", description: "", required: false }]);
  }

  function handleAddEditParameter() {
    setEditParameters([
      ...editParameters,
      { name: "", type: "", description: "", required: false },
    ]);
  }

  function handleRemoveEditParameter(index) {
    setEditParameters(editParameters.filter((_, i) => i !== index));
  }

  function handleEditParameterChange(index, field, value) {
    const next = [...editParameters];
    next[index] = { ...next[index], [field]: value };
    setEditParameters(next);
  }

  async function handleUpdateMethod() {
    if (!editingMethodId) return;

    if (!editMethodName.trim()) {
      toast.error("Method name is required");
      return;
    }

    if (!editMethodDescription.trim()) {
      toast.error("Method description is required");
      return;
    }

    const validParams = editParameters.filter((param) => param.name.trim());
    if (validParams.length === 0) {
      toast.error("At least one parameter is required");
      return;
    }

    setUpdatingMethod(true);
    try {
      const updated = await api.updateMethod(editingMethodId, {
        name: editMethodName,
        description: editMethodDescription,
        parameters: validParams,
        groovyScript: editMethodScript.trim() ? editMethodScript : null,
      });

      rememberUsageHints(updated, editingMethodId);

      await fetchMethods();
      cancelEditMethod();
      toast.success("Method updated successfully");
    } catch (err) {
      toast.error("Failed to update method: " + err.message);
    } finally {
      setUpdatingMethod(false);
    }
  }

  async function handleSaveMethod(methodId) {
    setSavingMethodId(methodId);
    try {
      await api.saveMethod(methodId);
      await fetchMethods();
      toast.success("Method saved successfully");
    } catch (err) {
      toast.error("Failed to save method: " + err.message);
    } finally {
      setSavingMethodId(null);
    }
  }

  async function handleDiscardMethod(methodId) {
    const ok = await confirm({
      title: "Discard draft method?",
      message: "This will permanently delete the draft method. This cannot be undone.",
      confirmLabel: "Discard",
      variant: "danger",
    });
    if (!ok) return;

    setDiscardingMethodId(methodId);
    try {
      await api.discardMethod(methodId);
      if (String(methodId) === testMethodId) {
        setTestMethodId("");
        setTestParameters({});
        setTestResult(null);
      }
      await fetchMethods();
      toast.success("Method discarded successfully");
    } catch (err) {
      toast.error("Failed to discard method: " + err.message);
    } finally {
      setDiscardingMethodId(null);
    }
  }

  function startAttachMethod(method) {
    setAttachingMethodId(method.id);

    // Prefill from existing attachment if present
    const existing = getAttachedStepMethod(method.id);
    const existingBindings = getStepMethodBindings(existing);

    // Initialize parameter bindings for all parameters
    const bindings = {};
    if (Array.isArray(method.parameters)) {
      method.parameters.forEach((param) => {
        bindings[param.name] = existingBindings[param.name] || "";
      });
    }
    setAttachParameterBindings(bindings);
  }

  function cancelAttachMethod() {
    setAttachingMethodId(null);
    setAttachParameterBindings({});
  }

  function handleAttachParameterBindingChange(paramName, value) {
    setAttachParameterBindings({
      ...attachParameterBindings,
      [paramName]: value,
    });
  }

  async function handleAttachMethodToStep() {
    if (!attachingMethodId || !flowId || !stepId) {
      toast.error("Missing method, flow, or step information");
      return;
    }

    setAttachingToStep(true);
    try {
      // If already attached, detach first (re-attach with updated bindings)
      const existing = getAttachedStepMethod(attachingMethodId);
      const existingStepMethodId = getStepMethodId(existing);
      if (existingStepMethodId) {
        await api.detachMethodFromStep(existingStepMethodId);
      }

      await api.attachMethodToStep(flowId, stepId, {
        methodId: attachingMethodId,
        parameterBindings: attachParameterBindings,
      });

      cancelAttachMethod();
      await fetchStepMethods();
      toast.success(existing ? "Parameters updated" : "Method attached to step successfully");
    } catch (err) {
      toast.error("Failed to attach method: " + err.message);
    } finally {
      setAttachingToStep(false);
    }
  }

  async function handleDetachStepMethod(stepMethodId) {
    const ok = await confirm({
      title: "Remove method from step?",
      message: "This method will no longer run before this step.",
      confirmLabel: "Remove",
      variant: "danger",
    });
    if (!ok) return;
    setDetachingStepMethodId(stepMethodId);
    try {
      await api.detachMethodFromStep(stepMethodId);
      await fetchStepMethods();
      toast.success("Method removed from step");
    } catch (err) {
      toast.error("Failed to remove method: " + err.message);
    } finally {
      setDetachingStepMethodId(null);
    }
  }

  async function handleMoveStepMethod(stepMethodId, direction) {
    const sorted = getSortedStepMethods();
    const index = sorted.findIndex((sm) => getStepMethodId(sm) === stepMethodId);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= sorted.length) return;

    const next = [...sorted];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    const orderedIds = next.map(getStepMethodId).filter(Boolean);
    const previous = stepMethods;

    setReorderingStepMethods(true);
    setStepMethods(next.map((sm, idx) => ({ ...sm, executionOrder: idx + 1 })));
    try {
      await api.reorderStepMethods(flowId, stepId, orderedIds);
      await fetchStepMethods();
      toast.success("Method execution order updated");
    } catch (err) {
      setStepMethods(previous);
      toast.error("Failed to update method order: " + err.message);
    } finally {
      setReorderingStepMethods(false);
    }
  }

  function handleAddParameter() {
    setParameters([
      ...parameters,
      { name: "", type: "", description: "", required: false }
    ]);
  }

  function handleRemoveParameter(index) {
    setParameters(parameters.filter((_, i) => i !== index));
  }

  function handleParameterChange(index, field, value) {
    const newParams = [...parameters];
    newParams[index] = { ...newParams[index], [field]: value };
    setParameters(newParams);
  }

  async function handleGenerateMethod() {
    if (!methodName.trim()) {
      toast.error("Method name is required");
      return;
    }

    if (!methodDescription.trim()) {
      toast.error("Method description is required");
      return;
    }

    const validParams = parameters.filter(p => p.name.trim());
    if (validParams.length === 0) {
      toast.error("At least one parameter is required");
      return;
    }

    setGeneratingMethod(true);
    try {
      const generated = await api.generateMethod({
        name: methodName,
        description: methodDescription,
        parameters: validParams
      });

      rememberUsageHints(generated);

      await fetchMethods();
      setMethodName("");
      setMethodDescription("");
      setParameters([{ name: "", type: "", description: "", required: false }]);
      setShowGenerateForm(false);
      toast.success("Method generated successfully");
    } catch (err) {
      toast.error("Failed to generate method: " + err.message);
    } finally {
      setGeneratingMethod(false);
    }
  }

  async function handleTestMethod() {
    if (!testMethodId) {
      toast.error("Please select a method to test");
      return;
    }

    setTestingMethod(true);
    try {
      const result = await api.testMethod(parseInt(testMethodId), testParameters);
      setTestResult(result);
      rememberUsageHints(result, testMethodId);
      toast.success("Method tested successfully");
    } catch (err) {
      toast.error("Failed to test method: " + err.message);
    } finally {
      setTestingMethod(false);
    }
  }

  function handleTestParameterChange(key, value) {
    setTestParameters({ ...testParameters, [key]: value });
  }

  const selectedMethod = methods.find((method) => method.id === parseInt(testMethodId));

  return (
    <div className={styles.container}>
      {/* Available Methods Section */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h3>Available Methods</h3>
          <Button
            size="small"
            onClick={() => setShowGenerateForm(!showGenerateForm)}
          >
            {showGenerateForm ? "Cancel" : "+ Generate Custom Method"}
          </Button>
        </div>

        {loading ? (
          <div className={styles.loading}>Loading methods...</div>
        ) : methods.length === 0 ? (
          <div className={styles.emptyState}>
            No methods available. Create a custom method to get started.
          </div>
        ) : (
          <>
            {stepMethods.length > 0 && (
              <div className={styles.attachedOrderPanel}>
                <div className={styles.attachedOrderHeader}>
                  <div>
                    <strong>Attached Execution Order</strong>
                    <span>Methods run from top to bottom before this step.</span>
                  </div>
                  {reorderingStepMethods && <span className={styles.orderSaving}>Saving order...</span>}
                </div>
                <div className={styles.attachedOrderList}>
                  {getSortedStepMethods().map((attachedMethod, idx, ordered) => {
                    const stepMethodId = getStepMethodId(attachedMethod);
                    return (
                      <div key={stepMethodId} className={styles.attachedOrderRow}>
                        <span className={styles.orderIndex}>{idx + 1}</span>
                        <div className={styles.orderMethodInfo}>
                          <strong>{getStepMethodName(attachedMethod)}</strong>
                          <span>Step method ID: {stepMethodId}</span>
                        </div>
                        <div className={styles.orderControls}>
                          <button
                            type="button"
                            onClick={() => handleMoveStepMethod(stepMethodId, -1)}
                            disabled={idx === 0 || reorderingStepMethods}
                            title="Move earlier"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            onClick={() => handleMoveStepMethod(stepMethodId, 1)}
                            disabled={idx === ordered.length - 1 || reorderingStepMethods}
                            title="Move later"
                          >
                            ↓
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className={styles.methodsList}>
              {methods.map((method) => {
                const attached = getAttachedStepMethod(method.id);
                const attachedOrder = getAttachedOrder(attached);
                return (
              <div key={method.id} className={`${styles.methodCard} ${attached ? styles.methodCardAttached : ""}`}>
                <div className={styles.methodHeader}>
                  <div className={styles.methodTitleWrap}>
                    <h4>{method.name}</h4>
                    <span className={styles.methodType}>
                      {method.type === "BUILTIN" ? "Built-in" : method.global ? "Saved" : "Draft"}
                    </span>
                    {attached && (
                      <span className={styles.attachedBadge} title="Attached to this step">
                        ✓ Attached {attachedOrder ? `#${attachedOrder}` : ""}
                      </span>
                    )}
                  </div>
                  <span className={styles.methodId}>ID: {method.id}</span>
                </div>
                <p className={styles.methodDescription}>{method.description}</p>
                {(() => {
                  const list = extractUsageHints(method);
                  if (list.length === 0) return null;
                  return (
                    <div className={styles.usageHints}>
                      <strong>Usage -</strong>
                      <span>{list.join(" ")}</span>
                    </div>
                  );
                })()}
                {method.parameters && method.parameters.length > 0 && (
                  <div className={styles.parameters}>
                    <strong>Parameters:</strong>
                    <ul>
                      {method.parameters.map((param, idx) => (
                        <li key={idx}>
                          <code>{param.name}</code> ({param.type})
                          {param.required && <span className={styles.required}>*</span>}
                          {param.description && <span className={styles.paramDesc}> - {param.description}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className={styles.methodActions}>
                  {isUserDefinedMethod(method) && (
                    <>
                      <Button
                        variant="secondary"
                        size="small"
                        icon={<IconEdit size={14} />}
                        onClick={() =>
                          editingMethodId === method.id ? cancelEditMethod() : startEditMethod(method)
                        }
                      >
                        {editingMethodId === method.id ? "Cancel Edit" : "Edit"}
                      </Button>

                      {!method.global && (
                        <Button
                          size="small"
                          onClick={() => handleSaveMethod(method.id)}
                          disabled={savingMethodId === method.id}
                        >
                          {savingMethodId === method.id ? "Saving..." : "Save"}
                        </Button>
                      )}

                      {!method.global && (
                        <Button
                          variant="danger"
                          size="small"
                          onClick={() => handleDiscardMethod(method.id)}
                          disabled={discardingMethodId === method.id}
                        >
                          {discardingMethodId === method.id ? "Discarding..." : "Discard"}
                        </Button>
                      )}
                    </>
                  )}

                  <Button
                    variant="secondary"
                    size="small"
                    onClick={() =>
                      attachingMethodId === method.id ? cancelAttachMethod() : startAttachMethod(method)
                    }
                  >
                    {attachingMethodId === method.id
                      ? "Cancel"
                      : attached
                      ? "Edit Parameters"
                      : "Attach to Step"}
                  </Button>

                  {attached && (
                    <Button
                      variant="danger"
                      size="small"
                      onClick={() => handleDetachStepMethod(getStepMethodId(attached))}
                      disabled={detachingStepMethodId === getStepMethodId(attached)}
                    >
                      {detachingStepMethodId === getStepMethodId(attached) ? "Removing..." : "Remove from Step"}
                    </Button>
                  )}
                </div>

                {editingMethodId === method.id && (
                  <div className={styles.editForm}>
                    <Input
                      label="Method Name"
                      value={editMethodName}
                      onChange={(e) => setEditMethodName(e.target.value)}
                      placeholder="Method name"
                    />

                    <Textarea
                      label="Description"
                      rows={3}
                      value={editMethodDescription}
                      onChange={(e) => setEditMethodDescription(e.target.value)}
                      placeholder="Describe what this method does"
                    />

                    <Textarea
                      label="Groovy Script (Optional)"
                      rows={5}
                      mono
                      value={editMethodScript}
                      onChange={(e) => setEditMethodScript(e.target.value)}
                      placeholder="Leave empty to allow LLM regeneration from description"
                    />

                    <div className={styles.formGroup}>
                      <label className={styles.label}>Parameters</label>
                      <div className={styles.parametersList}>
                        {editParameters.map((param, idx) => (
                          <div key={idx} className={styles.parameterRow}>
                            <Input
                              placeholder="Parameter name"
                              value={param.name}
                              onChange={(e) =>
                                handleEditParameterChange(idx, "name", e.target.value)
                              }
                            />
                            <Input
                              placeholder="Type"
                              value={param.type}
                              onChange={(e) =>
                                handleEditParameterChange(idx, "type", e.target.value)
                              }
                            />
                            <Input
                              placeholder="Description"
                              value={param.description}
                              onChange={(e) =>
                                handleEditParameterChange(idx, "description", e.target.value)
                              }
                            />
                            <label className={styles.checkboxLabel}>
                              <input
                                type="checkbox"
                                checked={param.required}
                                onChange={(e) =>
                                  handleEditParameterChange(idx, "required", e.target.checked)
                                }
                              />
                              Required
                            </label>
                            {editParameters.length > 1 && (
                              <IconButton
                                size="small"
                                variant="ghost"
                                onClick={() => handleRemoveEditParameter(idx)}
                              >
                                <IconDelete size={16} />
                              </IconButton>
                            )}
                          </div>
                        ))}
                      </div>
                      <Button
                        variant="secondary"
                        size="small"
                        onClick={handleAddEditParameter}
                        style={{ marginTop: "8px" }}
                      >
                        + Add Parameter
                      </Button>
                    </div>

                    <div className={styles.editActions}>
                      <Button
                        variant="secondary"
                        onClick={cancelEditMethod}
                      >
                        Cancel
                      </Button>
                      <Button
                        onClick={handleUpdateMethod}
                        disabled={updatingMethod}
                      >
                        {updatingMethod ? "Updating..." : "Update Method"}
                      </Button>
                    </div>
                  </div>
                )}

                {attachingMethodId === method.id && (
                  <div className={styles.attachForm}>
                    {method.parameters && method.parameters.length > 0 ? (
                      <div className={styles.formGroup}>
                        <label className={styles.label}>Parameter Bindings</label>
                        <div className={styles.bindingsList}>
                          {method.parameters.map((param) => (
                            <div key={param.name} className={styles.bindingRow}>
                              <label className={styles.bindingLabel}>
                                {param.name}
                                {param.required && <span className={styles.required}>*</span>}
                              </label>
                              <Input
                                placeholder={`e.g. {stepName.response.field}`}
                                value={attachParameterBindings[param.name] || ""}
                                onChange={(e) =>
                                  handleAttachParameterBindingChange(param.name, e.target.value)
                                }
                              />
                              {param.description && (
                                <span className={styles.bindingHint}>{param.description}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <p className={styles.methodDescription}>
                        This method has no parameters. Click Attach to Step to add it.
                      </p>
                    )}

                    <div className={styles.attachActions}>
                      <Button
                        variant="secondary"
                        onClick={cancelAttachMethod}
                      >
                        Cancel
                      </Button>
                      <Button
                        onClick={handleAttachMethodToStep}
                        disabled={attachingToStep}
                      >
                        {attachingToStep
                          ? (getAttachedStepMethod(method.id) ? "Updating..." : "Attaching...")
                          : (getAttachedStepMethod(method.id) ? "Update Parameters" : "Attach to Step")}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Generate Custom Method Modal */}
      {showGenerateForm && (
        <Modal title="Generate Custom Method" onClose={() => setShowGenerateForm(false)} size="md">
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <div className={styles.formGroup}>
              <Input
                label="Method Name"
                placeholder="e.g. ValidateUser"
                value={methodName}
                onChange={(e) => setMethodName(e.target.value)}
                required
              />
            </div>

            <div className={styles.formGroup}>
              <Textarea
                label="Method Description"
                placeholder="Describe what this method does..."
                value={methodDescription}
                onChange={(e) => setMethodDescription(e.target.value)}
                rows={3}
                required
              />
            </div>

            <div className={styles.formGroup}>
              <label className={styles.label}>Parameters</label>
              <div className={styles.parametersList}>
                {parameters.map((param, idx) => (
                  <div key={idx} className={styles.parameterRow}>
                    <Input
                      placeholder="Parameter name"
                      value={param.name}
                      onChange={(e) =>
                        handleParameterChange(idx, "name", e.target.value)
                      }
                    />
                    <select
                      className={styles.select}
                      value={param.type}
                      onChange={(e) =>
                        handleParameterChange(idx, "type", e.target.value)
                      }
                    >
                      <option value="" disabled>Select Type</option>
                      {availableParameterTypes.map(type => (
                        <option key={type.value || type} value={type.value || type}>{type.label || type}</option>
                      ))}
                    </select>
                    <Input
                      placeholder="Description"
                      value={param.description}
                      onChange={(e) =>
                        handleParameterChange(idx, "description", e.target.value)
                      }
                    />
                    <label className={styles.checkboxLabel}>
                      <input
                        type="checkbox"
                        checked={param.required}
                        onChange={(e) =>
                          handleParameterChange(idx, "required", e.target.checked)
                        }
                      />
                      Required
                    </label>
                    {parameters.length > 1 && (
                      <IconButton
                        size="small"
                        variant="ghost"
                        onClick={() => handleRemoveParameter(idx)}
                      >
                        <IconDelete size={16} />
                      </IconButton>
                    )}
                  </div>
                ))}
              </div>
              <Button
                variant="secondary"
                size="small"
                onClick={handleAddParameter}
                style={{ marginTop: "8px", alignSelf: "flex-start" }}
              >
                + Add Parameter
              </Button>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "10px" }}>
              <Button variant="secondary" onClick={() => setShowGenerateForm(false)} disabled={generatingMethod}>
                Cancel
              </Button>
              <Button
                onClick={handleGenerateMethod}
                disabled={generatingMethod}
              >
                {generatingMethod ? "Generating..." : "Generate Method"}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Test Method Section */}
      <div className={styles.section}>
        <h3>Test Method</h3>
        <div className={styles.formGroup}>
          <label className={styles.label}>Select Method</label>
          <select
            value={testMethodId}
            onChange={(e) => {
              setTestMethodId(e.target.value);
              setTestParameters({});
              setTestResult(null);
            }}
            className={styles.select}
          >
            <option value="">-- Choose a method --</option>
            {methods.map((method) => (
              <option key={method.id} value={method.id}>
                {method.name} (ID: {method.id})
              </option>
            ))}
          </select>
        </div>

        {testMethodId && selectedMethod && (
          <div className={styles.formGroup}>
            <label className={styles.label}>Parameters</label>
            {selectedMethod?.parameters?.map((param) => (
                <Input
                  key={param.name}
                  label={`${param.name}${param.required ? "*" : ""}`}
                  placeholder={`Enter ${param.name}`}
                  value={testParameters[param.name] || ""}
                  onChange={(e) =>
                    handleTestParameterChange(param.name, e.target.value)
                  }
                />
              ))}
          </div>
        )}

        <Button
          onClick={handleTestMethod}
          disabled={testingMethod || !testMethodId}
        >
          {testingMethod ? "Testing..." : "Test Method"}
        </Button>

        {testResult && (
          <div className={styles.testResult}>
            <h4>Test Result:</h4>
            <pre>{JSON.stringify(testResult, null, 2)}</pre>
          </div>
        )}
      </div>
    </div>
  );
}

export default MethodsTab;
