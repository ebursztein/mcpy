<script lang="ts">
	import type { ToolInfo, ToolStats, GroupInfo } from '$lib/api';

	let {
		tools,
		toolStats,
		groups,
		onGroupClick
	}: {
		tools: ToolInfo[];
		toolStats: Record<string, ToolStats>;
		groups: GroupInfo[];
		onGroupClick: (group: GroupInfo) => void;
	} = $props();

	interface GroupRow {
		group: GroupInfo;
		tools: ToolInfo[];
		enabledCount: number;
		totalCalls: number;
		errorCount: number;
		errorRate: number;
		avgLatency: number;
		status: 'enabled' | 'disabled';
	}

	const rows = $derived.by(() => {
		return groups.map((g): GroupRow => {
			const gTools = tools.filter(t => (t.group || t.name) === g.id);
			const enabledCount = gTools.filter(t => t.enabled).length;
			let totalCalls = 0;
			let errorCount = 0;
			let totalDuration = 0;
			let durationCount = 0;
			for (const t of gTools) {
				const ts = toolStats[t.name];
				if (ts) {
					totalCalls += ts.totalCalls;
					errorCount += ts.errorCount;
					if (ts.avgDuration > 0 && ts.totalCalls > 0) {
						totalDuration += ts.avgDuration * ts.totalCalls;
						durationCount += ts.totalCalls;
					}
				}
			}
			const avgLatency = durationCount > 0 ? totalDuration / durationCount : 0;
			const errorRate = totalCalls > 0 ? (errorCount / totalCalls) * 100 : 0;
			const status: 'enabled' | 'disabled' = enabledCount > 0 ? 'enabled' : 'disabled';
			return { group: g, tools: gTools, enabledCount, totalCalls, errorCount, errorRate, avgLatency, status };
		}).sort((a, b) => {
			if (a.status !== b.status) return a.status === 'enabled' ? -1 : 1;
			return b.totalCalls - a.totalCalls;
		});
	});

	function statusDot(status: string): string {
		return status === 'enabled' ? 'bg-success' : 'bg-base-content/20';
	}

	function formatLatency(ms: number): string {
		if (ms === 0) return '--';
		if (ms < 1000) return Math.round(ms) + 'ms';
		return (ms / 1000).toFixed(1) + 's';
	}
</script>

<div class="overflow-x-auto">
	<table class="table table-sm">
		<thead>
			<tr class="text-xs text-base-content/40">
				<th class="w-8"></th>
				<th>Group</th>
				<th class="text-center">Enabled</th>
				<th class="text-right">Calls</th>
				<th class="text-right">Error Rate</th>
				<th class="text-right">Avg Latency</th>
			</tr>
		</thead>
		<tbody>
			{#each rows as row}
				<tr
					class="cursor-pointer hover:bg-base-300/50 transition-colors {row.status === 'disabled' ? 'opacity-40' : ''}"
					onclick={() => onGroupClick(row.group)}
				>
					<td>
						<span class="w-2.5 h-2.5 rounded-full inline-block {statusDot(row.status)}"></span>
					</td>
					<td>
						<div class="flex items-center gap-2">
							<span class="font-medium text-sm">{row.group.label}</span>
							{#if row.group.remote}
								<span class="badge badge-accent badge-xs">remote</span>
							{/if}
						</div>
					</td>
					<td class="text-center">
						<span class="text-sm">{row.enabledCount}<span class="text-base-content/30">/{row.tools.length}</span></span>
					</td>
					<td class="text-right">
						<span class="text-sm font-mono">{row.totalCalls > 0 ? row.totalCalls.toLocaleString() : '--'}</span>
					</td>
					<td class="text-right">
						{#if row.totalCalls === 0}
							<span class="text-sm font-mono">--</span>
						{:else if row.errorRate === 0}
							<span class="text-sm font-mono text-success">0%</span>
						{:else if row.errorRate < 10}
							<span class="text-sm font-mono text-warning">{row.errorRate.toFixed(1)}%</span>
						{:else}
							<span class="text-sm font-mono text-error">{row.errorRate.toFixed(1)}%</span>
						{/if}
					</td>
					<td class="text-right">
						<span class="text-sm font-mono">{formatLatency(row.avgLatency)}</span>
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>
