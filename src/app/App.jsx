import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Boxes,
  CalendarPlus,
  CheckCircle2,
  ClipboardList,
} from "lucide-react";
import { Sidebar } from "../components/layout/Sidebar.jsx";
import { Topbar } from "../components/layout/Topbar.jsx";
import { isAssignedToAccount } from "../domain/accounts.js";
import { summarizeTasks, isOverdue } from "../domain/metrics.js";
import { getBomStatusMeta } from "../domain/bom.js";
import { isProductFileRecord } from "../domain/productFiles.js";
import {
  getCurrentStandardPhase,
  getStageAdvance,
  getStageGateResult,
  STAGE_TEMPLATES,
} from "../domain/workflow.js";
import { AccountDialog } from "../features/accounts/AccountDialog.jsx";
import { SystemManagementPage } from "../features/accounts/SystemManagementPage.jsx";
import {
  AuthLoading,
  ForcedPasswordPage,
  LoginPage,
  PasswordDialog,
} from "../features/auth/AuthScreens.jsx";
import { ReadinessSummary } from "../features/dashboard/ReadinessSummary.jsx";
import { ProjectOverviewPage } from "../features/dashboard/ProjectOverviewPage.jsx";
import { WorkbenchPage } from "../features/dashboard/WorkbenchPage.jsx";
import { ImportDialog } from "../features/import/ImportDialog.jsx";
import { BomImportDialog } from "../features/materials/BomImportDialog.jsx";
import { MaterialDialog } from "../features/materials/MaterialDialog.jsx";
import { MaterialReadinessPage } from "../features/materials/MaterialReadinessPage.jsx";
import { QuotationDialog } from "../features/materials/QuotationDialog.jsx";
import DeleteProjectDialog from "../features/projects/DeleteProjectDialog.jsx";
import DeleteProductDialog from "../features/projects/DeleteProductDialog.jsx";
import DeleteStageDialog from "../features/projects/DeleteStageDialog.jsx";
import ProductEditDialog from "../features/projects/ProductEditDialog.jsx";
import ProjectStatusDialog from "../features/projects/ProjectStatusDialog.jsx";
import ProjectDialog, { ProductDialog } from "../features/projects/ProjectDialog.jsx";
import RenameDialog from "../features/projects/RenameDialog.jsx";
import StageDialog from "../features/projects/StageDialog.jsx";
import { TemplateDialog } from "../features/templates/TemplateDialog.jsx";
import { FilterBar } from "../features/tracking/FilterBar.jsx";
import TaskDrawer from "../features/tracking/TaskDrawer.jsx";
import { TrackingMatrix } from "../features/tracking/TrackingMatrix.jsx";
import { ProductFileMatrix } from "../features/tracking/ProductFileMatrix.jsx";
import { StageGateDashboard } from "../features/workflow/StageGateDashboard.jsx";
import MeetingDialog from "../features/workflow/MeetingDialog.jsx";
import StageTransitionDialog from "../features/workflow/StageTransitionDialog.jsx";
import WorkflowArchiveDialog from "../features/workflow/WorkflowArchiveDialog.jsx";
import { ProductWorkspaceNav } from "../features/workflow/ProductWorkspaceNav.jsx";
import WorkflowItemDialog from "../features/workflow/WorkflowItemDialog.jsx";
import { exportNpiWorkbook } from "../services/excel.js";
import { npiApi } from "../services/api.js";
import { selectBusinessState, useNpiStore } from "../store/useNpiStore.js";

const CLOSED_STATUSES = new Set(["done", "na"]);
const ABNORMAL_STATUSES = new Set(["risk", "blocked"]);
const SIDEBAR_STORAGE_KEY = "npi-tracker:sidebar:v1";

const CATEGORY_LABELS = {
  documents: "资料与程序",
  tooling: "工装",
  material: "材料",
};

function normalizeLabel(value) {
  return String(value || "")
    .trim()
    .replace(/^PFM$/i, "PFMEA")
    .replace(/[（）]/g, (character) => (character === "（" ? "(" : ")"))
    .replace(/\s+/g, "")
    .toLocaleLowerCase();
}

function taskSearchText(task, definition) {
  return [
    definition?.label,
    definition?.category,
    task?.owner,
    task?.ownerRole,
    task?.notes,
    task?.blocker,
  ].join(" ").toLocaleLowerCase();
}

function readSidebarCollapsed() {
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "collapsed";
  } catch {
    return false;
  }
}

export function App() {
  const hydrateServerState = useNpiStore((state) => state.hydrateServerState);
  const clearServerState = useNpiStore((state) => state.clearServerState);
  const [session, setSession] = useState(null);
  const [status, setStatus] = useState("checking");

  const loadWorkspace = useCallback(async (activeSession) => {
    setSession(activeSession);
    if (activeSession.account.mustChangePassword) {
      setStatus("password-change");
      return;
    }
    setStatus("loading-data");
    const state = await npiApi.getState();
    hydrateServerState(state);
    setStatus("ready");
  }, [hydrateServerState]);

  useEffect(() => {
    let cancelled = false;
    npiApi.me()
      .then(async (activeSession) => {
        if (!cancelled) await loadWorkspace(activeSession);
      })
      .catch(() => {
        if (!cancelled) {
          clearServerState();
          setSession(null);
          setStatus("login");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [clearServerState, loadWorkspace]);

  async function handleLogin(credentials) {
    const activeSession = await npiApi.login(credentials);
    await loadWorkspace(activeSession);
  }

  async function handlePasswordChange(input) {
    const activeSession = await npiApi.changePassword(input);
    await loadWorkspace(activeSession);
  }

  async function handleLogout() {
    try {
      await npiApi.logout();
    } finally {
      npiApi.clearSession();
      clearServerState();
      setSession(null);
      setStatus("login");
    }
  }

  const reloadState = useCallback(async () => {
    const state = await npiApi.getState();
    hydrateServerState(state);
    return state;
  }, [hydrateServerState]);

  function handleSessionExpired() {
    npiApi.clearSession();
    clearServerState();
    setSession(null);
    setStatus("login");
  }

  if (status === "checking") return <AuthLoading />;
  if (status === "loading-data") return <AuthLoading message="正在加载已授权的项目与材料…" />;
  if (status === "login" || !session) return <LoginPage onLogin={handleLogin} />;
  if (status === "password-change") {
    return <ForcedPasswordPage account={session.account} onChangePassword={handlePasswordChange} />;
  }
  return (
    <NpiWorkspace
      session={session}
      onSessionUpdate={setSession}
      onSessionExpired={handleSessionExpired}
      onLogout={handleLogout}
      reloadState={reloadState}
    />
  );
}

function NpiWorkspace({ session, onSessionUpdate, onSessionExpired, onLogout, reloadState }) {
  const {
    accounts,
    currentAccountId,
    projects,
    materials,
    definitions,
    tasks,
    workflowItems,
    meetings,
    bomItems,
    bomImports,
    quotations,
    selectedProjectId,
    selectedProductId,
    selectedPhaseId,
    permissions,
    setRevision,
    replaceProjectRecord,
    replaceTaskRecord,
    replaceWorkflowItemRecord,
    replaceMeetingRecord,
    removeProjectRecord,
    removeProductRecord,
    removeStageRecord,
    selectProject,
    selectProduct,
    selectPhase,
    createProject,
    addProduct,
    ensureProductFileTask,
    addPhase,
    addDefinition,
    addMaterial,
    importWorkbookRows,
    importBomItems,
    addQuotationRecord,
    removeQuotationRecord,
  } = useNpiStore();

  const [activeView, setActiveView] = useState("workbench");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed);
  const [search, setSearch] = useState("");
  const [abnormalOnly, setAbnormalOnly] = useState(false);
  const [myOnly, setMyOnly] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [selectedWorkflowItemId, setSelectedWorkflowItemId] = useState(null);
  const [selectedMeetingId, setSelectedMeetingId] = useState(null);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [productDialogOpen, setProductDialogOpen] = useState(false);
  const [renameDialogType, setRenameDialogType] = useState("");
  const [deleteProjectDialogOpen, setDeleteProjectDialogOpen] = useState(false);
  const [deleteProductDialogOpen, setDeleteProductDialogOpen] = useState(false);
  const [deleteStageDialogOpen, setDeleteStageDialogOpen] = useState(false);
  const [projectStatusDialogOpen, setProjectStatusDialogOpen] = useState(false);
  const [stageDialogOpen, setStageDialogOpen] = useState(false);
  const [stageTransitionDialogOpen, setStageTransitionDialogOpen] = useState(false);
  const [workflowItemDialogOpen, setWorkflowItemDialogOpen] = useState(false);
  const [workflowArchiveItem, setWorkflowArchiveItem] = useState(null);
  const [materialDialogOpen, setMaterialDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [bomImportDialogOpen, setBomImportDialogOpen] = useState(false);
  const [quotationDialogItemId, setQuotationDialogItemId] = useState("");
  const [focusedBomMaterialId, setFocusedBomMaterialId] = useState("");
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [toast, setToast] = useState(null);
  const syncQueueRef = useRef(Promise.resolve());
  const syncEpochRef = useRef(0);
  const isAdmin = session.account.systemRole === "admin" && permissions.canManage;

  const currentProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? projects[0] ?? null,
    [projects, selectedProjectId],
  );
  const currentProduct = useMemo(
    () => currentProject?.products.find((product) => product.id === selectedProductId)
      ?? currentProject?.products[0]
      ?? null,
    [currentProject, selectedProductId],
  );
  const currentPhase = useMemo(
    () => currentProduct?.phases.find((phase) => phase.id === selectedPhaseId)
      ?? currentProduct?.phases[0]
      ?? null,
    [currentProduct, selectedPhaseId],
  );
  const workflowCurrentPhase = useMemo(
    () => getCurrentStandardPhase(currentProduct),
    [currentProduct],
  );
  const currentProductContext = useMemo(() => currentProject && currentProduct ? ({
    ...currentProject,
    name: currentProduct.name,
    productLine: currentProduct.name,
    partNumber: currentProduct.partNumber,
    version: currentProduct.version,
    manager: currentProduct.manager,
    managerAccountId: currentProduct.managerAccountId,
    phases: currentProduct.phases,
    productId: currentProduct.id,
  }) : null, [currentProduct, currentProject]);
  const currentAccount = useMemo(
    () => accounts.find((account) => account.id === session.account.id)
      ?? session.account,
    [accounts, session.account],
  );

  const productMaterials = useMemo(
    () => materials.filter((material) => (
      material.projectId === currentProject?.id && material.productId === currentProduct?.id
    )),
    [currentProduct?.id, currentProject?.id, materials],
  );
  const phaseMaterials = useMemo(
    () => materials.filter((material) => (
      material.projectId === currentProject?.id
      && material.productId === currentProduct?.id
      && material.phaseId === currentPhase?.id
      && !isProductFileRecord(material)
    )),
    [currentPhase?.id, currentProduct?.id, currentProject?.id, materials],
  );
  const phaseTasks = useMemo(
    () => tasks.filter((task) => (
      task.projectId === currentProject?.id
      && task.productId === currentProduct?.id
      && task.phaseId === currentPhase?.id
      && !isProductFileRecord(task)
    )),
    [currentPhase?.id, currentProduct?.id, currentProject?.id, tasks],
  );
  const projectWorkflowItems = useMemo(
    () => workflowItems.filter((item) => (
      item.projectId === currentProject?.id && item.productId === currentProduct?.id
    )),
    [currentProduct?.id, currentProject?.id, workflowItems],
  );
  const productMeetings = useMemo(
    () => meetings.filter((meeting) => (
      meeting.projectId === currentProject?.id && meeting.productId === currentProduct?.id
    )),
    [currentProduct?.id, currentProject?.id, meetings],
  );
  const currentGate = useMemo(
    () => getStageGateResult(currentProduct, workflowCurrentPhase, projectWorkflowItems, productMeetings),
    [currentProduct, productMeetings, projectWorkflowItems, workflowCurrentPhase],
  );
  const workflowNextPhase = useMemo(() => {
    if (!currentProduct || !workflowCurrentPhase) return null;
    const phases = currentProduct.phases
      .filter(({ type }) => Boolean(STAGE_TEMPLATES[type]))
      .toSorted((left, right) => (
        Object.keys(STAGE_TEMPLATES).indexOf(left.type)
        - Object.keys(STAGE_TEMPLATES).indexOf(right.type)
      ));
    const index = phases.findIndex(({ id }) => id === workflowCurrentPhase.id);
    return index >= 0 ? phases[index + 1] ?? null : null;
  }, [currentProduct, workflowCurrentPhase]);
  const stageAdvance = useMemo(
    () => getStageAdvance(currentProduct),
    [currentProduct],
  );
  const productTasks = useMemo(
    () => tasks.filter((task) => (
      task.projectId === currentProject?.id && task.productId === currentProduct?.id
    )),
    [currentProduct?.id, currentProject?.id, tasks],
  );
  const productBomItems = useMemo(
    () => bomItems.filter((item) => (
      item.projectId === currentProject?.id && item.productId === currentProduct?.id
    )),
    [bomItems, currentProduct?.id, currentProject?.id],
  );
  const phaseBomItems = useMemo(
    () => bomItems.filter((item) => (
      item.projectId === currentProject?.id
      && item.productId === currentProduct?.id
      && item.phaseId === currentPhase?.id
    )),
    [bomItems, currentPhase?.id, currentProduct?.id, currentProject?.id],
  );
  const phaseBomImports = useMemo(
    () => bomImports.filter((item) => (
      item.projectId === currentProject?.id
      && item.productId === currentProduct?.id
      && item.phaseId === currentPhase?.id
    )),
    [bomImports, currentPhase?.id, currentProduct?.id, currentProject?.id],
  );
  const phaseQuotations = useMemo(
    () => quotations.filter((item) => (
      item.projectId === currentProject?.id && item.phaseId === currentPhase?.id
    )),
    [currentPhase?.id, currentProject?.id, quotations],
  );
  const summary = useMemo(() => summarizeTasks(phaseTasks), [phaseTasks]);
  const definitionByKey = useMemo(
    () => new Map(definitions.map((definition) => [definition.key, definition])),
    [definitions],
  );

  const visibleMaterials = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase();
    const filtersActive = normalizedSearch || abnormalOnly || myOnly || statusFilter !== "all";
    if (!filtersActive) return phaseMaterials;

    const tasksByMaterial = new Map();
    phaseTasks.forEach((task) => {
      const list = tasksByMaterial.get(task.materialId) ?? [];
      list.push(task);
      tasksByMaterial.set(task.materialId, list);
    });

    return phaseMaterials.filter((material) => {
      const materialMatches = `${material.code} ${material.name}`
        .toLocaleLowerCase()
        .includes(normalizedSearch);
      const materialTasks = tasksByMaterial.get(material.id) ?? [];

      if (!materialTasks.length) {
        return Boolean(materialMatches && !abnormalOnly && !myOnly && statusFilter === "all");
      }

      return materialTasks.some((task) => {
        if (statusFilter !== "all" && task.status !== statusFilter) return false;
        if (myOnly && !isAssignedToAccount(task, currentAccount, accounts)) return false;
        if (abnormalOnly && !ABNORMAL_STATUSES.has(task.status) && !isOverdue(task)) return false;
        if (!normalizedSearch || materialMatches) return true;
        return taskSearchText(task, definitionByKey.get(task.definitionKey)).includes(normalizedSearch);
      });
    });
  }, [
    abnormalOnly,
    accounts,
    currentAccount,
    definitionByKey,
    myOnly,
    phaseMaterials,
    phaseTasks,
    search,
    statusFilter,
  ]);

  const visibleTaskIds = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase();
    const filtersActive = normalizedSearch || abnormalOnly || myOnly || statusFilter !== "all";
    if (!filtersActive) return null;

    const visibleMaterialIds = new Set(visibleMaterials.map(({ id }) => id));
    const materialById = new Map(phaseMaterials.map((material) => [material.id, material]));
    const ids = new Set();
    phaseTasks.forEach((task) => {
      if (!visibleMaterialIds.has(task.materialId)) return;
      if (statusFilter !== "all" && task.status !== statusFilter) return;
      if (myOnly && !isAssignedToAccount(task, currentAccount, accounts)) return;
      if (abnormalOnly && !ABNORMAL_STATUSES.has(task.status) && !isOverdue(task)) return;

      const material = materialById.get(task.materialId);
      const materialMatches = `${material?.code ?? ""} ${material?.name ?? ""}`
        .toLocaleLowerCase()
        .includes(normalizedSearch);
      if (
        normalizedSearch
        && !materialMatches
        && !taskSearchText(task, definitionByKey.get(task.definitionKey)).includes(normalizedSearch)
      ) return;
      ids.add(task.id);
    });
    return ids;
  }, [
    abnormalOnly,
    accounts,
    currentAccount,
    definitionByKey,
    myOnly,
    phaseMaterials,
    phaseTasks,
    search,
    statusFilter,
    visibleMaterials,
  ]);

  const selectedTask = useMemo(
    () => productTasks.find((task) => task.id === selectedTaskId) ?? null,
    [productTasks, selectedTaskId],
  );
  const selectedWorkflowItem = useMemo(
    () => projectWorkflowItems.find((item) => item.id === selectedWorkflowItemId) ?? null,
    [projectWorkflowItems, selectedWorkflowItemId],
  );
  const selectedMeeting = useMemo(
    () => productMeetings.find((meeting) => meeting.id === selectedMeetingId) ?? null,
    [productMeetings, selectedMeetingId],
  );
  const selectedDefinition = selectedTask
    ? definitionByKey.get(selectedTask.definitionKey) ?? null
    : null;
  const selectedMaterial = selectedTask
    ? productMaterials.find((material) => material.id === selectedTask.materialId) ?? null
    : null;

  const myOpenCount = useMemo(() => (
    tasks.filter((task) => (
      isAssignedToAccount(task, currentAccount, accounts)
      && !CLOSED_STATUSES.has(task.status)
    )).length
    + workflowItems.filter((item) => (
      isAssignedToAccount(item, currentAccount, accounts)
      && !CLOSED_STATUSES.has(item.status)
    )).length
  ), [accounts, currentAccount, tasks, workflowItems]);

  useEffect(() => {
    setSelectedTaskId(null);
    setSelectedWorkflowItemId(null);
    setSelectedMeetingId(null);
    setWorkflowArchiveItem(null);
    setFocusedBomMaterialId("");
    setQuotationDialogItemId("");
  }, [selectedPhaseId, selectedProductId, selectedProjectId]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function notify(message, tone = "success") {
    setToast({ message, tone, key: Date.now() });
  }

  function toggleSidebar() {
    setSidebarCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? "collapsed" : "expanded");
      } catch {
        // The UI still works when browser storage is unavailable.
      }
      return next;
    });
  }

  function handleApiError(error, fallback = "操作失败") {
    if (error?.status === 401) {
      onSessionExpired();
      return;
    }
    const suffix = error?.requestId ? `（请求 ${error.requestId}）` : "";
    notify(`${error instanceof Error ? error.message : fallback}${suffix}`, "danger");
  }

  function queueAdminSync(successMessage) {
    const snapshot = selectBusinessState(useNpiStore.getState());
    const epoch = syncEpochRef.current;
    syncQueueRef.current = syncQueueRef.current
      .then(async () => {
        if (epoch !== syncEpochRef.current) return;
        const expectedRevision = useNpiStore.getState().revision;
        try {
          const result = await npiApi.replaceBusinessState(snapshot, expectedRevision);
          setRevision(result.revision);
          if (successMessage) notify(successMessage);
        } catch (error) {
          syncEpochRef.current += 1;
          handleApiError(error, "共享数据保存失败");
          try {
            await reloadState();
          } catch (reloadError) {
            handleApiError(reloadError, "重新加载共享数据失败");
          }
        }
      });
    return syncQueueRef.current;
  }

  function resetFilters() {
    setSearch("");
    setAbnormalOnly(false);
    setMyOnly(false);
    setStatusFilter("all");
    notify("筛选条件已清除，数据已刷新");
  }

  function handleViewChange(view) {
    if (view === "templates") {
      setActiveView("settings");
      setTemplateDialogOpen(true);
      return;
    }
    const normalizedView = view === "overview" ? "projects" : view === "mine" ? "tasks" : view;
    if (normalizedView === "files" && currentPhase?.type !== "MP") {
      setActiveView("workflow");
      setSelectedTaskId(null);
      return;
    }
    setActiveView(normalizedView);
    if (normalizedView !== "tasks" && myOnly) setMyOnly(false);
  }

  function handleOpenProduct(projectId, productId, view = "workflow") {
    selectProject(projectId);
    selectProduct(productId);
    setSearch("");
    setActiveView(view);
  }

  function handleSelectWorkspacePhase(phaseId) {
    const nextPhase = currentProduct?.phases.find(({ id }) => id === phaseId);
    selectPhase(phaseId);
    if (activeView === "files" && nextPhase?.type !== "MP") {
      setActiveView("workflow");
      setSelectedTaskId(null);
    }
  }

  function handleOpenWorkbenchItem(item) {
    const record = item?.raw;
    if (!record) return;
    selectProject(record.projectId);
    selectProduct(record.productId);
    selectPhase(record.phaseId);
    setSearch("");
    if (item.source === "bom") {
      setFocusedBomMaterialId(record.parentMaterialId || "");
      setActiveView("materials");
      return;
    }
    if (item.source === "workflow") {
      setSelectedWorkflowItemId(record.id);
      setActiveView("workflow");
      return;
    }
    setSelectedTaskId(record.id);
    setActiveView(record.definitionKey === "material-readiness" ? "materials" : "tasks");
  }

  function handleSelectTask(taskId) {
    const task = phaseTasks.find((item) => item.id === taskId);
    if (task?.definitionKey === "material-readiness") {
      setFocusedBomMaterialId(task.materialId);
      setSelectedTaskId(null);
      setActiveView("materials");
      return;
    }
    setSelectedTaskId(taskId);
  }

  function handleOpenProductFileDefinition(definition) {
    if (!currentProject || !currentProduct || !definition) return;
    if (currentPhase?.type !== "MP") {
      notify("交付物统一在 MP 阶段确认", "danger");
      return;
    }
    if (!isAdmin) {
      notify(`${definition.label} 尚未建立跟踪事项，请联系管理员初始化`, "danger");
      return;
    }
    const task = ensureProductFileTask({
      projectId: currentProject.id,
      productId: currentProduct.id,
      definitionKey: definition.key,
    });
    if (!task) {
      notify(`${definition.label} 跟踪事项建立失败`, "danger");
      return;
    }
    setSelectedTaskId(task.id);
    void queueAdminSync(`已建立 ${currentProduct.name} · ${definition.label} 文件跟踪事项`);
  }

  function handleCreateProject(input) {
    const duplicate = projects.some(
      (project) => project.code.toLocaleLowerCase() === input.code.toLocaleLowerCase(),
    );
    if (duplicate) {
      notify(`项目 ${input.code} 已存在`, "danger");
      return false;
    }
    const project = createProject(input);
    void queueAdminSync(`已创建项目 ${project.code}，包含 ${project.products.length} 个产品`);
    return true;
  }

  function handleCreateProduct(input) {
    if (!currentProject) return false;
    const duplicate = currentProject.products.some((product) => (
      product.name.toLocaleLowerCase() === input.name.toLocaleLowerCase()
    ));
    if (duplicate) {
      notify(`产品 ${input.name} 已存在于当前项目`, "danger");
      return false;
    }
    const duplicatePartNumber = currentProject.products.some((product) => (
      product.partNumber
      && product.partNumber.toLocaleLowerCase() === input.partNumber.toLocaleLowerCase()
    ));
    if (duplicatePartNumber) {
      notify(`产品料号 ${input.partNumber} 已存在于当前项目`, "danger");
      return false;
    }
    const product = addProduct(currentProject.id, input);
    if (!product) return false;
    void queueAdminSync(`已在项目 ${currentProject.code} 下新增产品 ${product.name}`);
    return true;
  }

  async function handleRenameProject(nextName) {
    if (!currentProject) return false;
    const name = nextName.trim();
    if (!name) return false;
    try {
      await syncQueueRef.current;
      const expectedRevision = useNpiStore.getState().revision;
      const result = await npiApi.updateProjectDetails(currentProject.id, { name }, expectedRevision);
      replaceProjectRecord(result.project, result.revision);
      notify(`项目名称已更新为 ${result.project.name}`);
      return true;
    } catch (error) {
      handleApiError(error, "项目名称更新失败");
      if (error?.status === 404 || error?.status === 409) await reloadState().catch(() => {});
      return false;
    }
  }

  async function handleUpdateProduct(input) {
    if (!currentProject || !currentProduct) return false;
    const name = input.name.trim();
    const duplicate = currentProject.products.some((product) => (
      product.id !== currentProduct.id
      && product.name.toLocaleLowerCase() === name.toLocaleLowerCase()
    ));
    if (duplicate) {
      notify(`新品 ${name} 已存在于当前项目`, "danger");
      return false;
    }
    const partNumber = input.partNumber.trim();
    const duplicatePartNumber = currentProject.products.some((product) => (
      product.id !== currentProduct.id
      && product.partNumber.toLocaleLowerCase() === partNumber.toLocaleLowerCase()
    ));
    if (duplicatePartNumber) {
      notify(`产品料号 ${partNumber} 已存在于当前项目`, "danger");
      return false;
    }
    try {
      await syncQueueRef.current;
      const expectedRevision = useNpiStore.getState().revision;
      const result = await npiApi.updateProductDetails(
        currentProject.id,
        currentProduct.id,
        input,
        expectedRevision,
      );
      replaceProjectRecord(result.project, result.revision);
      notify(`产品 ${result.product.name} 信息已更新`);
      return true;
    } catch (error) {
      handleApiError(error, "产品信息更新失败");
      if (error?.status === 404 || error?.status === 409) await reloadState().catch(() => {});
      return false;
    }
  }

  async function handleProjectStatusChange({ status, note }) {
    if (!currentProject || !isAdmin) throw new Error("当前账号无权更新项目状态");
    try {
      await syncQueueRef.current;
      const expectedRevision = useNpiStore.getState().revision;
      const result = await npiApi.updateProjectStatus(currentProject.id, status, note, expectedRevision);
      replaceProjectRecord(result.project, result.revision);
      setProjectStatusDialogOpen(false);
      notify(status === "completed" ? `项目 ${currentProject.code} 已提前完结` : `项目 ${currentProject.code} 已恢复为进行中`);
      return true;
    } catch (error) {
      if (error?.status === 404 || error?.status === 409) {
        try {
          await reloadState();
          setProjectStatusDialogOpen(false);
          notify(error.message || "共享数据已更新，请重新操作", "danger");
          return false;
        } catch (reloadError) {
          handleApiError(reloadError, "项目状态刷新失败");
        }
      }
      handleApiError(error, "项目状态更新失败");
      return false;
    }
  }

  async function handleDeleteProject(projectId) {
    const project = projects.find((item) => item.id === projectId);
    if (!project || !isAdmin) throw new Error("当前账号无权删除该项目");

    try {
      await syncQueueRef.current;
      const expectedRevision = useNpiStore.getState().revision;
      const result = await npiApi.deleteProject(projectId, expectedRevision);
      removeProjectRecord(projectId, result.revision);
      const removedRecords = Object.values(result.deleted ?? {})
        .reduce((total, count) => total + (Number(count) || 0), 0);
      notify(`已删除项目 ${result.project?.code ?? project.code}，清理 ${removedRecords} 条关联记录`);
      return result;
    } catch (error) {
      if (error?.status === 401) handleApiError(error, "项目删除失败");
      if (error?.status === 404 || error?.status === 409) {
        try {
          await reloadState();
          setDeleteProjectDialogOpen(false);
          notify(
            error.status === 404
              ? "该项目已被其他用户删除，项目列表已刷新"
              : "共享数据已更新，请重新选择项目并再次确认删除",
            "danger",
          );
          return null;
        } catch (reloadError) {
          if (reloadError?.status === 401) handleApiError(reloadError, "项目列表刷新失败");
          throw new Error("共享数据已发生变化，但自动刷新失败，请刷新页面后重试");
        }
      }
      throw error;
    }
  }

  async function handleDeleteProduct(projectId, productId) {
    const project = projects.find((item) => item.id === projectId);
    const product = project?.products.find((item) => item.id === productId);
    if (!project || !product || !isAdmin) throw new Error("当前账号无权删除该产品");
    if (project.products.length <= 1) throw new Error("项目至少需要保留一个产品");

    try {
      await syncQueueRef.current;
      const expectedRevision = useNpiStore.getState().revision;
      const result = await npiApi.deleteProduct(projectId, productId, expectedRevision);
      removeProductRecord(projectId, productId, result.revision);
      const removedRecords = Object.values(result.deleted ?? {})
        .reduce((total, count) => total + (Number(count) || 0), 0);
      notify(`已删除产品 ${result.product?.name ?? product.name}，清理 ${removedRecords} 条关联记录`);
      return result;
    } catch (error) {
      if (error?.status === 401) handleApiError(error, "产品删除失败");
      if (error?.status === 404 || error?.status === 409) {
        try {
          await reloadState();
          setDeleteProductDialogOpen(false);
          notify(error.message || "共享数据已更新，请重新选择产品后再试", "danger");
          return null;
        } catch (reloadError) {
          if (reloadError?.status === 401) handleApiError(reloadError, "产品列表刷新失败");
          throw new Error("共享数据已发生变化，但自动刷新失败，请刷新页面后重试");
        }
      }
      throw error;
    }
  }

  async function handleDeleteStage(projectId, productId, phaseId) {
    const project = projects.find((item) => item.id === projectId);
    const product = project?.products.find((item) => item.id === productId);
    const phase = product?.phases.find((item) => item.id === phaseId);
    if (!project || !product || !phase || !isAdmin) throw new Error("当前账号无权删除该阶段");
    if (product.phases.length <= 1) throw new Error("产品至少需要保留一个阶段");

    try {
      await syncQueueRef.current;
      const expectedRevision = useNpiStore.getState().revision;
      const result = await npiApi.deleteStage(projectId, productId, phaseId, expectedRevision);
      removeStageRecord(projectId, productId, phaseId, result.revision);
      setSelectedTaskId(null);
      setSelectedWorkflowItemId(null);
      setDeleteStageDialogOpen(false);
      const removedRecords = Object.values(result.deleted ?? {})
        .reduce((total, count) => total + (Number(count) || 0), 0);
      notify(`已删除 ${result.phase?.label ?? phase.label}，清理 ${removedRecords} 条关联记录`);
      return result;
    } catch (error) {
      if (error?.status === 401) handleApiError(error, "阶段删除失败");
      if (error?.status === 404 || error?.status === 409) {
        try {
          await reloadState();
          setDeleteStageDialogOpen(false);
          notify(error.message || "共享数据已更新，请重新选择阶段后再试", "danger");
          return null;
        } catch (reloadError) {
          if (reloadError?.status === 401) handleApiError(reloadError, "阶段列表刷新失败");
          throw new Error("共享数据已发生变化，但自动刷新失败，请刷新页面后重试");
        }
      }
      throw error;
    }
  }

  function handleCreateStage(input) {
    if (!currentProject || !currentProduct) return false;
    if (!stageAdvance.availableTypes.includes(input.type)) {
      notify("该阶段已配置或不是标准阶段", "danger");
      return false;
    }
    const duplicate = currentProduct.phases.some((phase) => phase.type === input.type);
    if (duplicate) {
      notify(`阶段 ${input.label} 已存在`, "danger");
      return false;
    }
    const phase = addPhase(currentProject.id, currentProduct.id, input);
    if (!phase) {
      notify("阶段状态已变化，请刷新后重试", "danger");
      return false;
    }
    void queueAdminSync(`已新增阶段 ${input.label}`);
    return true;
  }

  function handleCreateMaterial(input) {
    if (!currentProject || !currentProduct || !currentPhase) return false;
    const duplicate = phaseMaterials.some(
      (material) => material.code.toLocaleLowerCase() === input.code.toLocaleLowerCase(),
    );
    if (duplicate) {
      notify(`物料 ${input.code} 已存在于当前阶段`, "danger");
      return false;
    }
    addMaterial({
      ...input,
      projectId: currentProject.id,
      productId: currentProduct.id,
      phaseId: currentPhase.id,
    });
    void queueAdminSync(`已新增物料 ${input.code}，并套用 ${definitions.length} 个交付项`);
    return true;
  }

  async function handleCreateWorkflowItem(input) {
    if (!currentProject || !currentProduct || !currentPhase || !isAdmin) return false;
    try {
      await syncQueueRef.current;
      const expectedRevision = useNpiStore.getState().revision;
      const result = await npiApi.createWorkflowItem({
        ...input,
        projectId: currentProject.id,
        productId: currentProduct.id,
        phaseId: currentPhase.id,
      }, expectedRevision);
      replaceWorkflowItemRecord(result.item, result.revision);
      setWorkflowItemDialogOpen(false);
      setSelectedWorkflowItemId(result.item.id);
      notify(`已新增 ${currentPhase.type} · ${result.item.title}`);
      return true;
    } catch (error) {
      handleApiError(error, "阶段事项创建失败");
      if (error?.status === 404 || error?.status === 409) {
        try {
          await reloadState();
          setWorkflowItemDialogOpen(false);
        } catch (reloadError) {
          handleApiError(reloadError, "阶段事项刷新失败");
        }
      }
      return false;
    }
  }

  async function handleSaveTask({ patch, attachmentChanges }) {
    if (!selectedTask) return false;
    const requestPatch = { ...patch };
    delete requestPatch.owner;
    if (!isAdmin) {
      delete requestPatch.ownerAccountId;
      delete requestPatch.ownerRole;
      delete requestPatch.baselineDate;
    }
    try {
      await syncQueueRef.current;
      if (Object.keys(requestPatch).length) {
        const result = await npiApi.updateTask(selectedTask.id, requestPatch);
        replaceTaskRecord(result.task, result.revision);
      }
      if (attachmentChanges) {
        const result = await npiApi.syncAttachments("task", selectedTask.id, attachmentChanges);
        replaceTaskRecord(result.entity, result.revision);
      }
      notify(`${selectedMaterial?.code ?? "任务"} · ${selectedDefinition?.label ?? "交付项"} 已保存`);
      return true;
    } catch (error) {
      handleApiError(error, "任务提交失败");
      try {
        await reloadState();
      } catch (reloadError) {
        handleApiError(reloadError, "重新加载共享数据失败");
      }
      return false;
    }
  }

  async function handleSaveWorkflowItem({ patch, attachmentChanges }) {
    if (!selectedWorkflowItem) return false;
    const requestPatch = { ...patch };
    delete requestPatch.owner;
    if (!isAdmin) {
      delete requestPatch.ownerAccountId;
      delete requestPatch.ownerRole;
      delete requestPatch.baselineDate;
      delete requestPatch.title;
      delete requestPatch.criterion;
    }
    try {
      await syncQueueRef.current;
      if (Object.keys(requestPatch).length) {
        const result = await npiApi.updateWorkflowItem(selectedWorkflowItem.id, requestPatch);
        replaceWorkflowItemRecord(result.item, result.revision);
      }
      if (attachmentChanges) {
        const result = await npiApi.syncAttachments(
          "workflow_item",
          selectedWorkflowItem.id,
          attachmentChanges,
        );
        replaceWorkflowItemRecord(result.entity, result.revision);
      }
      notify(`${selectedWorkflowItem.stageType} · ${selectedWorkflowItem.title} 已保存`);
      return true;
    } catch (error) {
      handleApiError(error, "阶段事项提交失败");
      try {
        await reloadState();
      } catch (reloadError) {
        handleApiError(reloadError, "重新加载共享数据失败");
      }
      return false;
    }
  }

  async function persistWorkflowItemArchive(item, archived, reason = "") {
    if (!item || !isAdmin) return false;
    if (archived && !reason.trim()) return false;
    try {
      await syncQueueRef.current;
      const expectedRevision = useNpiStore.getState().revision;
      const result = await npiApi.setWorkflowItemArchived(
        item.id,
        archived,
        reason.trim(),
        expectedRevision,
      );
      replaceWorkflowItemRecord(result.item, result.revision);
      if (archived && selectedWorkflowItemId === item.id) setSelectedWorkflowItemId(null);
      if (archived) setWorkflowArchiveItem(null);
      notify(`${item.title} 已${archived ? "停用" : "恢复"}`);
      return true;
    } catch (error) {
      handleApiError(error, archived ? "阶段事项停用失败" : "阶段事项恢复失败");
      if (error?.status === 404 || error?.status === 409) await reloadState().catch(() => {});
      return false;
    }
  }

  function handleArchiveWorkflowItem(item) {
    if (item.archivedAt) return persistWorkflowItemArchive(item, false);
    setWorkflowArchiveItem(item);
    return true;
  }

  async function handleSaveMeeting({ patch, attachmentChanges }) {
    if (!selectedMeeting) return false;
    try {
      await syncQueueRef.current;
      const result = await npiApi.updateMeeting(selectedMeeting.id, patch);
      replaceMeetingRecord(result.meeting, result.revision);
      if (result.project) replaceProjectRecord(result.project, result.revision);
      if (attachmentChanges) {
        const attachmentResult = await npiApi.syncAttachments(
          "meeting",
          selectedMeeting.id,
          attachmentChanges,
        );
        replaceMeetingRecord(attachmentResult.entity, attachmentResult.revision);
      }
      notify(`${selectedMeeting.stageType} · ${selectedMeeting.subject} 已保存`);
      return true;
    } catch (error) {
      handleApiError(error, "会议保存失败");
      if (error?.status === 404 || error?.status === 409) await reloadState().catch(() => {});
      return false;
    }
  }

  async function handleTransitionStage(input) {
    if (!currentProject || !currentProduct || !workflowCurrentPhase || !isAdmin) return false;
    if (!currentGate.readyForTransition) {
      notify("阶段门条件尚未全部完成", "danger");
      return false;
    }
    try {
      await syncQueueRef.current;
      const expectedRevision = useNpiStore.getState().revision;
      const result = await npiApi.transitionStage(
        currentProject.id,
        currentProduct.id,
        workflowCurrentPhase.id,
        input,
        expectedRevision,
      );
      await reloadState();
      if (result.nextPhase?.id) selectPhase(result.nextPhase.id);
      setStageTransitionDialogOpen(false);
      notify(input.action === "advance"
        ? `${workflowCurrentPhase.type} 已完成，已进入 ${result.nextPhase?.type}`
        : `${currentProduct.name} 已在 ${workflowCurrentPhase.type} 阶段完成流程`);
      return true;
    } catch (error) {
      handleApiError(error, "阶段流转失败");
      if (error?.status === 404 || error?.status === 409) await reloadState().catch(() => {});
      return false;
    }
  }

  function handleImport({ definitions: importedDefinitions, materials: importedMaterials, projectCode }) {
    if (!currentProject || !currentProduct || !currentPhase) return;
    if (projectCode && projectCode !== currentProject.code) {
      notify(`当前项目为 ${currentProject.code}，不能导入 ${projectCode} 的资料`, "danger");
      return;
    }

    const normalizedDefinitions = importedDefinitions.map((definition) => ({
      ...definition,
      label: normalizeLabel(definition.label) === "pfmea" ? "PFMEA" : definition.label,
      category: CATEGORY_LABELS[definition.category] ?? definition.category,
    }));
    const { createdCount, updatedCount } = importWorkbookRows({
      projectId: currentProject.id,
      productId: currentProduct.id,
      phaseId: currentPhase.id,
      definitions: normalizedDefinitions,
      materials: importedMaterials,
    });

    setImportDialogOpen(false);
    void queueAdminSync(`导入完成：新增 ${createdCount} 条，更新 ${updatedCount} 条物料`);
  }

  function handleBomImport({ parentMaterialId, meta, items }) {
    if (!currentProject || !currentProduct || !currentPhase) return false;
    if (meta.projectCode && meta.projectCode !== currentProject.code) {
      notify(`当前项目为 ${currentProject.code}，不能导入 ${meta.projectCode} 的 BOM`, "danger");
      return false;
    }
    const result = importBomItems({
      projectId: currentProject.id,
      productId: currentProduct.id,
      phaseId: currentPhase.id,
      parentMaterialId,
      meta,
      items,
    });
    if (!result) {
      notify("BOM 没有可导入的有效材料", "danger");
      return false;
    }
    setFocusedBomMaterialId(result.parentMaterialId);
    setActiveView("materials");
    void queueAdminSync(`BOM 导入完成：新增 ${result.createdCount} 种，更新 ${result.updatedCount} 种，保留 ${result.unchangedCount} 种确认状态`);
    return true;
  }

  async function handleCreateAccount(input) {
    const result = await npiApi.createAccount(input);
    await reloadState();
    notify(`已创建账号 ${result.account.name}`);
    return result;
  }

  async function handleUpdateAccount(accountId, patch) {
    const result = await npiApi.updateAccount(accountId, patch);
    await reloadState();
    notify(`${result.account.name} 账号已更新`);
    return result.account;
  }

  async function handleDeleteAccount(accountId) {
    const result = await npiApi.deleteAccount(accountId);
    await reloadState();
    notify(`已删除账号 ${result.account.name}`);
    return result.account;
  }

  async function handleResetPassword(accountId) {
    const result = await npiApi.resetPassword(accountId);
    await reloadState();
    notify(`${result.account.name} 的登录密码已重置`);
    return result;
  }

  async function handleAssignBomItems(itemIds, accountId) {
    try {
      const result = await npiApi.bulkAssignBom(itemIds, accountId);
      await reloadState();
      const account = accounts.find((item) => item.id === accountId);
      notify(`已将 ${result.count} 种材料${account ? `分配给 ${account.name}` : "设为未分配"}`);
      return result.count;
    } catch (error) {
      handleApiError(error, "材料分配失败");
      return 0;
    }
  }

  async function handleBulkReadyBom(itemIds = null) {
    if (!currentProject || !currentProduct || !currentPhase || !isAdmin) return false;
    try {
      await syncQueueRef.current;
      const expectedRevision = useNpiStore.getState().revision;
      const result = await npiApi.bulkReadyBom({
        projectId: currentProject.id,
        productId: currentProduct.id,
        phaseId: currentPhase.id,
        ...(itemIds ? { itemIds } : {}),
      }, expectedRevision);
      await reloadState();
      notify(`已将 ${result.count} 种材料标记为准备完成${result.shortageCount ? `，包含 ${result.shortageCount} 种原缺料项` : ""}`);
      return true;
    } catch (error) {
      handleApiError(error, "材料批量确认失败");
      if (error?.status === 404 || error?.status === 409) await reloadState().catch(() => {});
      return false;
    }
  }

  async function handleUpdateBomItem(itemId, patch) {
    const item = phaseBomItems.find((entry) => entry.id === itemId);
    if (!item) return;
    const requestPatch = { ...patch };
    delete requestPatch.owner;
    try {
      await npiApi.updateBomItem(itemId, requestPatch);
      await reloadState();
      if (Object.hasOwn(requestPatch, "ownerAccountId")) {
        const owner = accounts.find(({ id }) => id === requestPatch.ownerAccountId);
        notify(`${item.code} 责任人已更新为 ${owner?.name ?? "未分配"}`);
        return;
      }
      const status = getBomStatusMeta(requestPatch.status ?? item.status);
      notify(`${item.code} 已更新为“${status.label}”`);
    } catch (error) {
      handleApiError(error, "材料进度提交失败");
    }
  }

  async function handleUploadQuotation(input) {
    try {
      const result = await npiApi.importQuotationTable(input);
      addQuotationRecord(result.quotation);
      notify(`${result.quotation.fileName} 已匹配 ${result.quotation.matchedItemCount} 种 BOM 材料`);
      return result.quotation;
    } catch (error) {
      handleApiError(error, "报价单整表导入失败");
      return false;
    }
  }

  async function handleDeleteQuotation(quotationId) {
    try {
      const result = await npiApi.deleteQuotation(quotationId);
      removeQuotationRecord(quotationId);
      notify(`报价单 ${result.quotation.fileName} 已删除`);
      return result.quotation;
    } catch (error) {
      handleApiError(error, "报价单删除失败");
      throw error;
    }
  }

  async function handlePasswordChangeFromDialog(input) {
    const activeSession = await npiApi.changePassword(input);
    onSessionUpdate(activeSession);
    await reloadState();
    setPasswordDialogOpen(false);
    notify("密码已修改，其他设备的登录会话已退出");
  }

  async function handleLogoutRequest() {
    if (!window.confirm("退出后需要重新输入账号和密码。确定退出吗？")) return;
    await onLogout();
  }

  async function handleExport() {
    if (!currentProject || !currentProductContext || !currentPhase || exporting) return;
    setExporting(true);
    try {
      await exportNpiWorkbook({
        project: currentProductContext,
        phase: currentPhase,
        definitions,
        materials: phaseMaterials,
        tasks: phaseTasks,
      });
      notify(`已导出 ${currentProject.code} · ${currentProduct.name} · ${currentPhase.label} 进度表`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "导出失败", "danger");
    } finally {
      setExporting(false);
    }
  }

  if (!currentProject || !currentProduct || !currentPhase) {
    return (
      <div className={`app-shell ${sidebarCollapsed ? "is-sidebar-collapsed" : ""}`}>
        <Sidebar
          activeView={activeView}
          onViewChange={handleViewChange}
          currentAccount={currentAccount}
          onOpenAccounts={() => setAccountDialogOpen(true)}
          isAdmin={isAdmin}
          collapsed={sidebarCollapsed}
          onToggleCollapsed={toggleSidebar}
        />
        <div className="workspace">
          <Topbar
            scope="global"
            projects={projects}
            currentProjectId={currentProject?.id ?? ""}
            onSelectProject={selectProject}
            phases={currentProduct?.phases ?? []}
            currentPhaseId={currentPhase?.id ?? ""}
            onSelectPhase={selectPhase}
            search={search}
            onSearchChange={setSearch}
            onNewProject={isAdmin ? () => setProjectDialogOpen(true) : undefined}
            onDeleteProject={isAdmin && currentProject ? () => setDeleteProjectDialogOpen(true) : undefined}
            currentAccount={currentAccount}
            onOpenAccounts={() => setAccountDialogOpen(true)}
          />
          <main className="main-content">
            <div className="empty-state">
              <ClipboardList size={32} />
              <h2>{isAdmin ? "还没有可跟进的项目" : "暂时没有分配给你的工作"}</h2>
              <p>{isAdmin ? "先新建一个项目，并为每个产品勾选实际适用的阶段；系统会生成对应的标准任务与交付清单。" : "管理员将你设为产品负责人，或分配阶段事项、任务、BOM 材料后，这里会显示你有权访问的项目。"}</p>
              {isAdmin ? <button className="button button-primary" type="button" onClick={() => setProjectDialogOpen(true)}>新建项目</button> : null}
            </div>
          </main>
        </div>
        {isAdmin && projectDialogOpen ? (
          <ProjectDialog
            open
            accounts={accounts}
            currentAccountId={currentAccountId}
            onClose={() => setProjectDialogOpen(false)}
            onCreate={handleCreateProject}
          />
        ) : null}
        {isAdmin && deleteProjectDialogOpen && currentProject ? (
          <DeleteProjectDialog
            open
            project={currentProject}
            onClose={() => setDeleteProjectDialogOpen(false)}
            onDelete={handleDeleteProject}
          />
        ) : null}
        {isAdmin && productDialogOpen && currentProject ? (
          <ProductDialog
            open
            project={currentProject}
            accounts={accounts}
            currentAccountId={currentAccountId}
            onClose={() => setProductDialogOpen(false)}
            onCreate={handleCreateProduct}
          />
        ) : null}
        {toast ? (
          <div key={toast.key} className={`toast toast--${toast.tone}`} role="status" aria-live="polite">
            {toast.tone === "success" ? <CheckCircle2 size={17} /> : null}
            {toast.message}
          </div>
        ) : null}
        {accountDialogOpen ? (
          <AccountDialog
            open
            accounts={accounts}
            currentAccountId={currentAccountId}
            onClose={() => setAccountDialogOpen(false)}
            onCreate={handleCreateAccount}
            onUpdate={handleUpdateAccount}
            onDelete={handleDeleteAccount}
            onResetPassword={handleResetPassword}
            onLogout={handleLogoutRequest}
            onChangePassword={() => {
              setAccountDialogOpen(false);
              setPasswordDialogOpen(true);
            }}
          />
        ) : null}
        <PasswordDialog open={passwordDialogOpen} account={currentAccount} onClose={() => setPasswordDialogOpen(false)} onChangePassword={handlePasswordChangeFromDialog} />
      </div>
    );
  }

  const isWorkspaceView = ["workflow", "tasks", "files", "materials"].includes(activeView);

  return (
    <div className={`app-shell ${sidebarCollapsed ? "is-sidebar-collapsed" : ""}`}>
      <Sidebar
        activeView={isWorkspaceView ? "projects" : activeView}
        onViewChange={handleViewChange}
        myCount={myOpenCount}
        currentAccount={currentAccount}
        onOpenAccounts={() => setAccountDialogOpen(true)}
        isAdmin={isAdmin}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={toggleSidebar}
      />

      <div className="workspace">
        <Topbar
          scope={isWorkspaceView ? "workspace" : "global"}
          projects={projects}
          currentProjectId={currentProject.id}
          onSelectProject={(projectId) => {
            selectProject(projectId);
            setSearch("");
            if (activeView === "files") setActiveView("workflow");
          }}
          products={currentProject.products}
          currentProductId={currentProduct.id}
          onSelectProduct={(productId) => {
            selectProduct(productId);
            setSearch("");
            if (activeView === "files") setActiveView("workflow");
          }}
          phases={currentProduct.phases.filter(({ type }) => Boolean(STAGE_TEMPLATES[type]))}
          currentPhaseId={currentPhase.id}
          onSelectPhase={handleSelectWorkspacePhase}
          search={search}
          onSearchChange={setSearch}
          onNewProject={isAdmin && activeView === "projects" ? () => setProjectDialogOpen(true) : undefined}
          onRenameProject={isAdmin && isWorkspaceView ? () => setRenameDialogType("project") : undefined}
          projectStatus={currentProject.status}
          onChangeProjectStatus={isAdmin && isWorkspaceView ? () => setProjectStatusDialogOpen(true) : undefined}
          onDeleteProject={isAdmin && isWorkspaceView ? () => setDeleteProjectDialogOpen(true) : undefined}
          onNotifications={() => notify("请在阶段总览查看当前阻塞与风险事项", "danger")}
          onHelp={() => notify("提示：点击阶段任务、交付文件或矩阵单元格可更新责任、日期、附件和状态")}
          currentAccount={currentAccount}
          onOpenAccounts={() => setAccountDialogOpen(true)}
        />

        <main className={`main-content ${isWorkspaceView ? "main-content--workspace" : ""}`}>
          {activeView === "workbench" ? (
            <WorkbenchPage
              projects={projects}
              materials={materials}
              definitions={definitions}
              tasks={tasks}
              workflowItems={workflowItems}
              bomItems={bomItems}
              accounts={accounts}
              currentAccount={currentAccount}
              search={search}
              onOpenItem={handleOpenWorkbenchItem}
              onOpenProduct={handleOpenProduct}
              onOpenProjects={() => setActiveView("projects")}
            />
          ) : activeView === "projects" ? (
            <ProjectOverviewPage
              projects={projects}
              workflowItems={workflowItems}
              bomItems={bomItems}
              search={search}
              onOpenProduct={handleOpenProduct}
            />
          ) : activeView === "settings" ? (
            <SystemManagementPage
              accountCount={accounts.length}
              definitionCount={definitions.length}
              onOpenAccounts={() => setAccountDialogOpen(true)}
              onOpenTemplates={() => setTemplateDialogOpen(true)}
              onChangePassword={() => setPasswordDialogOpen(true)}
            />
          ) : (
            <div className="product-workspace-shell">
              <ProductWorkspaceNav
                project={currentProject}
                product={currentProduct}
                phase={currentPhase}
                activeView={activeView}
                onViewChange={handleViewChange}
                canManage={isAdmin}
                canDeleteProduct={currentProject.products.length > 1}
                canAddStage={stageAdvance.canAdd}
                canDeleteStage={currentProduct.phases.filter(({ type }) => Boolean(STAGE_TEMPLATES[type])).length > 1
                  && currentProduct.phases.filter(({ type }) => Boolean(STAGE_TEMPLATES[type])).at(-1)?.id === currentPhase.id}
                onNewProduct={() => setProductDialogOpen(true)}
                onAddStage={() => setStageDialogOpen(true)}
                onDeleteStage={() => setDeleteStageDialogOpen(true)}
                onEditProduct={() => setRenameDialogType("product")}
                onDeleteProduct={() => setDeleteProductDialogOpen(true)}
              />

              {activeView === "workflow" || (activeView === "files" && currentPhase.type !== "MP") ? (
                <StageGateDashboard
                  project={currentProject}
                  product={currentProduct}
                  selectedPhase={currentPhase}
                  workflowItems={projectWorkflowItems}
                  meetings={productMeetings}
                  bomItems={productBomItems}
                  materialTasks={productTasks}
                  search={search}
                  selectedItemId={selectedWorkflowItemId}
                  onSelectItem={(item) => setSelectedWorkflowItemId(item.id)}
                  onOpenMeeting={(meeting) => setSelectedMeetingId(meeting.id)}
                  onOpenTransition={() => setStageTransitionDialogOpen(true)}
                  onOpenTasks={() => setActiveView("tasks")}
                  onOpenMaterials={() => setActiveView("materials")}
                  onOpenFiles={currentPhase.type === "MP" ? () => setActiveView("files") : undefined}
                  canManage={isAdmin}
                  onAddWorkflowItem={() => setWorkflowItemDialogOpen(true)}
                  onArchiveWorkflowItem={handleArchiveWorkflowItem}
                />
              ) : activeView === "materials" ? (
                <MaterialReadinessPage
                  project={currentProductContext}
                  phase={currentPhase}
                  materials={phaseMaterials}
                  bomItems={phaseBomItems}
                  bomImports={phaseBomImports}
                  quotations={phaseQuotations}
                  accounts={accounts}
                  currentAccount={currentAccount}
                  canManage={isAdmin}
                  focusedMaterialId={focusedBomMaterialId}
                  onFocusedMaterialChange={setFocusedBomMaterialId}
                  onImport={isAdmin ? () => setBomImportDialogOpen(true) : undefined}
                  onUpdateItem={handleUpdateBomItem}
                  onAssignItems={isAdmin ? handleAssignBomItems : undefined}
                  onBulkReady={isAdmin ? handleBulkReadyBom : undefined}
                  onOpenQuotation={(itemId) => setQuotationDialogItemId(itemId)}
                />
              ) : activeView === "files" && currentPhase.type === "MP" ? (
                <div className="content-stack product-file-page">
                  <ProductFileMatrix
                    project={currentProject}
                    product={currentProduct}
                    definitions={definitions}
                    tasks={productTasks}
                    search={search}
                    selectedTaskId={selectedTaskId}
                    onSelectTask={(task) => setSelectedTaskId(task.id)}
                    onOpenDefinition={handleOpenProductFileDefinition}
                  />
                </div>
              ) : (
                <div className="content-stack workspace-task-page">
                  <div className="workspace-task-toolbar">
                    <ReadinessSummary summary={summary} />
                    {isAdmin ? <div className="heading-actions">
                      {stageAdvance.canAdd ? (
                        <button className="button button-secondary" type="button" onClick={() => setStageDialogOpen(true)} title="为当前产品补充适用阶段">
                          <CalendarPlus size={16} />配置阶段
                        </button>
                      ) : null}
                      <button className="button button-primary" type="button" onClick={() => setMaterialDialogOpen(true)}><Boxes size={16} />新增物料</button>
                    </div> : null}
                  </div>
                  <section className="matrix-panel" aria-label={`${currentProject.code} ${currentProduct.name} ${currentPhase.label} 进度矩阵`}>
                    <FilterBar search={search} onSearchChange={setSearch} abnormalOnly={abnormalOnly} onAbnormalChange={setAbnormalOnly} myOnly={myOnly} onMyOnlyChange={setMyOnly} status={statusFilter} onStatusChange={setStatusFilter} onImport={isAdmin ? () => setImportDialogOpen(true) : undefined} onExport={handleExport} onRefresh={resetFilters} />
                    {visibleMaterials.length ? (
                      <TrackingMatrix definitions={definitions} materials={visibleMaterials} tasks={phaseTasks} visibleTaskIds={visibleTaskIds} selectedTaskId={selectedTaskId} onSelectTask={(task) => handleSelectTask(task?.id ?? task)} />
                    ) : (
                      <div className="matrix-empty"><ClipboardList size={26} /><strong>没有符合条件的物料</strong><span>调整阶段、搜索或筛选条件后再试。</span><button className="button button-secondary" type="button" onClick={resetFilters}>清除筛选</button></div>
                    )}
                  </section>
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {selectedTask ? (
        <TaskDrawer
          key={selectedTask.id}
          open
          task={selectedTask}
          definition={selectedDefinition}
          material={selectedMaterial}
          accounts={accounts}
          canManage={isAdmin}
          showFileVersion={activeView === "files" || isProductFileRecord(selectedTask)}
          drawerTitle={activeView === "files" ? "更新产品文件" : "更新交付进度"}
          drawerDescription={activeView === "files" ? "更新文件版本、责任、状态与附件。" : "修改责任、日期、状态与跟进记录。"}
          onClose={() => setSelectedTaskId(null)}
          onSave={handleSaveTask}
        />
      ) : null}
      {selectedWorkflowItem ? (
        <TaskDrawer
          key={selectedWorkflowItem.id}
          open
          task={selectedWorkflowItem}
          definition={{ label: selectedWorkflowItem.title, defaultRole: selectedWorkflowItem.ownerRole }}
          material={currentPhase.label}
          accounts={accounts}
          canManage={isAdmin}
          canEditDefinition={isAdmin}
          showFileVersion={selectedWorkflowItem.kind === "deliverable"}
          drawerTitle={selectedWorkflowItem.kind === "deliverable" ? "更新阶段交付文件" : "更新阶段关键任务"}
          drawerDescription={selectedWorkflowItem.criterion || "修改责任、日期、状态与附件证据。"}
          primaryContextLabel="阶段"
          secondaryContextLabel={selectedWorkflowItem.kind === "deliverable" ? "输出文件" : "关键任务"}
          onClose={() => setSelectedWorkflowItemId(null)}
          onSave={handleSaveWorkflowItem}
        />
      ) : null}
      {selectedMeeting ? (
        <MeetingDialog
          key={selectedMeeting.id}
          open
          meeting={selectedMeeting}
          phase={currentProduct.phases.find(({ id }) => id === selectedMeeting.phaseId) ?? currentPhase}
          accounts={accounts}
          canManage={isAdmin || selectedMeeting.ownerAccountId === currentAccount.id}
          onClose={() => setSelectedMeetingId(null)}
          onSave={handleSaveMeeting}
        />
      ) : null}
      {isAdmin && projectDialogOpen ? (
        <ProjectDialog
          open
          accounts={accounts}
          currentAccountId={currentAccountId}
          onClose={() => setProjectDialogOpen(false)}
          onCreate={handleCreateProject}
        />
      ) : null}
      {isAdmin && productDialogOpen ? (
        <ProductDialog
          open
          project={currentProject}
          accounts={accounts}
          currentAccountId={currentAccountId}
          onClose={() => setProductDialogOpen(false)}
          onCreate={handleCreateProduct}
        />
      ) : null}
      {isAdmin && renameDialogType === "project" && currentProject ? (
        <RenameDialog
          key={`rename-project-${currentProject.id}`}
          open
          kind="project"
          currentValue={currentProject.name || currentProject.code}
          contextLabel={`项目代码：${currentProject.code}`}
          onClose={() => setRenameDialogType("")}
          onRename={handleRenameProject}
        />
      ) : null}
      {isAdmin && renameDialogType === "product" && currentProject && currentProduct ? (
        <ProductEditDialog
          key={`edit-product-${currentProduct.id}`}
          open
          project={currentProject}
          product={currentProduct}
          onClose={() => setRenameDialogType("")}
          onSave={handleUpdateProduct}
        />
      ) : null}
      {isAdmin && deleteProjectDialogOpen ? (
        <DeleteProjectDialog
          open
          project={currentProject}
          onClose={() => setDeleteProjectDialogOpen(false)}
          onDelete={handleDeleteProject}
        />
      ) : null}
      {isAdmin && projectStatusDialogOpen && currentProject ? (
        <ProjectStatusDialog
          key={`project-status-${currentProject.id}-${currentProject.status}`}
          open
          project={currentProject}
          onClose={() => setProjectStatusDialogOpen(false)}
          onSave={handleProjectStatusChange}
        />
      ) : null}
      {isAdmin && deleteProductDialogOpen ? (
        <DeleteProductDialog
          open
          project={currentProject}
          product={currentProduct}
          onClose={() => setDeleteProductDialogOpen(false)}
          onDelete={handleDeleteProduct}
        />
      ) : null}
      {isAdmin && deleteStageDialogOpen && currentProject && currentProduct && currentPhase ? (
        <DeleteStageDialog
          key={`delete-stage-${currentPhase.id}`}
          open
          project={currentProject}
          product={currentProduct}
          phase={currentPhase}
          onClose={() => setDeleteStageDialogOpen(false)}
          onDelete={handleDeleteStage}
        />
      ) : null}
      {isAdmin && stageDialogOpen && stageAdvance.canAdd ? (
        <StageDialog
          open
          availableTypes={stageAdvance.availableTypes}
          phases={currentProduct.phases}
          onClose={() => setStageDialogOpen(false)}
          onCreate={handleCreateStage}
        />
      ) : null}
      {isAdmin && stageTransitionDialogOpen && currentProject && currentProduct && workflowCurrentPhase ? (
        <StageTransitionDialog
          key={`transition-${workflowCurrentPhase.id}`}
          open
          product={currentProduct}
          phase={workflowCurrentPhase}
          nextPhase={workflowNextPhase}
          onClose={() => setStageTransitionDialogOpen(false)}
          onSubmit={handleTransitionStage}
        />
      ) : null}
      {isAdmin && workflowItemDialogOpen && currentProject && currentProduct && currentPhase ? (
        <WorkflowItemDialog
          key={`workflow-item-${currentPhase.id}`}
          open
          project={currentProject}
          product={currentProduct}
          phase={currentPhase}
          onClose={() => setWorkflowItemDialogOpen(false)}
          onCreate={handleCreateWorkflowItem}
        />
      ) : null}
      {isAdmin && workflowArchiveItem ? (
        <WorkflowArchiveDialog
          key={workflowArchiveItem.id}
          open
          item={workflowArchiveItem}
          onClose={() => setWorkflowArchiveItem(null)}
          onArchive={(reason) => persistWorkflowItemArchive(workflowArchiveItem, true, reason)}
        />
      ) : null}
      {isAdmin && materialDialogOpen ? (
        <MaterialDialog
          open
          project={currentProductContext}
          phase={currentPhase}
          onClose={() => setMaterialDialogOpen(false)}
          onCreate={handleCreateMaterial}
        />
      ) : null}
      {isAdmin && importDialogOpen ? (
        <ImportDialog
          open
          onClose={() => setImportDialogOpen(false)}
          onImport={handleImport}
          currentProject={currentProductContext}
          currentPhase={currentPhase}
        />
      ) : null}
      {isAdmin && bomImportDialogOpen ? (
        <BomImportDialog
          open
          onClose={() => setBomImportDialogOpen(false)}
          onImport={handleBomImport}
          currentProject={currentProductContext}
          currentPhase={currentPhase}
          materials={phaseMaterials}
        />
      ) : null}
      {quotationDialogItemId ? (
        <QuotationDialog
          key={`${currentProject.id}-${currentProduct.id}-${currentPhase.id}-${quotationDialogItemId}`}
          open
          onClose={() => setQuotationDialogItemId("")}
          items={phaseBomItems}
          initialItemId={quotationDialogItemId}
          quotations={phaseQuotations}
          accounts={accounts}
          currentAccount={currentAccount}
          canManage={isAdmin}
          onUpload={handleUploadQuotation}
          onDelete={handleDeleteQuotation}
        />
      ) : null}
      {isAdmin && templateDialogOpen ? (
        <TemplateDialog
          open
          definitions={definitions}
          onClose={() => {
            setTemplateDialogOpen(false);
            setActiveView("settings");
          }}
          onAdd={(definition) => {
            const key = addDefinition(definition);
            if (key) void queueAdminSync(`已将 ${definition.label} 加入模板`);
            else notify("交付项未创建", "danger");
          }}
        />
      ) : null}
      {accountDialogOpen ? (
        <AccountDialog
          open
          accounts={accounts}
          currentAccountId={currentAccountId}
          onClose={() => setAccountDialogOpen(false)}
          onCreate={handleCreateAccount}
          onUpdate={handleUpdateAccount}
          onDelete={handleDeleteAccount}
          onResetPassword={handleResetPassword}
          onLogout={handleLogoutRequest}
          onChangePassword={() => {
            setAccountDialogOpen(false);
            setPasswordDialogOpen(true);
          }}
        />
      ) : null}
      <PasswordDialog open={passwordDialogOpen} account={currentAccount} onClose={() => setPasswordDialogOpen(false)} onChangePassword={handlePasswordChangeFromDialog} />

      {toast ? (
        <div key={toast.key} className={`toast toast--${toast.tone}`} role="status" aria-live="polite">
          {toast.tone === "success" ? <CheckCircle2 size={17} /> : null}
          {toast.message}
        </div>
      ) : null}
      {exporting ? <div className="busy-indicator" role="status">正在生成 Excel…</div> : null}
    </div>
  );
}

export default App;
