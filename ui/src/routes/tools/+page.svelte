<script lang="ts">
	import { onMount } from 'svelte';
	import {
		fetchTools,
		fetchGroups,
		fetchStats,
		type ToolInfo,
		type GroupInfo,
		type AggregateStats
	} from '$lib/api';
	import GroupDetailModal from '$lib/components/GroupDetailModal.svelte';

	let tools: ToolInfo[] = $state([]);
	let groups: GroupInfo[] = $state([]);
	let stats: AggregateStats = $state({ totalInvocations: 0, successCount: 0, errorCount: 0, tools: {} });
	let selectedGroup: GroupInfo | null = $state(null);
	let search = $state('');
	let statusFilter: 'all' | 'on' | 'off' = $state('all');
	let categoryFilter = $state('all');

	const categoryLabels: Record<string, string> = {
		agent: 'Agent',
		database: 'Database',
		developer: 'Developer',
		web: 'Web'
	};

	onMount(async () => {
		[tools, groups, stats] = await Promise.all([
			fetchTools(),
			fetchGroups(),
			fetchStats()
		]);
	});

	function handleToolToggle(name: string, enabled: boolean) {
		tools = tools.map(t => t.name === name ? { ...t, enabled } : t);
	}

	const groupMap = $derived(new Map(groups.map(g => [g.id, g])));

	const categories = $derived(
		[...new Set(tools.map(t => t.category))].sort()
	);

	// Filter groups based on search, status, and category
	const filteredGroups = $derived.by(() => {
		return groups.filter(g => {
			const gTools = tools.filter(t => (t.group || t.name) === g.id);
			if (gTools.length === 0) return false;

			// Category filter
			if (categoryFilter !== 'all' && gTools[0]?.category !== categoryFilter) return false;

			// Status filter
			const enabledCount = gTools.filter(t => t.enabled).length;
			if (statusFilter === 'on' && enabledCount === 0) return false;
			if (statusFilter === 'off' && enabledCount === gTools.length) return false;

			// Search filter
			if (search) {
				const q = search.toLowerCase();
				const matchesGroup = g.label.toLowerCase().includes(q) || g.id.toLowerCase().includes(q);
				const matchesTool = gTools.some(t =>
					t.title.toLowerCase().includes(q) ||
					t.name.toLowerCase().includes(q) ||
					t.description.toLowerCase().includes(q)
				);
				if (!matchesGroup && !matchesTool) return false;
			}

			return true;
		});
	});

	// Group filtered groups by category
	const groupsByCategory = $derived.by(() => {
		const result: { category: string; label: string; groups: GroupInfo[] }[] = [];
		const cats = [...new Set(filteredGroups.map(g => {
			const gTools = tools.filter(t => (t.group || t.name) === g.id);
			return gTools[0]?.category || '';
		}))].filter(Boolean).sort();

		for (const cat of cats) {
			const catGroups = filteredGroups.filter(g => {
				const gTools = tools.filter(t => (t.group || t.name) === g.id);
				return gTools[0]?.category === cat;
			});
			if (catGroups.length > 0) {
				result.push({ category: cat, label: categoryLabels[cat] || cat, groups: catGroups });
			}
		}
		return result;
	});

	function toolsForGroup(groupId: string): ToolInfo[] {
		return tools.filter(t => (t.group || t.name) === groupId);
	}

	function groupStats(groupId: string) {
		const gTools = toolsForGroup(groupId);
		const enabled = gTools.filter(t => t.enabled).length;
		let totalCalls = 0;
		let errors = 0;
		for (const t of gTools) {
			const ts = stats.tools[t.name];
			if (ts) {
				totalCalls += ts.totalCalls;
				errors += ts.errorCount;
			}
		}
		return { enabled, total: gTools.length, totalCalls, errors };
	}

	function statusDot(groupId: string): string {
		const s = groupStats(groupId);
		if (s.enabled === 0) return 'bg-base-content/20';
		const gTools = toolsForGroup(groupId);
		const hasMissing = gTools.some(t => t.enabled && t.missingSettings && t.missingSettings.length > 0);
		if (hasMissing) return 'bg-warning';
		return 'bg-success';
	}
</script>

<div class="flex flex-col gap-4">
	<div class="flex items-center justify-between">
		<h2 class="text-2xl font-bold">Tool Config</h2>
		<span class="text-sm text-base-content/40">{filteredGroups.length} of {groups.length} groups</span>
	</div>

	<!-- Search + Filters -->
	<div class="flex flex-wrap items-center gap-2">
		<input
			type="text"
			placeholder="Search tools..."
			class="input input-sm input-bordered flex-1 min-w-48"
			bind:value={search}
		/>
		<div class="join">
			<button class="join-item btn btn-sm {statusFilter === 'all' ? 'btn-active' : 'btn-ghost'}" onclick={() => statusFilter = 'all'}>All</button>
			<button class="join-item btn btn-sm {statusFilter === 'on' ? 'btn-active' : 'btn-ghost'}" onclick={() => statusFilter = 'on'}>On</button>
			<button class="join-item btn btn-sm {statusFilter === 'off' ? 'btn-active' : 'btn-ghost'}" onclick={() => statusFilter = 'off'}>Off</button>
		</div>
		<select class="select select-sm select-bordered" bind:value={categoryFilter}>
			<option value="all">All categories</option>
			{#each categories as cat}
				<option value={cat}>{categoryLabels[cat] || cat}</option>
			{/each}
		</select>
	</div>

	<!-- Cards by category -->
	{#if groupsByCategory.length === 0}
		<div class="text-center py-12 text-base-content/40">
			<p class="text-sm">No tools match your filters</p>
		</div>
	{/if}

	{#each groupsByCategory as { category, label, groups: catGroups }}
		<div class="flex flex-col gap-2">
			<h3 class="text-xs font-semibold uppercase tracking-wider text-base-content/50">{label}</h3>
			<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
				{#each catGroups as group}
					{@const gs = groupStats(group.id)}
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class="card bg-base-200 shadow cursor-pointer hover:bg-base-300/50 transition-colors"
						onclick={() => selectedGroup = group}
					>
						<div class="card-body p-4 gap-2">
							<div class="flex items-center gap-2">
								<span class="w-2.5 h-2.5 rounded-full shrink-0 {statusDot(group.id)}"></span>
								<h4 class="font-medium text-sm flex-1">{group.label}</h4>
								<span class="text-xs text-base-content/40">{gs.enabled}/{gs.total}</span>
							</div>
							<p class="text-xs text-base-content/50 line-clamp-2">{group.description}</p>
							{#if gs.totalCalls > 0}
								<div class="flex items-center gap-2 text-xs text-base-content/30 mt-0.5">
									<span>{gs.totalCalls.toLocaleString()} calls</span>
									{#if gs.errors > 0}
										<span class="text-error">{gs.errors} errors</span>
									{/if}
								</div>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		</div>
	{/each}
</div>

{#if selectedGroup}
	<GroupDetailModal
		group={selectedGroup}
		{tools}
		toolStats={stats.tools}
		onClose={() => selectedGroup = null}
		onToolToggle={handleToolToggle}
		onToolsRefresh={(t) => tools = t}
	/>
{/if}
