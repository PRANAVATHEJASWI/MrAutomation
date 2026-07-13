import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useModules } from "../context/CollectionContext";
import { api } from "../utils/api";
import Button from "./ui/button/Button";
import IconButton from "./ui/icon-button/IconButton";
import Modal from "./ui/modal/Modal";
import Input from "./ui/input/Input";
import Textarea from "./ui/textarea/Textarea";
import { IconModule, IconPlus, IconPlay, IconDelete, IconFlow, IconStep, IconReport, IconDuplicate, IconEdit, IconRecord } from "./ui/icons/Icons";
import { toast } from "./ui/toast/toast";
import RecordFlowModal from "./RecordFlowModal";
import styles from "./LandingPage.module.css";

const slugify = (text) =>
  text.toLowerCase().replace(/[^\w ]+/g, "").replace(/ +/g, "-");

function LandingPage() {
  const navigate = useNavigate();
  const {
    modules,
    loading,
    error,
    executeModule,
    executions,
    executeBulkWithPolling, // FIX: use polling version
    dispatch,
  } = useModules();

  const [showCreate, setShowCreate] = useState(false);
  const [editingModule, setEditingModule] = useState(null);
  const [showImport, setShowImport] = useState(false);
  const [showRecord, setShowRecord] = useState(false);
  const [importTargetModuleId, setImportTargetModuleId] = useState(null);
  const [selectedEnvs, setSelectedEnvs] = useState({});

  const bulkExec = executions["bulk"];
  const bulkRunning = bulkExec?.status === "running";
  const bulkDone = bulkExec?.status === "done";

  async function handleBulkRun() {
    if (modules.length === 0 || bulkRunning) return;
    const ids = modules.map((m) => m.id);
    const envIds = modules.map((m) => {
      // If user explicitly selected an env (even "No Env" = ""), use that
      if (m.id in selectedEnvs) return selectedEnvs[m.id] || null;
      // Otherwise fall back to first available environment
      return m.environments?.[0]?.id || null;
    });

    try {
      // Pass total count to context for UI progress tracking
      await executeBulkWithPolling("module", ids, envIds);
      navigate("/report?type=bulk");
    } catch (err) {
      toast.error("Bulk execution failed: " + err.message);
    }
  }

  return (
    <div className={styles.landing}>
      <div className={styles.hero}>
        <div className={styles.heroContent}>
          <div className={styles.heroBadge}>v1.0.0 Alpha</div>
          <h1>API Orchestration <span className={styles.gradientText}>Simplified</span></h1>
          <p>Design, automate, and monitor your entire API ecosystem from a single, unified workspace. Powerful chaining, environment management, and scheduled runs.</p>
          <div className={styles.heroActions}>
            <Button onClick={() => setShowCreate(true)} icon={<IconPlus size={18} />}>
              Create Module
            </Button>
            <Button variant="secondary" onClick={() => setShowImport(true)} icon={<IconPlus size={18} style={{ transform: 'rotate(45deg)' }} />}>
              Import Collection
            </Button>
            <Button
              variant="primary"
              onClick={() => setShowRecord(true)}
              icon={<IconRecord size={14} />}
              className={styles.recordCta}
            >
              Record Flow
              <span className={styles.newBadge}>NEW</span>
            </Button>
            <Button
              variant="secondary"
              onClick={() => navigate("/performance")}
              icon={
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                </svg>
              }
            >
              Performance Test
            </Button>
            <Button
              variant="secondary"
              onClick={() => navigate("/mocks")}
              icon={
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="4" y="4" width="16" height="16" rx="2" />
                  <path d="M8 9h8M8 13h5M8 17h8" />
                </svg>
              }
            >
              Mock Server
            </Button>
          </div>
        </div>
        <div className={styles.quickStats}>
          <div className={styles.statBox}>
            <span className={styles.statVal}>{modules.length}</span>
            <span className={styles.statLabel}>Modules</span>
          </div>
          <div className={styles.statBox}>
            <span className={styles.statVal}>{modules.reduce((acc, m) => acc + (m.flows?.length || 0), 0)}</span>
            <span className={styles.statLabel}>Total Flows</span>
          </div>
          <div className={styles.statBox}>
            <span className={styles.statVal}>{modules.reduce((acc, m) => acc + (m.flows?.reduce((fAcc, f) => fAcc + (f.stepCount || 0), 0) || 0), 0)}</span>
            <span className={styles.statLabel}>Total Tests</span>
          </div>
          <div className={styles.statBox}>
            <span className={styles.statVal}>{modules.filter((m) => m.schedule?.active).length}</span>
            <span className={styles.statLabel}>Scheduled</span>
          </div>
        </div>
      </div>

      <div className={styles.sectionHeader}>
        <h2>Your Workspace</h2>
        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          {/* Bulk status badge */}
          {bulkRunning && (
            <div className={styles.bulkStatus}>
              <span className={styles.spinner} />
              Running Bulk: {bulkExec.results?.items?.length || 0} / {bulkExec.total || modules.length}
            </div>
          )}
          {bulkDone && (
            <div
              className={`${styles.bulkStatus} ${
                bulkExec.results?.status === "COMPLETED" || bulkExec.results?.status === "SUCCESS" || bulkExec.results?.passedItems === bulkExec.results?.totalItems
                  ? styles.bulkPass
                  : styles.bulkFail
              }`}
            >
              {bulkExec.results?.status === "COMPLETED" || bulkExec.results?.status === "SUCCESS" || bulkExec.results?.passedItems === bulkExec.results?.totalItems
                ? "✓ Bulk Completed"
                : "✗ Bulk Failed/Partial"}
            </div>
          )}

          <Button
            variant="secondary"
            onClick={handleBulkRun}
            disabled={loading || bulkRunning || modules.length === 0}
          >
            {bulkRunning ? "Running..." : "Bulk Run All"}
          </Button>

          <Button 
            variant="secondary" 
            onClick={() => navigate("/report")}
          >
            View Reports
          </Button>
        </div>
      </div>

      {loading && <div className={styles.loading}>Loading modules...</div>}
      {error && <div className={styles.error}>Error: {error}</div>}

      <div className={styles.grid}>
        {modules.map((mod) => (
          <ModuleCard 
            key={mod.id} 
            module={mod} 
            onEdit={() => setEditingModule(mod)} 
            selectedEnv={mod.id in selectedEnvs ? selectedEnvs[mod.id] : String(mod.environments?.[0]?.id || "")}
            onEnvChange={(envId) => setSelectedEnvs(prev => ({ ...prev, [mod.id]: envId }))}
          />
        ))}
        {!loading && modules.length === 0 && (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>🚀</div>
            <h3>Ready to start?</h3>
            <p>Create your first module or import a Postman collection to begin.</p>
            <div style={{ display: "flex", gap: "12px", marginTop: "12px" }}>
              <Button onClick={() => setShowCreate(true)} icon={<IconPlus size={18} />}>
                Create New
              </Button>
              <Button variant="secondary" onClick={() => setShowImport(true)}>
                Import JSON
              </Button>
            </div>
          </div>
        )}
      </div>

      {showCreate && <CreateModuleModal onClose={() => setShowCreate(false)} />}
      {editingModule && (
        <UpdateModuleModal module={editingModule} onClose={() => setEditingModule(null)} />
      )}
      {showImport && (
        <ImportPostmanModal
          onClose={() => setShowImport(false)}
          defaultModuleId={importTargetModuleId}
        />
      )}
      {showRecord && (
        <RecordFlowModal onClose={() => setShowRecord(false)} />
      )}
    </div>
  );
}

function ModuleCard({ module, onEdit, selectedEnv, onEnvChange }) {
  const { deleteModule, executeModule, executions } = useModules();
  const navigate = useNavigate();
  const [isParallel, setIsParallel] = useState(false);

  async function handleRun(e) {
    e.stopPropagation();
    if (executions[module.id]?.status === "running") return;
    try {
      await executeModule(module.id, selectedEnv, isParallel);
    } catch (err) {
      // handled in context
    }
  }

  function handleDelete(e) {
    e.stopPropagation();
    if (confirm(`Delete module "${module.name}" and all its flows?`)) {
      deleteModule(module.id);
    }
  }

  function handleOpen() {
    const slug = slugify(module.name);
    navigate(`/module/${slug}/${module.id}`);
  }

  const flowCount = module.flows?.length || 0;
  const testCount =
    module.flows?.reduce((acc, f) => acc + (f.stepCount || f.tests?.length || 0), 0) || 0;
  const exec = executions[module.id];

  return (
    <div className={styles.card} onClick={handleOpen}>
      <div className={styles.cardHeader}>
        <div className={styles.cardIcon}>
          <IconModule size={32} className={styles.accentIcon} />
        </div>
        <div className={styles.cardActions}>
          <IconButton
            variant="secondary"
            size="small"
            title="Edit module"
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
          >
            <IconEdit size={16} />
          </IconButton>
          <IconButton variant="danger" size="small" onClick={handleDelete}>
            <IconDelete size={16} />
          </IconButton>
        </div>
      </div>

      <div>
        <h3 className={styles.cardTitle}>{module.name}</h3>
        <p className={styles.cardDesc}>{module.description || "No description provided."}</p>
      </div>

      <div className={styles.cardMeta}>
        <div className={styles.metaItem}>
          <IconFlow size={16} className={styles.metaIcon} />
          <span>{flowCount} Flows</span>
        </div>
        <div className={styles.metaItem}>
          <IconStep size={16} className={styles.metaIcon} />
          <span>{testCount} Tests</span>
        </div>
        {module.environments?.length > 0 && (
          <div 
            className={styles.metaItem} 
            style={{ marginLeft: "auto" }}
            onClick={(e) => e.stopPropagation()}
          >
            <select
              style={{ 
                padding: "4px 8px", 
                fontSize: "12px", 
                height: "auto", 
                minWidth: "120px",
                background: "var(--bg-input)",
                border: "1px solid var(--border)",
                borderRadius: "6px",
                cursor: "pointer",
                outline: "none",
              }}
              value={String(selectedEnv || "")}
              onChange={(e) => {
                e.stopPropagation();
                onEnvChange(e.target.value);
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <option value="">No Env</option>
              {module.environments.map(env => (
                <option key={env.id} value={String(env.id)}>{env.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {module.schedule?.active && module.schedule?.time && (
        <div className={styles.scheduleBadge}>
          <span className={styles.scheduleDot} />
          <span>Scheduled · {(() => {
            try {
              const [h, m] = module.schedule.time.split(":");
              const date = new Date();
              date.setHours(parseInt(h), parseInt(m));
              return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
            } catch { return module.schedule.time; }
          })()}</span>
          {module.schedule.timezone && (
            <span className={styles.scheduleTz}>{module.schedule.timezone}</span>
          )}
        </div>
      )}

      <div className={styles.cardActions} style={{ marginTop: "auto" }}>
        <div style={{ display: "flex", gap: "10px", alignItems: "center", marginBottom: "12px" }} onClick={(e) => e.stopPropagation()}>
          <label style={{ fontSize: "12px", color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
            <input 
              type="checkbox" 
              checked={isParallel} 
              onChange={(e) => setIsParallel(e.target.checked)}
              style={{ accentColor: "var(--accent)" }}
            />
            Run Parallel
          </label>
        </div>
        <Button
          variant="primary"
          className={`${styles.runBtn} ${exec?.status === "running" ? styles.runningGlow : ""}`}
          onClick={handleRun}
          disabled={exec?.status === "running"}
          icon={
            exec?.status === "running" ? (
              <span className={styles.spinner} />
            ) : (
              <IconPlay size={16} />
            )
          }
          style={{ width: "100%" }}
        >
          {exec?.status === "running" ? "Running..." : "Run All"}
        </Button>

        {exec?.status === "done" && (
          <div style={{ display: "flex", gap: "8px", alignItems: "center", marginTop: "8px" }}>
            <div
              className={`${styles.statusIcon} ${
                exec.results?.allFlowsPassed ? styles.pass : styles.fail
              }`}
            >
              {exec.results?.allFlowsPassed ? "✓ Passed" : "✗ Failed"}
            </div>
            <IconButton
              size="small"
              variant="secondary"
              title="View Report"
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/report?type=module&id=${exec.results?.moduleExecutionId}`);
              }}
            >
              <IconReport size={16} />
            </IconButton>
          </div>
        )}
      </div>
    </div>
  );
}

function CreateModuleModal({ onClose }) {
  const { addModule } = useModules();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleCreate() {
    if (!name.trim()) return;
    setLoading(true);
    try {
      const newMod = await addModule(name, desc);
      const slug = slugify(newMod.name);
      onClose();
      navigate(`/module/${slug}/${newMod.id}`);
    } catch (err) {
      toast.error("Failed to create module: " + err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal title="Create New Module" onClose={onClose} size="sm">
      <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
        <Input
          label="Module Name"
          placeholder="e.g. Authentication, Billing"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        <Textarea
          label="Description"
          placeholder="Describe the purpose of this module..."
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          rows={3}
        />
        <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
          <Button variant="secondary" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button onClick={handleCreate} disabled={loading}>
            {loading ? "Creating..." : "Create"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function UpdateModuleModal({ module, onClose }) {
  const { updateModule } = useModules(); // FIX: was calling api.updateModule directly but updateModule wasn't in context
  const [name, setName] = useState(module.name);
  const [desc, setDesc] = useState(module.description || "");
  const [loading, setLoading] = useState(false);

  async function handleUpdate() {
    if (!name.trim()) return;
    setLoading(true);
    try {
      await updateModule(module.id, { name: name.trim(), description: desc.trim() });
      onClose();
    } catch (err) {
      toast.error("Failed to update module: " + err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal title="Update Module" onClose={onClose} size="sm">
      <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
        <Input
          label="Module Name"
          placeholder="e.g. Authentication, Billing"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        <Textarea
          label="Description"
          placeholder="Describe the purpose of this module..."
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          rows={3}
        />
        <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
          <Button variant="secondary" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button onClick={handleUpdate} disabled={loading}>
            {loading ? "Updating..." : "Save Changes"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ImportPostmanModal({ onClose, defaultModuleId }) {
  const { modules, importFlow } = useModules();
  const [importType, setImportType] = useState("postman");
  const [moduleId, setModuleId] = useState(defaultModuleId || (modules[0]?.id || ""));
  const [flowName, setFlowName] = useState("");
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleImport() {
    if (!moduleId || !flowName || !file) {
      toast.error("Please fill in all fields and select a file.");
      return;
    }
    setLoading(true);
    try {
      await importFlow(moduleId, file, flowName, importType);
      onClose();
    } catch (err) {
      toast.error("Import failed: " + err.message);
    } finally {
      setLoading(false);
    }
  }

  const typeLabel =
    importType === "swagger"
      ? "Swagger/OpenAPI file"
      : importType === "har"
      ? "HAR file"
      : "Postman Collection file";
  const acceptTypes =
    importType === "swagger"
      ? ".json,.yaml,.yml"
      : importType === "har"
      ? ".har,.json"
      : ".json";
  const modalTitle =
    importType === "swagger"
      ? "Import Swagger/OpenAPI"
      : importType === "har"
      ? "Import HAR File"
      : "Import Postman Collection";

  return (
    <Modal title={modalTitle} onClose={onClose} size="sm">
      <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
        <div className={styles.toggleGroup}>
          <button
            type="button"
            className={`${styles.toggleButton} ${importType === "postman" ? styles.toggleActive : ""}`}
            onClick={() => setImportType("postman")}
          >
            Postman
          </button>
          <button
            type="button"
            className={`${styles.toggleButton} ${importType === "swagger" ? styles.toggleActive : ""}`}
            onClick={() => setImportType("swagger")}
          >
            Swagger/OpenAPI
          </button>
          <button
            type="button"
            className={`${styles.toggleButton} ${importType === "har" ? styles.toggleActive : ""}`}
            onClick={() => setImportType("har")}
          >
            HAR
          </button>
        </div>

        <div className={styles.formGroup}>
          <label className={styles.label}>Target Module</label>
          <select
            className={styles.select}
            value={moduleId}
            onChange={(e) => setModuleId(e.target.value)}
          >
            <option value="" disabled>Select a module</option>
            {modules.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </div>

        <Input
          label="Flow Name"
          placeholder="e.g. Auth Flow"
          value={flowName}
          onChange={(e) => setFlowName(e.target.value)}
        />

        <div className={styles.formGroup}>
          <label className={styles.label}>{typeLabel}</label>
          <input
            type="file"
            accept={acceptTypes}
            onChange={(e) => setFile(e.target.files[0])}
            className={styles.fileInput}
          />
        </div>

        <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
          <Button variant="secondary" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button onClick={handleImport} disabled={loading}>
            {loading ? "Importing..." : "Import"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default LandingPage;
