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
	import GroupTable from '$lib/components/GroupTable.svelte';
	import GroupDetailModal from '$lib/components/GroupDetailModal.svelte';

	let tools: ToolInfo[] = $state([]);
	let groups: GroupInfo[] = $state([]);
	let stats: AggregateStats = $state({ totalInvocations: 0, successCount: 0, errorCount: 0, tools: {} });
	let selectedGroup: GroupInfo | null = $state(null);

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
</script>

<div class="flex flex-col gap-4">
	<h2 class="text-2xl font-bold">Tools</h2>

	<GroupTable {tools} toolStats={stats.tools} {groups} onGroupClick={(g) => selectedGroup = g} />
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
