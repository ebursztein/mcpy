<script lang="ts">
	import type { ToolInfo } from '$lib/api';

	let { tool, onToggle }: {
		tool: ToolInfo;
		onToggle: (name: string, enabled: boolean) => void;
	} = $props();
</script>

<div class="card bg-base-200 shadow">
	<div class="card-body p-4 gap-2">
		<div class="flex items-start justify-between gap-2">
			<div class="flex items-center gap-2">
				{#if tool.remote}
					<span class="badge badge-accent badge-sm">remote</span>
				{:else}
					<span class="badge badge-success badge-sm">local</span>
				{/if}
				<h4 class="font-semibold text-sm">{tool.title}</h4>
			</div>
			<input
				type="checkbox"
				class="toggle toggle-sm toggle-primary"
				checked={tool.enabled}
				onchange={() => onToggle(tool.name, !tool.enabled)}
			/>
		</div>
		<p class="text-xs text-base-content/60 line-clamp-2">{tool.description}</p>
		{#if tool.missingSettings && tool.missingSettings.length > 0}
			<div class="flex items-center gap-1 mt-1">
				<span class="text-warning text-xs">Missing: {tool.missingSettings.join(', ')}</span>
			</div>
		{/if}
		<div class="text-xs text-base-content/30 font-mono">{tool.name}</div>
	</div>
</div>
