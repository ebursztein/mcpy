const BASE = '';

export interface ToolInfo {
	name: string;
	category: string;
	group?: string;
	title: string;
	description: string;
	enabled: boolean;
	remote?: boolean;
	requiredSettings?: string[];
	missingSettings?: string[];
}

export interface SessionInfo {
	sessionId: string;
	clientName: string;
	connectedAt: string;
}

export interface ToolStats {
	name: string;
	category: string;
	totalCalls: number;
	successCount: number;
	errorCount: number;
	lastInvoked: string | null;
	avgDuration: number;
}

export interface AggregateStats {
	totalInvocations: number;
	successCount: number;
	errorCount: number;
	tools: Record<string, ToolStats>;
}

export interface Settings {
	apiKeys: Record<string, string>;
	database: Record<string, Record<string, unknown>>;
	tools: Record<string, { enabled: boolean }>;
}

export interface SettingsFieldDef {
	key: string;
	label: string;
	type: "text" | "password" | "number";
	placeholder?: string;
	gridSpan?: 1 | 2;
}

export interface GroupInfo {
	id: string;
	category: string;
	label: string;
	description: string;
	url?: string;
	remote?: boolean;
	requiresConfig: boolean;
	enabledByDefault: boolean;
	settingsFields?: SettingsFieldDef[];
}

export interface TimeseriesPoint {
	timestamp: string;
	tool: string;
	duration: number;
	success: boolean;
}

export async function fetchTimeseries(): Promise<TimeseriesPoint[]> {
	const res = await fetch(`${BASE}/api/stats/timeseries`);
	return res.json();
}

export async function fetchTools(): Promise<ToolInfo[]> {
	const res = await fetch(`${BASE}/api/tools`);
	return res.json();
}

export async function fetchGroups(): Promise<GroupInfo[]> {
	const res = await fetch(`${BASE}/api/groups`);
	return res.json();
}

export async function toggleTool(name: string, enabled: boolean): Promise<void> {
	await fetch(`${BASE}/api/tools`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ name, enabled })
	});
}

export async function fetchSettings(): Promise<Settings> {
	const res = await fetch(`${BASE}/api/settings`);
	return res.json();
}

export async function updateSettings(settings: Record<string, unknown>): Promise<Settings> {
	const res = await fetch(`${BASE}/api/settings`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(settings)
	});
	return res.json();
}

export async function fetchStats(): Promise<AggregateStats> {
	const res = await fetch(`${BASE}/api/stats`);
	return res.json();
}

export async function fetchSessions(): Promise<SessionInfo[]> {
	const res = await fetch(`${BASE}/api/sessions`);
	return res.json();
}

export interface InstallStatus {
	installed: boolean;
	configPath: string;
	configExists: boolean;
	binaryPath: string;
	binaryExists: boolean;
}

export async function fetchInstallStatus(): Promise<InstallStatus> {
	const res = await fetch(`${BASE}/api/install`);
	return res.json();
}

export interface ClientInfo {
	id: string;
	name: string;
	configPath: string;
	configExists: boolean;
	installed: boolean;
}

export interface ClientsStatus {
	clients: ClientInfo[];
	binaryPath: string;
}

export async function fetchClients(): Promise<ClientsStatus> {
	const res = await fetch(`${BASE}/api/clients`);
	return res.json();
}

export async function installToClient(clientId: string): Promise<{ ok: boolean; error?: string }> {
	const res = await fetch(`${BASE}/api/clients/${clientId}/install`, { method: 'POST' });
	return res.json();
}

export async function uninstallFromClient(clientId: string): Promise<{ ok: boolean; error?: string }> {
	const res = await fetch(`${BASE}/api/clients/${clientId}/install`, { method: 'DELETE' });
	return res.json();
}

export async function installToClaude(): Promise<{ ok: boolean; error?: string }> {
	const res = await fetch(`${BASE}/api/install`, { method: 'POST' });
	return res.json();
}

export async function uninstallFromClaude(): Promise<{ ok: boolean; error?: string }> {
	const res = await fetch(`${BASE}/api/install`, { method: 'DELETE' });
	return res.json();
}

export interface VersionInfo {
	current: string;
	latest: string | null;
	updateAvailable: boolean;
}

export async function fetchVersion(): Promise<VersionInfo> {
	const res = await fetch(`${BASE}/api/version`);
	return res.json();
}

export async function triggerUpdate(): Promise<{ ok: boolean; message?: string; error?: string }> {
	const res = await fetch(`${BASE}/api/update`, { method: 'POST' });
	return res.json();
}
