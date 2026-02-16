<script>
	import '../app.css';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { fetchVersion } from '$lib/api';

	let { children } = $props();
	let versionInfo = $state(null);

	onMount(async () => {
		try {
			versionInfo = await fetchVersion();
		} catch {
			// API may not be available yet
		}
	});

	const navItems = [
		{ href: '/', label: 'Dashboard', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1' },
		{ href: '/tools', label: 'Tools', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z' },
		{ href: '/settings', label: 'Settings', icon: 'M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4' }
	];
</script>

<div class="drawer lg:drawer-open">
	<input id="sidebar-drawer" type="checkbox" class="drawer-toggle" />

	<div class="drawer-content flex flex-col">
		<!-- Mobile navbar -->
		<div class="navbar bg-base-200 lg:hidden">
			<div class="flex-none">
				<label for="sidebar-drawer" class="btn btn-square btn-ghost">
					<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="inline-block w-5 h-5 stroke-current">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"></path>
					</svg>
				</label>
			</div>
			<div class="flex-1">
				<span class="text-lg font-bold px-2">mcpy</span>
			</div>
		</div>

		<!-- Page content -->
		<main class="flex-1 p-4 lg:p-6 overflow-auto">
			{@render children()}
		</main>
	</div>

	<!-- Sidebar -->
	<div class="drawer-side z-40">
		<label for="sidebar-drawer" class="drawer-overlay"></label>
		<aside class="bg-base-200 w-64 min-h-full flex flex-col">
			<div class="p-4 border-b border-base-300">
				<h1 class="text-xl font-bold">mcpy</h1>
				<p class="text-xs text-base-content/60 mt-1">MCP Tool Server</p>
			</div>

			<ul class="menu p-4 gap-1 flex-1">
				{#each navItems as item}
					<li>
						<a
							href={item.href}
							class={page.url.pathname === item.href ? 'active' : ''}
						>
							<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d={item.icon} />
							</svg>
							{item.label}
						</a>
					</li>
				{/each}
			</ul>

			<div class="p-4 border-t border-base-300 text-xs text-base-content/40 flex items-center gap-2">
				{#if versionInfo}
					v{versionInfo.current}
					{#if versionInfo.updateAvailable}
						<a href="/settings" class="badge badge-warning badge-xs">update</a>
					{/if}
				{:else}
					mcpy
				{/if}
			</div>
		</aside>
	</div>
</div>
