<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { createEventSource, type McpEvent } from '$lib/events';
	import { fetchStats, fetchTools, fetchGroups, type AggregateStats, type ToolInfo, type GroupInfo } from '$lib/api';
	import GroupTable from '$lib/components/GroupTable.svelte';
	import GroupDetailModal from '$lib/components/GroupDetailModal.svelte';
	import EventLog from '$lib/components/EventLog.svelte';
	import DashboardCharts from '$lib/components/DashboardCharts.svelte';

	let events: McpEvent[] = $state([]);
	let stats: AggregateStats = $state({ totalInvocations: 0, successCount: 0, errorCount: 0, tools: {} });
	let tools: ToolInfo[] = $state([]);
	let groups: GroupInfo[] = $state([]);
	let paused = $state(false);
	let es: EventSource | null = null;
	let pollInterval: ReturnType<typeof setInterval> | null = null;
	let selectedGroup: GroupInfo | null = $state(null);

	// Only show groups that have at least one enabled tool
	const activeGroups = $derived(
		groups.filter(g => {
			const gTools = tools.filter(t => (t.group || t.name) === g.id);
			return gTools.some(t => t.enabled);
		})
	);

	onMount(async () => {
		[stats, tools, groups] = await Promise.all([fetchStats(), fetchTools(), fetchGroups()]);

		es = createEventSource((event) => {
			if (!paused) {
				events = [...events.slice(-499), event];
				if (event.type === 'tool_result' || event.type === 'tool_error') {
					stats.totalInvocations++;
					if (event.type === 'tool_result') stats.successCount++;
					else stats.errorCount++;
				}
			}
		});

		pollInterval = setInterval(async () => {
			stats = await fetchStats();
		}, 10000);
	});

	onDestroy(() => {
		es?.close();
		if (pollInterval) clearInterval(pollInterval);
	});

	function clearEvents() {
		events = [];
	}

	function handleToolToggle(name: string, enabled: boolean) {
		tools = tools.map(t => t.name === name ? { ...t, enabled } : t);
	}
</script>

<div class="flex flex-col gap-4">
	<h2 class="text-2xl font-bold">Dashboard</h2>

	<DashboardCharts />

	<GroupTable {tools} toolStats={stats.tools} groups={activeGroups} onGroupClick={(g) => selectedGroup = g} />

	<EventLog {events} {paused} onTogglePause={() => paused = !paused} onClear={clearEvents} />
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
