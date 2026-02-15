<script lang="ts">
	import { tick } from 'svelte';
	import type { McpEvent } from '$lib/events';

	let { events, paused, onTogglePause, onClear }: {
		events: McpEvent[];
		paused: boolean;
		onTogglePause: () => void;
		onClear: () => void;
	} = $props();

	let container: HTMLElement;
	let autoScroll = $state(true);

	const categoryColors: Record<string, string> = {
		web: 'badge-ghost',
		database: 'badge-ghost',
		developer: 'badge-ghost',
		debug: 'badge-ghost',
		agent: 'badge-ghost'
	};

	const typeIcons: Record<string, string> = {
		tool_call: '>>',
		tool_result: 'ok',
		tool_error: '!!',
		session_connect: '++',
		session_disconnect: '--',
		server_start: '**'
	};

	function formatTime(iso: string): string {
		return new Date(iso).toLocaleTimeString('en-US', { hour12: false });
	}

	function truncateInput(input: unknown): string {
		if (!input) return '';
		const str = JSON.stringify(input);
		return str.length > 80 ? str.slice(0, 80) + '...' : str;
	}

	function eventClass(type: string): string {
		if (type === 'tool_error') return 'text-error';
		if (type === 'tool_result') return 'text-success';
		if (type === 'tool_call') return 'opacity-50';
		return '';
	}

	function handleScroll() {
		if (!container) return;
		const { scrollTop, scrollHeight, clientHeight } = container;
		autoScroll = scrollHeight - scrollTop - clientHeight < 50;
	}

	$effect(() => {
		if (events.length && autoScroll && container) {
			tick().then(() => {
				container.scrollTop = container.scrollHeight;
			});
		}
	});
</script>

<div class="card bg-base-200 shadow">
	<div class="card-body p-4">
		<div class="flex items-center gap-2">
			<h3 class="card-title text-sm flex-1">Activity Log</h3>
			<span class="text-xs text-base-content/40">{events.length} events</span>
			<button class="btn btn-xs btn-ghost" onclick={onTogglePause}>
				{paused ? 'Resume' : 'Pause'}
			</button>
			<button class="btn btn-xs btn-ghost" onclick={onClear}>Clear</button>
		</div>

		<div
			bind:this={container}
			onscroll={handleScroll}
			class="font-mono text-xs bg-base-300 rounded-lg p-3 h-80 overflow-y-auto space-y-0.5"
		>
			{#if events.length === 0}
				<p class="text-base-content/30">Waiting for events...</p>
			{/if}
			{#each events as event}
				<div class="flex gap-2 leading-relaxed {eventClass(event.type)}">
					<span class="text-base-content/40 shrink-0">{formatTime(event.timestamp)}</span>
					<span class="shrink-0 w-5 text-center">{typeIcons[event.type] || '  '}</span>
					{#if event.category}
						<span class="badge {categoryColors[event.category] || 'badge-ghost'} badge-xs shrink-0 mt-0.5"></span>
					{/if}
					{#if event.tool}
						<span class="font-semibold shrink-0">{event.tool}</span>
					{/if}
					{#if event.type === 'tool_call' && event.input}
						<span class="text-base-content/40 truncate">{truncateInput(event.input)}</span>
					{/if}
					{#if event.duration != null}
						<span class="text-base-content/30 ml-auto shrink-0">{event.duration}ms</span>
					{/if}
					{#if event.error}
						<span class="text-error truncate">{event.error}</span>
					{/if}
					{#if event.type === 'session_connect'}
						<span class="text-info">client connected{event.clientName ? `: ${event.clientName}` : ''}</span>
					{/if}
					{#if event.type === 'session_disconnect'}
						<span class="text-warning">client disconnected</span>
					{/if}
					{#if event.type === 'server_start'}
						<span class="text-success">server started</span>
					{/if}
				</div>
			{/each}
		</div>
	</div>
</div>
