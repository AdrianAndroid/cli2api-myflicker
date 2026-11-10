export type StepState = "pending" | "active" | "done" | "failed";

export interface Step {
  key: string;
  name: string;
  state: StepState;
  detail?: string;
}

export interface HealthSecurity {
  allowed_cidrs: string[];
  rate_limit_per_min: number | null;
  allowed_args_regex: string | null;
  admin_key_enabled: boolean;
}

export interface Health {
  ok: boolean;
  redis: { ok: boolean; error: string | null };
  worker: { ok: boolean | null; online_workers: number; error: string | null };
  queue: string;
  queue_depth: number | null;
  max_queue_depth: number;
  myflicker_bin: string;
  myflicker_cwd: string | null;
  default_timeout: number;
  max_timeout: number;
  log_dir: string;
  bind: string;
  lan_enabled: boolean;
  lan_urls: string[];
  security: HealthSecurity;
}

export interface SetupInfo {
  backendRoot: string;
  dataDir: string;
  venvDir: string;
  venvExists: boolean;
  python: string;
  systemPython: string;
  requirements: boolean;
  installing: boolean;
  ready: boolean;
  missingModules: string[];
  error: string | null;
}

export interface ServiceStatus {
  state: "stopped" | "starting" | "running" | "stopping" | "error";
  mode: "owned" | "external" | null;
  port: number;
  baseUrl: string;
  redis: { host: string; port: number };
  bin: string;
  cwd: string;
  logDir: string;
  steps: Step[];
  health: Health | null;
  queueDepth: number | null;
  workers: number;
  lastError: string | null;
  startedAt: number | null;
  uptimeMs: number;
  logs: { redis: string; worker: string; api: string };
  setup?: SetupInfo | null;
}

export interface ApiResult<T = any> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
}

export interface TaskRow {
  task_id: string;
  status: "pending" | "running" | "success" | "failure" | "canceled";
  args: string[] | null;
  source: string | null;
  client_ip: string | null;
  submitted_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  returncode: number | null;
  timed_out: boolean;
  error: string | null;
}

export interface TaskResult extends TaskRow {
  cmd: string[] | null;
  cmdline: string | null;
  cwd: string | null;
  timeout: number | null;
  stdout?: string;
  stderr?: string;
  finished: boolean;
  poll_hint_ms?: number;
  events?: Array<Record<string, unknown>>;
}

export interface Bridge {
  getStatus(): Promise<ServiceStatus>;
  start(): Promise<ServiceStatus>;
  stop(): Promise<ServiceStatus>;
  restart(): Promise<ServiceStatus>;
  onStatus(callback: (status: ServiceStatus) => void): () => void;
  submit(payload: Record<string, unknown>): Promise<ApiResult<{ task_id: string; status: string; timeout: number }>>;
  result(taskId: string, includeEvents?: boolean): Promise<ApiResult<TaskResult>>;
  listTasks(limit?: number): Promise<ApiResult<{ tasks: TaskRow[]; queue_depth: number | null; count: number }>>;
  cancel(taskId: string): Promise<ApiResult<{ status: string }>>;
  tailLogs(source: string, cursor: number): Promise<{ lines: string[]; cursor: number; truncated?: boolean }>;
  openLog(source: string): Promise<string>;
  readEnv(): Promise<{ masked: Record<string, string>; path: string }>;
  saveEnv(patch: Record<string, string>): Promise<{ masked: Record<string, string>; path: string }>;
  rotateKey(key: string): Promise<{ key: string; value: string; masked: Record<string, string> }>;
  pickFile(): Promise<string | null>;
  pickDir(): Promise<string | null>;
  openPath(target: string): Promise<string>;
  netUrls(): Promise<Array<{ iface: string; url: string }>>;
  setupStatus(): Promise<SetupInfo>;
  setupInit(): Promise<SetupInfo>;
}

declare global {
  interface Window {
    api: Bridge;
  }
}
