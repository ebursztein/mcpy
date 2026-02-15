<script lang="ts">
	let { totalInvocations, successRate, activeSessions, toolsEnabled, toolsTotal }: {
		totalInvocations: number;
		successRate: number;
		activeSessions: number;
		toolsEnabled: number;
		toolsTotal: number;
	} = $props();

	const rateColor = $derived(
		successRate >= 95 ? 'text-success' :
		successRate >= 80 ? 'text-warning' :
		'text-error'
	);
</script>

<div class="stats stats-vertical sm:stats-horizontal shadow w-full bg-base-200">
	<div class="stat">
		<div class="stat-title">Total Invocations</div>
		<div class="stat-value text-2xl">{totalInvocations.toLocaleString()}</div>
	</div>

	<div class="stat">
		<div class="stat-title">Success Rate</div>
		<div class="stat-value text-2xl {rateColor}">{successRate}%</div>
	</div>

	<div class="stat">
		<div class="stat-title">Active Sessions</div>
		<div class="stat-value text-2xl">{activeSessions}</div>
	</div>

	<div class="stat">
		<div class="stat-title">Tools Enabled</div>
		<div class="stat-value text-2xl">{toolsEnabled}<span class="text-base text-base-content/40">/{toolsTotal}</span></div>
	</div>
</div>
