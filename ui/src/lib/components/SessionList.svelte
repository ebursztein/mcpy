<script lang="ts">
	import type { SessionInfo } from '$lib/api';

	let { sessions }: { sessions: SessionInfo[] } = $props();

	function formatTime(iso: string): string {
		const d = new Date(iso);
		return d.toLocaleTimeString();
	}

	function truncateId(id: string): string {
		return id.slice(0, 8);
	}
</script>

<div class="card bg-base-200 shadow">
	<div class="card-body p-4">
		<h3 class="card-title text-sm">Active Sessions</h3>

		{#if sessions.length === 0}
			<p class="text-sm text-base-content/40">No active connections</p>
		{:else}
			<div class="space-y-2">
				{#each sessions as session}
					<div class="flex items-center gap-2 text-sm">
						<span class="badge badge-success badge-xs"></span>
						<span class="font-mono text-xs">{truncateId(session.sessionId)}</span>
						<span class="text-base-content/60">{session.clientName}</span>
						<span class="text-base-content/40 ml-auto text-xs">since {formatTime(session.connectedAt)}</span>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>
