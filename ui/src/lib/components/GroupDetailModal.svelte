<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import Chart from 'chart.js/auto';
	import {
		fetchTimeseries,
		fetchSettings,
		fetchTools,
		updateSettings,
		toggleTool,
		type GroupInfo,
		type ToolInfo,
		type ToolStats,
		type TimeseriesPoint,
		type Settings
	} from '$lib/api';
	import SettingsField from './SettingsField.svelte';

	let {
		group,
		tools,
		toolStats,
		onClose,
		onToolToggle,
		onToolsRefresh
	}: {
		group: GroupInfo;
		tools: ToolInfo[];
		toolStats: Record<string, ToolStats>;
		onClose: () => void;
		onToolToggle: (name: string, enabled: boolean) => void;
		onToolsRefresh: (tools: ToolInfo[]) => void;
	} = $props();

	let timeseries: TimeseriesPoint[] = $state([]);
	let settings: Settings | null = $state(null);
	let callsCanvas: HTMLCanvasElement;
	let latencyCanvas: HTMLCanvasElement;
	let callsChart: Chart | null = null;
	let latencyChart: Chart | null = null;
	let pollTimer: ReturnType<typeof setInterval> | null = null;

	const COLORS = [
		'#36d399', '#f59e42', '#38bdf8', '#f87171',
		'#a78bfa', '#fb923c', '#22d3ee', '#e879f9',
		'#facc15', '#4ade80', '#60a5fa', '#f472b6'
	];

	function colorFor(idx: number): string {
		return COLORS[idx % COLORS.length];
	}

	const groupTools = $derived(tools.filter(t => (t.group || t.name) === group.id));
	const toolNames = $derived(groupTools.map(t => t.name));
	const groupTimeseries = $derived(timeseries.filter(p => toolNames.includes(p.tool)));
	const callLog = $derived(
		groupTimeseries
			.slice()
			.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
			.slice(0, 50)
	);

	onMount(async () => {
		[timeseries, settings] = await Promise.all([fetchTimeseries(), fetchSettings()]);
		buildCharts();
		pollTimer = setInterval(async () => {
			timeseries = await fetchTimeseries();
			updateCharts();
		}, 5000);
	});

	onDestroy(() => {
		if (pollTimer) clearInterval(pollTimer);
		callsChart?.destroy();
		latencyChart?.destroy();
	});

	$effect(() => {
		if (groupTimeseries && callsChart && latencyChart) {
			updateCharts();
		}
	});

	function buildCharts() {
		if (!callsCanvas || !latencyCanvas) return;
		callsChart = createCallsChart();
		latencyChart = createLatencyChart();
	}

	function updateCharts() {
		if (!callsChart || !latencyChart) return;
		const data = groupTimeseries;
		const toolList = [...new Set(data.map(p => p.tool))];

		const BINS = 30;
		if (data.length === 0) {
			callsChart.data.labels = [];
			callsChart.data.datasets = [];
		} else {
			const times = data.map(p => new Date(p.timestamp).getTime());
			const minT = Math.min(...times);
			const maxT = Math.max(...times);
			const range = Math.max(maxT - minT, 1000);
			const binSize = range / BINS;

			const stacked: Record<string, number[]> = {};
			for (const t of toolList) stacked[t] = new Array(BINS).fill(0);
			for (const p of data) {
				const bin = Math.min(Math.floor((new Date(p.timestamp).getTime() - minT) / binSize), BINS - 1);
				stacked[p.tool][bin]++;
			}

			const labels = Array.from({ length: BINS }, (_, i) => {
				const t = new Date(minT + (i + 0.5) * binSize);
				return t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
			});

			callsChart.data.labels = labels;
			callsChart.data.datasets = toolList.map((tool, i) => ({
				label: tool,
				data: stacked[tool],
				backgroundColor: colorFor(i) + 'D9',
				borderWidth: 0,
				borderRadius: 2,
			}));
		}
		callsChart.update('none');

		if (data.length === 0) {
			latencyChart.data.datasets = [];
		} else {
			latencyChart.data.datasets = toolList.map((tool, i) => {
				const toolData = data
					.filter(p => p.tool === tool)
					.map(p => ({ x: new Date(p.timestamp).getTime(), y: p.duration }));
				return {
					label: tool,
					data: toolData,
					borderColor: colorFor(i),
					backgroundColor: colorFor(i) + '80',
					pointRadius: 3,
					pointHoverRadius: 5,
					borderWidth: 2,
					tension: 0.3,
					showLine: true,
					fill: false,
				};
			});
		}
		latencyChart.update('none');
	}

	function createCallsChart(): Chart {
		return new Chart(callsCanvas, {
			type: 'bar',
			data: { labels: [], datasets: [] },
			options: {
				responsive: true,
				maintainAspectRatio: false,
				animation: false,
				plugins: {
					legend: { display: false },
					tooltip: {
						mode: 'index',
						intersect: false,
						callbacks: {
							title: (items) => items[0]?.label || '',
							label: (item) => `${item.dataset.label}: ${item.raw} calls`,
						},
					},
				},
				scales: {
					x: {
						stacked: true,
						ticks: { maxTicksLimit: 5, font: { size: 10 }, color: 'rgba(255,255,255,0.3)' },
						grid: { display: false },
						border: { color: 'rgba(255,255,255,0.1)' },
					},
					y: {
						stacked: true,
						beginAtZero: true,
						ticks: {
							stepSize: 1,
							font: { size: 10 },
							color: 'rgba(255,255,255,0.3)',
							callback: (v) => Number.isInteger(v) ? v : '',
						},
						grid: { color: 'rgba(255,255,255,0.05)' },
						border: { color: 'rgba(255,255,255,0.1)' },
					},
				},
			},
		});
	}

	function createLatencyChart(): Chart {
		return new Chart(latencyCanvas, {
			type: 'scatter',
			data: { datasets: [] },
			options: {
				responsive: true,
				maintainAspectRatio: false,
				animation: false,
				plugins: {
					legend: { display: false },
					tooltip: {
						callbacks: {
							title: (items) => {
								const x = items[0]?.parsed?.x;
								return x ? new Date(x).toLocaleTimeString() : '';
							},
							label: (item) => `${item.dataset.label}: ${Math.round(item.parsed.y)}ms`,
						},
					},
				},
				scales: {
					x: {
						type: 'linear',
						ticks: {
							maxTicksLimit: 5,
							font: { size: 10 },
							color: 'rgba(255,255,255,0.3)',
							callback: (v) => new Date(v as number).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
						},
						grid: { display: false },
						border: { color: 'rgba(255,255,255,0.1)' },
					},
					y: {
						beginAtZero: true,
						ticks: {
							font: { size: 10 },
							color: 'rgba(255,255,255,0.3)',
							callback: (v) => v + 'ms',
						},
						grid: { color: 'rgba(255,255,255,0.05)' },
						border: { color: 'rgba(255,255,255,0.1)' },
					},
				},
			},
		});
	}

	function getSettingValueFromPath(path: string): string {
		if (!settings) return '';
		const parts = path.split('.');
		let current: unknown = settings;
		for (const part of parts) {
			if (current == null || typeof current !== 'object') return '';
			current = (current as Record<string, unknown>)[part];
		}
		return String(current || '');
	}

	async function saveSettingByPath(path: string, value: string) {
		const parts = path.split('.');
		const update: Record<string, unknown> = {};
		let current: Record<string, unknown> = update;
		for (let i = 0; i < parts.length - 1; i++) {
			current[parts[i]] = {};
			current = current[parts[i]] as Record<string, unknown>;
		}
		const lastPart = parts[parts.length - 1];
		current[lastPart] = lastPart === 'port' ? parseInt(value, 10) || 0 : value;
		settings = await updateSettings(update);
		const refreshed = await fetchTools();
		onToolsRefresh(refreshed);
	}

	let removing = $state(false);

	const isConfigured = $derived(
		(group.settingsFields ?? []).some(f => getSettingValueFromPath(f.key) !== '')
	);

	async function removeGroupConfig() {
		if (!group.settingsFields) return;
		removing = true;
		const update: Record<string, unknown> = {};
		for (const field of group.settingsFields) {
			const parts = field.key.split('.');
			let current: Record<string, unknown> = update;
			for (let i = 0; i < parts.length - 1; i++) {
				if (!current[parts[i]]) current[parts[i]] = {};
				current = current[parts[i]] as Record<string, unknown>;
			}
			current[parts[parts.length - 1]] = '';
		}
		settings = await updateSettings(update);
		const refreshed = await fetchTools();
		onToolsRefresh(refreshed);
		removing = false;
	}

	async function handleToggle(name: string, enabled: boolean) {
		await toggleTool(name, enabled);
		onToolToggle(name, enabled);
	}

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) onClose();
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
	}

	function formatTime(iso: string): string {
		return new Date(iso).toLocaleTimeString('en-US', { hour12: false });
	}

	function formatDuration(ms: number): string {
		if (ms < 1000) return Math.round(ms) + 'ms';
		return (ms / 1000).toFixed(1) + 's';
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onclick={handleBackdropClick}>
	<div class="bg-base-200 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
		<!-- Header -->
		<div class="flex items-center justify-between p-4 border-b border-base-300">
			<div class="flex items-center gap-2">
				<h3 class="text-lg font-bold">{group.label}</h3>
			</div>
			<button class="btn btn-ghost btn-sm btn-square" onclick={onClose} aria-label="Close">
				<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
				</svg>
			</button>
		</div>

		<div class="p-4 flex flex-col gap-4">
			<!-- Description + URL -->
			<p class="text-sm text-base-content/60">{group.description}</p>
			{#if group.url}
				<a href={group.url} target="_blank" rel="noopener" class="link link-primary text-xs w-fit">{group.url}</a>
			{/if}

			<!-- Configuration (above tools) -->
			{#if group.settingsFields && group.settingsFields.length > 0}
				<div>
					<div class="flex items-center justify-between mb-2">
						<span class="text-xs font-semibold text-base-content/50 uppercase">Configuration</span>
						{#if isConfigured}
							<button
								class="btn btn-xs btn-error btn-outline"
								onclick={removeGroupConfig}
								disabled={removing}
							>
								{#if removing}
									<span class="loading loading-spinner loading-xs"></span>
								{:else}
									Remove
								{/if}
							</button>
						{/if}
					</div>
					<div class="grid grid-cols-2 gap-3 p-3 bg-base-300/50 rounded-lg">
						{#each group.settingsFields as field}
							<div class={field.gridSpan === 2 ? 'col-span-2' : ''}>
								<SettingsField
									label={field.label}
									value={getSettingValueFromPath(field.key)}
									type={field.type === 'number' ? 'text' : field.type}
									placeholder={field.placeholder || ''}
									onSave={(v) => saveSettingByPath(field.key, v)}
								/>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Tools -->
			<div>
				<span class="text-xs font-semibold text-base-content/50 uppercase mb-2 block">Tools</span>
				<div class="space-y-2">
					{#each groupTools as tool}
						{@const ts = toolStats[tool.name]}
						<div class="flex items-start gap-3 py-1">
							<input
								type="checkbox"
								class="toggle toggle-sm toggle-primary mt-0.5"
								checked={tool.enabled}
								onchange={() => handleToggle(tool.name, !tool.enabled)}
							/>
							<div class="flex-1 min-w-0">
								<div class="flex items-center gap-2">
									<span class="text-sm" class:opacity-40={!tool.enabled}>{tool.title}</span>
									{#if ts && ts.totalCalls > 0}
										<span class="text-xs text-base-content/40 ml-auto">{ts.totalCalls} calls -- {Math.round(ts.avgDuration)}ms avg</span>
									{/if}
								</div>
								<p class="text-xs text-base-content/50 line-clamp-2">{tool.description}</p>
								{#if tool.missingSettings && tool.missingSettings.length > 0}
									<span class="text-warning text-xs">Missing: {tool.missingSettings.join(', ')}</span>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			</div>

			<!-- Charts -->
			<div class="flex flex-col gap-3">
				<div>
					<div class="flex items-center justify-between mb-1">
						<span class="text-xs font-semibold text-base-content/50 uppercase">Calls</span>
						<div class="flex items-center gap-3 flex-wrap">
							{#each [...new Set(groupTimeseries.map(p => p.tool))] as tool, i}
								<span class="flex items-center gap-1 text-xs text-base-content/50">
									<span class="w-2 h-2 rounded-full inline-block" style="background-color: {colorFor(i)}"></span>
									{tool}
								</span>
							{/each}
						</div>
					</div>
					<div class="h-32 bg-base-300 rounded">
						<canvas bind:this={callsCanvas}></canvas>
					</div>
				</div>
				<div>
					<span class="text-xs font-semibold text-base-content/50 uppercase mb-1 block">Latency</span>
					<div class="h-32 bg-base-300 rounded">
						<canvas bind:this={latencyCanvas}></canvas>
					</div>
				</div>
			</div>

			<!-- Call Log -->
			{#if callLog.length > 0}
				<div>
					<span class="text-xs font-semibold text-base-content/50 uppercase mb-2 block">Recent Calls</span>
					<div class="overflow-x-auto max-h-48 overflow-y-auto">
						<table class="table table-xs">
							<thead class="sticky top-0 bg-base-200">
								<tr class="text-xs text-base-content/40">
									<th>Time</th>
									<th>Tool</th>
									<th class="text-right">Duration</th>
									<th class="text-center">Status</th>
								</tr>
							</thead>
							<tbody>
								{#each callLog as entry}
									<tr class="hover:bg-base-300/30">
										<td class="font-mono text-base-content/50">{formatTime(entry.timestamp)}</td>
										<td class="font-medium">{entry.tool}</td>
										<td class="text-right font-mono">{formatDuration(entry.duration)}</td>
										<td class="text-center">
											{#if entry.success}
												<span class="badge badge-success badge-xs">ok</span>
											{:else}
												<span class="badge badge-error badge-xs">err</span>
											{/if}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</div>
			{/if}
		</div>
	</div>
</div>
