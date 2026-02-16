<script lang="ts">
	import type { ToolInfo, ToolStats, GroupInfo } from '$lib/api';

	let { tools, toolStats, groups = [] }: { tools: ToolInfo[]; toolStats: Record<string, ToolStats>; groups: GroupInfo[] } = $props();

	const categoryLabels: Record<string, string> = {
		agent: 'Agent',
		database: 'Database',
		developer: 'Developer',
		web: 'Web'
	};

	const groupMap = $derived(new Map(groups.map(g => [g.id, g])));

	const categories = $derived(
		[...new Set(tools.map(t => t.category))].sort()
	);

	function groupsInCategory(cat: string): string[] {
		const catTools = tools.filter(t => t.category === cat);
		return [...new Set(catTools.map(t => t.group || t.name))].sort();
	}

	function toolsForGroup(cat: string, group: string): ToolInfo[] {
		return [...tools.filter(t => t.category === cat && (t.group || t.name) === group)].sort((a, b) => {
			const aStats = toolStats[a.name];
			const bStats = toolStats[b.name];
			const aTime = aStats?.lastInvoked ? new Date(aStats.lastInvoked).getTime() : 0;
			const bTime = bStats?.lastInvoked ? new Date(bStats.lastInvoked).getTime() : 0;
			if (aTime !== bTime) return bTime - aTime;
			return a.name.localeCompare(b.name);
		});
	}

	function statusColor(tool: ToolInfo, ts: ToolStats | undefined): string {
		if (!tool.enabled) return 'text-base-content/30';
		if (tool.missingSettings && tool.missingSettings.length > 0) return 'text-warning';
		if (ts && ts.errorCount > 0 && ts.errorCount >= ts.successCount) return 'text-warning';
		return 'text-success';
	}

	function timeAgo(iso: string | null): string {
		if (!iso) return 'never';
		const diff = Date.now() - new Date(iso).getTime();
		if (diff < 60000) return 'just now';
		if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
		if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
		return `${Math.floor(diff / 86400000)}d ago`;
	}
</script>

{#each categories as category}
	<div class="flex flex-col gap-2">
		<h3 class="text-xs font-semibold uppercase tracking-wider text-base-content/50">{categoryLabels[category] || category}</h3>
		<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
			{#each groupsInCategory(category) as group}
				<div class="card bg-base-200 shadow">
					<div class="card-body p-4 gap-2">
						<h4 class="font-medium text-sm">{groupMap.get(group)?.label || group}</h4>
						<div class="space-y-1">
							{#each toolsForGroup(category, group) as tool}
								{@const ts = toolStats[tool.name]}
								<div class="flex items-center gap-2 py-1 text-sm">
									<span class="w-2 h-2 rounded-full shrink-0 {statusColor(tool, ts)}" style="background-color: currentColor;"></span>
									<span class="truncate flex-1" class:opacity-40={!tool.enabled}>
										{tool.title}
									</span>
									{#if !tool.enabled}
										<span class="text-xs text-base-content/30">off</span>
									{:else if ts && ts.totalCalls > 0}
										<span class="text-xs text-base-content/40">{ts.successCount}/{ts.errorCount}</span>
										<span class="text-xs text-base-content/30">{timeAgo(ts.lastInvoked)}</span>
									{/if}
								</div>
							{/each}
						</div>
					</div>
				</div>
			{/each}
		</div>
	</div>
{/each}
