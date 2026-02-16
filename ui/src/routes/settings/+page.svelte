<script lang="ts">
	import { onMount } from 'svelte';
	import {
		fetchSettings,
		updateSettings,
		fetchInstallStatus,
		installToClaude,
		uninstallFromClaude,
		fetchVersion,
		triggerUpdate,
		type Settings,
		type InstallStatus,
		type VersionInfo
	} from '$lib/api';
	import SettingsField from '$lib/components/SettingsField.svelte';

	let settings: Settings | null = $state(null);
	let saving = $state(false);
	let saved = $state(false);
	let installStatus: InstallStatus | null = $state(null);
	let installing = $state(false);
	let installError: string | null = $state(null);
	let versionInfo: VersionInfo | null = $state(null);
	let updating = $state(false);
	let updateError: string | null = $state(null);

	onMount(async () => {
		settings = await fetchSettings();
		installStatus = await fetchInstallStatus();
		versionInfo = await fetchVersion();
	});

	async function handleInstall() {
		installing = true;
		installError = null;
		const result = await installToClaude();
		if (result.ok) {
			installStatus = await fetchInstallStatus();
		} else {
			installError = result.error || 'Failed to install';
		}
		installing = false;
	}

	async function handleUninstall() {
		installing = true;
		installError = null;
		const result = await uninstallFromClaude();
		if (result.ok) {
			installStatus = await fetchInstallStatus();
		} else {
			installError = result.error || 'Failed to uninstall';
		}
		installing = false;
	}

	async function save(path: string, value: string) {
		if (!settings) return;
		saving = true;
		saved = false;

		// Build nested update object from dot path
		const parts = path.split('.');
		const update: Record<string, unknown> = {};
		let current: Record<string, unknown> = update;
		for (let i = 0; i < parts.length - 1; i++) {
			current[parts[i]] = {};
			current = current[parts[i]] as Record<string, unknown>;
		}
		current[parts[parts.length - 1]] = value;

		settings = await updateSettings(update);
		saving = false;
		saved = true;
		setTimeout(() => saved = false, 2000);
	}

	async function saveDbField(db: string, field: string, value: string) {
		const numFields = ['port'];
		const val = numFields.includes(field) ? parseInt(value, 10) || 0 : value;
		await save(`database.${db}.${field}`, val as unknown as string);
	}

	async function handleUpdate() {
		updating = true;
		updateError = null;
		try {
			const result = await triggerUpdate();
			if (!result.ok) {
				updateError = result.error || 'Update failed';
			}
			// Server will restart, so we just show the message
		} catch (err) {
			updateError = 'Update request failed';
		}
		updating = false;
	}
</script>

<div class="flex flex-col gap-6 max-w-4xl">
	<div class="flex items-center gap-2">
		<h2 class="text-2xl font-bold">Settings</h2>
		{#if saving}
			<span class="badge badge-ghost badge-sm">saving...</span>
		{/if}
		{#if saved}
			<span class="badge badge-success badge-sm">saved</span>
		{/if}
	</div>

	<!-- Version & Update -->
	{#if versionInfo}
		<div class="card bg-base-200 shadow">
			<div class="card-body p-4 gap-3">
				<div class="flex items-center justify-between">
					<div class="flex flex-col gap-1">
						<div class="flex items-center gap-2">
							<h3 class="font-semibold">mcpy</h3>
							<span class="badge badge-ghost badge-sm font-mono">v{versionInfo.current}</span>
							{#if versionInfo.updateAvailable}
								<span class="badge badge-warning badge-sm">update available</span>
							{:else}
								<span class="badge badge-success badge-sm">up to date</span>
							{/if}
						</div>
						{#if versionInfo.updateAvailable && versionInfo.latest}
							<p class="text-xs text-base-content/50">
								Version {versionInfo.latest} is available.
							</p>
						{/if}
					</div>
					{#if versionInfo.updateAvailable}
						<button
							class="btn btn-sm btn-primary"
							onclick={handleUpdate}
							disabled={updating}
						>
							{#if updating}
								<span class="loading loading-spinner loading-xs"></span>
							{:else}
								Update
							{/if}
						</button>
					{/if}
				</div>
				{#if updateError}
					<div class="text-xs text-error">{updateError}</div>
				{/if}
			</div>
		</div>
	{/if}

	<!-- Claude Desktop Integration -->
	{#if installStatus}
		<div class="card bg-base-200 shadow">
			<div class="card-body p-4 gap-3">
				<div class="flex items-center justify-between">
					<div class="flex flex-col gap-1">
						<div class="flex items-center gap-2">
							<h3 class="font-semibold">Claude Desktop</h3>
							{#if installStatus.installed}
								<span class="badge badge-success badge-sm">installed</span>
							{:else}
								<span class="badge badge-ghost badge-sm">not installed</span>
							{/if}
						</div>
						<p class="text-xs text-base-content/50">
							{#if installStatus.installed}
								mcpy is registered as an MCP server in Claude Desktop. Restart Claude Desktop to apply changes.
							{:else}
								Compile and register mcpy as a standalone MCP server in Claude Desktop. No runtime dependencies needed.
							{/if}
						</p>
					</div>
					<div class="flex items-center gap-2">
						{#if installStatus.installed}
							<button
								class="btn btn-sm btn-ghost btn-error"
								onclick={handleUninstall}
								disabled={installing}
							>
								{#if installing}
									<span class="loading loading-spinner loading-xs"></span>
								{/if}
								Remove
							</button>
						{:else}
							<button
								class="btn btn-sm btn-primary"
								onclick={handleInstall}
								disabled={installing}
							>
								{#if installing}
									<span class="loading loading-spinner loading-xs"></span>
								{:else}
									Install
								{/if}
							</button>
						{/if}
					</div>
				</div>
				{#if installing}
					<div class="text-xs text-base-content/50">Compiling binary and registering with Claude Desktop...</div>
				{/if}
				{#if installError}
					<div class="text-xs text-error">{installError}</div>
				{/if}
				<div class="text-xs text-base-content/30 font-mono truncate" title={installStatus.binaryPath}>
					{installStatus.binaryPath}
				</div>
			</div>
		</div>
	{/if}

	{#if settings}
		<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
			<!-- Hosted Services Panel -->
			<div class="flex flex-col gap-4">
				<div class="flex items-center gap-2">
					<span class="badge badge-accent badge-sm">hosted</span>
					<h3 class="text-lg font-semibold">Hosted Services</h3>
				</div>
				<p class="text-xs text-base-content/50 -mt-2">Third-party APIs -- requires an account and API key</p>

				<div class="card bg-base-200 shadow">
					<div class="card-body p-4 gap-3">
						<h4 class="font-medium text-sm">Perplexity AI</h4>
						<p class="text-xs text-base-content/50 -mt-2">Powers web_search -- AI-powered web search with citations</p>
						<SettingsField
							label="API Key"
							value={settings.apiKeys.perplexity || ''}
							type="password"
							placeholder="pplx-..."
							onSave={(v) => save('apiKeys.perplexity', v)}
						/>
					</div>
				</div>

			</div>

			<!-- Local Tools Panel -->
			<div class="flex flex-col gap-4">
				<div class="flex items-center gap-2">
					<span class="badge badge-success badge-sm">local</span>
					<h3 class="text-lg font-semibold">Local Connections</h3>
				</div>
				<p class="text-xs text-base-content/50 -mt-2">Database connections on your network -- no data leaves your machine</p>

				<div class="card bg-base-200 shadow">
					<div class="card-body p-4 gap-3">
						<h4 class="font-medium text-sm">MySQL</h4>
						<div class="grid grid-cols-2 gap-3">
							<SettingsField
								label="Host"
								value={String(settings.database.mysql?.host || '')}
								placeholder="localhost"
								onSave={(v) => saveDbField('mysql', 'host', v)}
							/>
							<SettingsField
								label="Port"
								value={String(settings.database.mysql?.port || '3306')}
								placeholder="3306"
								onSave={(v) => saveDbField('mysql', 'port', v)}
							/>
							<SettingsField
								label="User"
								value={String(settings.database.mysql?.user || '')}
								placeholder="root"
								onSave={(v) => saveDbField('mysql', 'user', v)}
							/>
							<SettingsField
								label="Password"
								value={String(settings.database.mysql?.password || '')}
								type="password"
								placeholder="password"
								onSave={(v) => saveDbField('mysql', 'password', v)}
							/>
						</div>
						<SettingsField
							label="Database"
							value={String(settings.database.mysql?.database || '')}
							placeholder="mydb"
							onSave={(v) => saveDbField('mysql', 'database', v)}
						/>
					</div>
				</div>

				<div class="card bg-base-200 shadow">
					<div class="card-body p-4 gap-3">
						<h4 class="font-medium text-sm">PostgreSQL</h4>
						<div class="grid grid-cols-2 gap-3">
							<SettingsField
								label="Host"
								value={String(settings.database.postgres?.host || '')}
								placeholder="localhost"
								onSave={(v) => saveDbField('postgres', 'host', v)}
							/>
							<SettingsField
								label="Port"
								value={String(settings.database.postgres?.port || '5432')}
								placeholder="5432"
								onSave={(v) => saveDbField('postgres', 'port', v)}
							/>
							<SettingsField
								label="User"
								value={String(settings.database.postgres?.user || '')}
								placeholder="postgres"
								onSave={(v) => saveDbField('postgres', 'user', v)}
							/>
							<SettingsField
								label="Password"
								value={String(settings.database.postgres?.password || '')}
								type="password"
								placeholder="password"
								onSave={(v) => saveDbField('postgres', 'password', v)}
							/>
						</div>
						<SettingsField
							label="Database"
							value={String(settings.database.postgres?.database || '')}
							placeholder="postgres"
							onSave={(v) => saveDbField('postgres', 'database', v)}
						/>
					</div>
				</div>
			</div>
		</div>
	{:else}
		<div class="flex justify-center p-8">
			<span class="loading loading-spinner loading-md"></span>
		</div>
	{/if}
</div>
