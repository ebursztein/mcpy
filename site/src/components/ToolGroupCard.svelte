<script lang="ts">
	interface CatalogTool {
		name: string;
		title: string;
		description: string;
		remote?: boolean;
	}

	interface CatalogGroup {
		id: string;
		category: string;
		label: string;
		description: string;
		url?: string;
		remote?: boolean;
		requiresConfig: boolean;
		tools: CatalogTool[];
	}

	let { group }: { group: CatalogGroup } = $props();
	let expanded = $state(false);
</script>

<div
	class="card bg-base-200 shadow cursor-pointer transition-all {expanded ? 'ring-1 ring-primary/30' : ''}"
	onclick={() => expanded = !expanded}
	onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); expanded = !expanded; } }}
	role="button"
	tabindex="0"
>
	<div class="card-body p-4 gap-2">
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-2">
				<h4 class="font-medium text-sm">{group.label}</h4>
				{#if group.remote}
					<span class="badge badge-accent badge-xs">remote</span>
				{/if}
				{#if group.requiresConfig}
					<span class="badge badge-warning badge-xs">config required</span>
				{/if}
			</div>
			<div class="flex items-center gap-2">
				<span class="badge badge-ghost badge-xs">{group.tools.length} {group.tools.length === 1 ? 'tool' : 'tools'}</span>
				<svg
					class="w-4 h-4 transition-transform text-base-content/40"
					class:rotate-180={expanded}
					viewBox="0 0 20 20"
					fill="currentColor"
				>
					<path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" />
				</svg>
			</div>
		</div>
		<p class="text-xs text-base-content/50">{group.description}</p>
		{#if group.url}
			<a
				href={group.url}
				target="_blank"
				rel="noopener"
				class="link link-primary text-xs w-fit"
				onclick={(e) => e.stopPropagation()}
			>{group.url}</a>
		{/if}
		<span class="badge badge-ghost badge-xs w-fit">{group.category}</span>

		{#if expanded}
			<div class="divider my-1"></div>
			<div class="space-y-2">
				{#each group.tools as tool}
					<div class="flex flex-col gap-0.5 py-1">
						<div class="flex items-center gap-2">
							<span class="font-mono text-xs text-primary">{tool.name}</span>
							{#if tool.remote}
								<span class="badge badge-accent" style="font-size:0.6rem;padding:0 4px;">remote</span>
							{/if}
						</div>
						<p class="text-xs text-base-content/50">{tool.description}</p>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>
