<script lang="ts">
	import { onMount } from 'svelte';

	interface Asset {
		name: string;
		browser_download_url: string;
	}

	interface Release {
		tag_name: string;
		assets: Asset[];
	}

	let release: Release | null = $state(null);
	let loaded = $state(false);

	const targets = [
		{ id: 'darwin-arm64', label: 'macOS', arch: 'Apple Silicon (arm64)', name: 'mcpy-darwin-arm64' },
		{ id: 'darwin-x64', label: 'macOS', arch: 'Intel (x64)', name: 'mcpy-darwin-x64' },
		{ id: 'linux-x64', label: 'Linux', arch: 'x64', name: 'mcpy-linux-x64' },
		{ id: 'linux-arm64', label: 'Linux', arch: 'arm64', name: 'mcpy-linux-arm64' },
	];

	onMount(async () => {
		try {
			const res = await fetch('https://api.github.com/repos/ebursztein/mcpy/releases/latest');
			if (res.ok) {
				release = await res.json();
			}
		} catch {
			// ignore
		}
		loaded = true;
	});

	function getDownloadUrl(assetName: string): string | null {
		if (!release) return null;
		const asset = release.assets.find(a => a.name === assetName);
		return asset?.browser_download_url || null;
	}
</script>

{#if loaded && release}
	<div class="my-12">
		<h2 class="text-xl font-bold mb-4">Manual Download</h2>
		<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
			{#each targets as target}
				{@const url = getDownloadUrl(target.name)}
				{#if url}
					<a
						href={url}
						class="card bg-base-200 shadow-sm hover:ring-1 hover:ring-primary/30 transition-all"
					>
						<div class="card-body p-4 flex-row items-center gap-3">
							<span class="font-semibold text-sm">{target.label}</span>
							<span class="text-xs text-base-content/50 font-mono">{target.arch}</span>
						</div>
					</a>
				{:else}
					<div class="card bg-base-200 opacity-30">
						<div class="card-body p-4 flex-row items-center gap-3">
							<span class="font-semibold text-sm">{target.label}</span>
							<span class="text-xs text-base-content/50 font-mono">{target.arch}</span>
						</div>
					</div>
				{/if}
			{/each}
		</div>
	</div>
{/if}
