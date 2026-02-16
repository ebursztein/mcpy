<script lang="ts">
	import { onMount } from 'svelte';
	import {
		fetchVersion,
		triggerUpdate,
		fetchClients,
		installToClient,
		uninstallFromClient,
		type VersionInfo,
		type ClientsStatus
	} from '$lib/api';

	let versionInfo: VersionInfo | null = $state(null);
	let updating = $state(false);
	let updateError: string | null = $state(null);
	let clientsStatus: ClientsStatus | null = $state(null);
	let copied = $state(false);
	let busyClient: string | null = $state(null);
	let clientError: string | null = $state(null);

	const configSnippet = $derived(
		clientsStatus
			? JSON.stringify({ mcpServers: { mcpy: { command: clientsStatus.binaryPath } } }, null, 2)
			: ''
	);

	onMount(async () => {
		[versionInfo, clientsStatus] = await Promise.all([fetchVersion(), fetchClients()]);
	});

	async function toggleClient(clientId: string, installed: boolean) {
		busyClient = clientId;
		clientError = null;
		const result = installed
			? await uninstallFromClient(clientId)
			: await installToClient(clientId);
		if (result.ok) {
			clientsStatus = await fetchClients();
		} else {
			clientError = result.error || 'Failed';
		}
		busyClient = null;
	}

	async function copySnippet() {
		await navigator.clipboard.writeText(configSnippet);
		copied = true;
		setTimeout(() => copied = false, 2000);
	}

	async function handleUpdate() {
		updating = true;
		updateError = null;
		try {
			const result = await triggerUpdate();
			if (!result.ok) {
				updateError = result.error || 'Update failed';
			}
		} catch (err) {
			updateError = 'Update request failed';
		}
		updating = false;
	}
</script>

<div class="flex flex-col gap-6 max-w-4xl">
	<h2 class="text-2xl font-bold">AI Clients</h2>

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

	<!-- MCP Clients -->
	{#if clientsStatus}
		<div class="card bg-base-200 shadow">
			<div class="card-body p-4 gap-4">
				<h3 class="font-semibold">MCP Clients</h3>

				<!-- Client status rows -->
				<div class="flex flex-col gap-2">
					{#each clientsStatus.clients as client}
						<div class="flex items-center justify-between py-1.5 px-2 rounded-lg bg-base-300/50">
							<div class="flex flex-col min-w-0">
								<span class="font-medium text-sm">{client.name}</span>
								<span class="text-xs text-base-content/30 font-mono truncate" title={client.configPath}>
									{client.configPath}
								</span>
							</div>
							<div class="flex items-center gap-2 shrink-0">
								{#if busyClient === client.id}
									<span class="loading loading-spinner loading-xs"></span>
								{:else}
									<input
										type="checkbox"
										class="toggle toggle-sm toggle-success"
										checked={client.installed}
										onchange={() => toggleClient(client.id, client.installed)}
									/>
								{/if}
							</div>
						</div>
					{/each}
				</div>
				{#if clientError}
					<div class="text-xs text-error">{clientError}</div>
				{/if}

				<!-- JSON config snippet -->
				<div class="divider my-0"></div>
				<div class="flex flex-col gap-2">
					<div class="flex items-center justify-between">
						<div>
							<h4 class="font-medium text-sm">Add to any MCP client</h4>
							<p class="text-xs text-base-content/50">Paste this into your client's MCP config file</p>
						</div>
						<button
							class="btn btn-sm btn-ghost"
							onclick={copySnippet}
						>
							{#if copied}
								<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-success" viewBox="0 0 20 20" fill="currentColor">
									<path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
								</svg>
								Copied
							{:else}
								<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
									<path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
									<path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" />
								</svg>
								Copy
							{/if}
						</button>
					</div>
					<pre class="bg-base-300 rounded-lg p-3 text-xs font-mono overflow-x-auto select-all">{configSnippet}</pre>
				</div>
			</div>
		</div>
	{/if}

	<p class="text-xs text-base-content/40">Tool-specific settings (API keys, database connections) are configured on the <a href="/tools" class="link link-primary">Tool Config</a> page.</p>
</div>
