<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { createEventSource, type McpEvent } from '$lib/events';
	import { fetchStats, fetchSessions, fetchTools, type AggregateStats, type SessionInfo, type ToolInfo } from '$lib/api';
	import StatsBar from '$lib/components/StatsBar.svelte';
	import SessionList from '$lib/components/SessionList.svelte';
	import ToolHealthGrid from '$lib/components/ToolHealthGrid.svelte';
	import EventLog from '$lib/components/EventLog.svelte';

	let events: McpEvent[] = $state([]);
	let stats: AggregateStats = $state({ totalInvocations: 0, successCount: 0, errorCount: 0, tools: {} });
	let sessions: SessionInfo[] = $state([]);
	let tools: ToolInfo[] = $state([]);
	let paused = $state(false);
	let es: EventSource | null = null;
	let pollInterval: ReturnType<typeof setInterval> | null = null;

	onMount(async () => {
		// Initial data load
		[stats, sessions, tools] = await Promise.all([fetchStats(), fetchSessions(), fetchTools()]);

		// SSE for live events
		es = createEventSource((event) => {
			if (!paused) {
				events = [...events.slice(-499), event];

				// Update stats locally from events
				if (event.type === 'tool_result' || event.type === 'tool_error') {
					stats.totalInvocations++;
					if (event.type === 'tool_result') stats.successCount++;
					else stats.errorCount++;
				}
				if (event.type === 'session_connect' || event.type === 'session_disconnect') {
					// Refresh sessions
					fetchSessions().then(s => sessions = s);
				}
			}
		});

		// Poll stats and sessions periodically
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

	const toolCount = $derived(tools.length);
	const enabledCount = $derived(tools.filter(t => t.enabled).length);
</script>

<div class="flex flex-col gap-4">
	<h2 class="text-2xl font-bold">Dashboard</h2>

	<!-- Stats bar -->
	<StatsBar
		totalInvocations={stats.totalInvocations}
		successRate={stats.totalInvocations > 0 ? Math.round((stats.successCount / stats.totalInvocations) * 100) : 100}
		activeSessions={sessions.length}
		toolsEnabled={enabledCount}
		toolsTotal={toolCount}
	/>

	<!-- Tool Health (one card per category) -->
	<ToolHealthGrid {tools} toolStats={stats.tools} />

	<!-- Active sessions -->
	<SessionList {sessions} />

	<!-- Live activity log -->
	<EventLog {events} {paused} onTogglePause={() => paused = !paused} onClear={clearEvents} />
</div>
