<script lang="ts">
	import { onMount } from 'svelte';
	import { fetchTools, toggleTool, type ToolInfo } from '$lib/api';

	let tools: ToolInfo[] = $state([]);

	onMount(async () => {
		tools = await fetchTools();
	});

	const categories = $derived(
		[...new Set(tools.map(t => t.category))].sort()
	);

	const categoryLabels: Record<string, string> = {
		web: 'Web',
		database: 'Database',
		developer: 'Developer',
		agent: 'Agent'
	};

	function groupsInCategory(cat: string): string[] {
		const catTools = tools.filter(t => t.category === cat);
		return [...new Set(catTools.map(t => t.group || t.name))].sort();
	}

	function toolsForGroup(cat: string, group: string): ToolInfo[] {
		return tools.filter(t => t.category === cat && (t.group || t.name) === group);
	}

	function groupLabel(group: string): string {
		const labels: Record<string, string> = {
			mysql: 'MySQL',
			postgres: 'PostgreSQL',
			mcpy: 'mcpy',
			todo: 'Todo List',
			memory: 'Memory',
			packages: 'Packages',
			fetch: 'Fetch',
			perplexity: 'Perplexity',
			github: 'GitHub'
		};
		return labels[group] || group;
	}

	async function handleToggle(name: string, enabled: boolean) {
		await toggleTool(name, enabled);
		tools = tools.map(t => t.name === name ? { ...t, enabled } : t);
	}
</script>

<div class="flex flex-col gap-6">
	<h2 class="text-2xl font-bold">Tools</h2>

	{#each categories as category}
		<div class="flex flex-col gap-3">
			<h3 class="text-xs font-semibold uppercase tracking-wider text-base-content/50">{categoryLabels[category] || category}</h3>
			<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
				{#each groupsInCategory(category) as group}
					<div class="card bg-base-200 shadow">
						<div class="card-body p-4 gap-2">
							<h4 class="font-medium text-sm">{groupLabel(group)}</h4>
							<div class="space-y-2">
								{#each toolsForGroup(category, group) as tool}
									<div class="flex items-start gap-3 py-1">
										<input
											type="checkbox"
											class="toggle toggle-sm toggle-primary mt-0.5"
											checked={tool.enabled}
											onchange={() => handleToggle(tool.name, !tool.enabled)}
										/>
										<div class="flex-1 min-w-0">
											<div class="flex items-center gap-2">
												<span class="text-sm" class:opacity-40={!tool.enabled}>{tool.title}</span>
												{#if tool.remote}
													<span class="badge badge-accent badge-xs">remote</span>
												{/if}
											</div>
											<p class="text-xs text-base-content/50 line-clamp-1">{tool.description}</p>
											{#if tool.missingSettings && tool.missingSettings.length > 0}
												<span class="text-warning text-xs">Missing: {tool.missingSettings.join(', ')}</span>
											{/if}
										</div>
									</div>
								{/each}
							</div>
						</div>
					</div>
				{/each}
			</div>
		</div>
	{/each}
</div>
