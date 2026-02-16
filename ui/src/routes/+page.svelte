<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { createEventSource, type McpEvent } from '$lib/events';
	import { fetchStats, fetchSessions, fetchTools, fetchGroups, type AggregateStats, type SessionInfo, type ToolInfo, type GroupInfo } from '$lib/api';
	import SessionList from '$lib/components/SessionList.svelte';
	import GroupTable from '$lib/components/GroupTable.svelte';
	import GroupDetailModal from '$lib/components/GroupDetailModal.svelte';
	import EventLog from '$lib/components/EventLog.svelte';
	import DashboardCharts from '$lib/components/DashboardCharts.svelte';

	let events: McpEvent[] = $state([]);
	let stats: AggregateStats = $state({ totalInvocations: 0, successCount: 0, errorCount: 0, tools: {} });
	let sessions: SessionInfo[] = $state([]);
	let tools: ToolInfo[] = $state([]);
	let groups: GroupInfo[] = $state([]);
	let paused = $state(false);
	let es: EventSource | null = null;
	let pollInterval: ReturnType<typeof setInterval> | null = null;
	let selectedGroup: GroupInfo | null = $state(null);

	onMount(async () => {
		[stats, sessions, tools, groups] = await Promise.all([fetchStats(), fetchSessions(), fetchTools(), fetchGroups()]);

		es = createEventSource((event) => {
			if (!paused) {
				events = [...events.slice(-499), event];
				if (event.type === 'tool_result' || event.type === 'tool_error') {
					stats.totalInvocations++;
					if (event.type === 'tool_result') stats.successCount++;
					else stats.errorCount++;
				}
				if (event.type === 'session_connect' || event.type === 'session_disconnect') {
					fetchSessions().then(s => sessions = s);
				}
			}
		});

		pollInterval = setInterval(async () => {
			[stats, sessions] = await Promise.all([fetchStats(), fetchSessions()]);
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

	<GroupTable {tools} toolStats={stats.tools} {groups} onGroupClick={(g) => selectedGroup = g} />

	<SessionList {sessions} />

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
