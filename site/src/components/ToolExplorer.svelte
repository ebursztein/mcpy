<script lang="ts">
	import ToolGroupCard from './ToolGroupCard.svelte';

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

	let { groups }: { groups: CatalogGroup[] } = $props();

	let search = $state('');
	let selectedCategory = $state('all');

	const categories = $derived(
		['all', ...[...new Set(groups.map(g => g.category))].sort()]
	);

	const categoryLabels: Record<string, string> = {
		all: 'All',
		web: 'Web',
		database: 'Database',
		developer: 'Developer',
		agent: 'Agent',
	};

	const filteredGroups = $derived.by(() => {
		let result = groups;

		if (selectedCategory !== 'all') {
			result = result.filter(g => g.category === selectedCategory);
		}

		if (search.trim()) {
			const q = search.toLowerCase();
			result = result.filter(g =>
				g.label.toLowerCase().includes(q) ||
				g.description.toLowerCase().includes(q) ||
				g.tools.some(t =>
					t.name.toLowerCase().includes(q) ||
					t.title.toLowerCase().includes(q) ||
					t.description.toLowerCase().includes(q)
				)
			);
		}

		return result;
	});
</script>

<div class="flex flex-col gap-4 my-12">
	<h2 class="text-xl font-bold">Tools</h2>

	<!-- Search -->
	<input
		type="text"
		class="input input-bordered w-full"
		placeholder="Search tools..."
		bind:value={search}
	/>

	<!-- Category filter -->
	<div class="flex gap-2 flex-wrap">
		{#each categories as cat}
			<button
				class="btn btn-sm"
				class:btn-primary={selectedCategory === cat}
				class:btn-ghost={selectedCategory !== cat}
				onclick={() => selectedCategory = cat}
			>
				{categoryLabels[cat] || cat}
			</button>
		{/each}
	</div>

	<!-- Group cards -->
	<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
		{#each filteredGroups as group (group.id)}
			<ToolGroupCard {group} />
		{/each}
	</div>

	{#if filteredGroups.length === 0}
		<p class="text-center text-base-content/50 py-8">No tools match your search.</p>
	{/if}
</div>
