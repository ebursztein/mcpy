<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte';
	import Chart from 'chart.js/auto';
	import { fetchTimeseries, type TimeseriesPoint } from '$lib/api';

	let activityCanvas: HTMLCanvasElement;
	let latencyCanvas: HTMLCanvasElement;
	let activityChart: Chart | null = null;
	let latencyChart: Chart | null = null;
	let timeseries: TimeseriesPoint[] = $state([]);
	let pollTimer: ReturnType<typeof setInterval> | null = null;

	const COLORS = [
		'#36d399', '#f59e42', '#38bdf8', '#f87171',
		'#a78bfa', '#fb923c', '#22d3ee', '#e879f9',
		'#facc15', '#4ade80', '#60a5fa', '#f472b6'
	];

	function colorFor(idx: number): string {
		return COLORS[idx % COLORS.length];
	}

	onMount(async () => {
		timeseries = await fetchTimeseries();
		await tick(); // wait for Svelte to render canvas elements
		if (activityCanvas) activityChart = createActivityChart();
		if (latencyCanvas) latencyChart = createLatencyChart();
		updateCharts();
		pollTimer = setInterval(async () => {
			timeseries = await fetchTimeseries();
			updateCharts();
		}, 5000);
	});

	onDestroy(() => {
		if (pollTimer) clearInterval(pollTimer);
		activityChart?.destroy();
		latencyChart?.destroy();
	});

	function updateCharts() {
		updateActivityChart();
		updateLatencyChart();
	}

	function updateActivityChart() {
		if (!activityChart) return;
		const data = timeseries;

		if (data.length === 0) {
			activityChart.data.labels = [];
			activityChart.data.datasets = [];
			activityChart.update('none');
			return;
		}

		const BINS = 30;
		const times = data.map(p => new Date(p.timestamp).getTime());
		const minT = Math.min(...times);
		const maxT = Math.max(...times);
		const range = Math.max(maxT - minT, 1000);
		const binSize = range / BINS;

		const toolList = [...new Set(data.map(p => p.tool))];
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

		activityChart.data.labels = labels;
		activityChart.data.datasets = toolList.map((tool, i) => ({
			label: tool,
			data: stacked[tool],
			backgroundColor: colorFor(i) + 'D9',
			borderWidth: 0,
			borderRadius: 2,
		}));
		activityChart.update('none');
	}

	function updateLatencyChart() {
		if (!latencyChart) return;
		const data = timeseries;

		if (data.length === 0) {
			latencyChart.data.labels = [];
			latencyChart.data.datasets = [];
			latencyChart.update('none');
			return;
		}

		// Group by tool, plot each call as a point: x = time, y = duration
		const toolList = [...new Set(data.map(p => p.tool))];
		const times = data.map(p => new Date(p.timestamp).getTime());
		const minT = Math.min(...times);
		const maxT = Math.max(...times);

		// Use scatter chart data format
		latencyChart.data.datasets = toolList.map((tool, i) => {
			const points = data
				.filter(p => p.tool === tool)
				.map(p => ({
					x: new Date(p.timestamp).getTime(),
					y: p.duration,
				}));
			return {
				label: tool,
				data: points,
				backgroundColor: colorFor(i) + 'B3',
				borderColor: colorFor(i),
				borderWidth: 1,
				pointRadius: 3,
				pointHoverRadius: 5,
			};
		});

		// Update x scale bounds
		const xScale = latencyChart.options.scales?.x;
		if (xScale) {
			(xScale as any).min = minT;
			(xScale as any).max = maxT;
		}

		latencyChart.update('none');
	}

	function createActivityChart(): Chart {
		return new Chart(activityCanvas, {
			type: 'bar',
			data: { labels: [], datasets: [] },
			options: {
				responsive: true,
				maintainAspectRatio: false,
				animation: false,
				plugins: {
					legend: {
						display: true,
						position: 'bottom',
						labels: {
							boxWidth: 8,
							boxHeight: 8,
							usePointStyle: true,
							pointStyle: 'circle',
							font: { size: 10 },
							color: 'rgba(255,255,255,0.5)',
							padding: 12,
						},
					},
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
						ticks: { maxTicksLimit: 6, font: { size: 10 }, color: 'rgba(255,255,255,0.3)' },
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
					legend: {
						display: true,
						position: 'bottom',
						labels: {
							boxWidth: 8,
							boxHeight: 8,
							usePointStyle: true,
							pointStyle: 'circle',
							font: { size: 10 },
							color: 'rgba(255,255,255,0.5)',
							padding: 12,
						},
					},
					tooltip: {
						callbacks: {
							title: (items) => {
								if (!items[0]) return '';
								const raw = items[0].raw as { x: number; y: number };
								return new Date(raw.x).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
							},
							label: (item) => {
								const raw = item.raw as { x: number; y: number };
								const ms = raw.y;
								const formatted = ms < 1000 ? Math.round(ms) + 'ms' : (ms / 1000).toFixed(2) + 's';
								return `${item.dataset.label}: ${formatted}`;
							},
						},
					},
				},
				scales: {
					x: {
						type: 'linear',
						ticks: {
							maxTicksLimit: 6,
							font: { size: 10 },
							color: 'rgba(255,255,255,0.3)',
							callback: (v) => new Date(v as number).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
						},
						grid: { display: false },
						border: { color: 'rgba(255,255,255,0.1)' },
					},
					y: {
						beginAtZero: true,
						title: {
							display: true,
							text: 'ms',
							font: { size: 10 },
							color: 'rgba(255,255,255,0.3)',
						},
						ticks: {
							font: { size: 10 },
							color: 'rgba(255,255,255,0.3)',
							callback: (v) => {
								const ms = v as number;
								if (ms < 1000) return Math.round(ms) + '';
								return (ms / 1000).toFixed(1) + 's';
							},
						},
						grid: { color: 'rgba(255,255,255,0.05)' },
						border: { color: 'rgba(255,255,255,0.1)' },
					},
				},
			},
		});
	}
</script>

<div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
	<div class="card bg-base-200 shadow">
		<div class="card-body p-4">
			<h3 class="text-xs font-semibold text-base-content/50 uppercase">Activity</h3>
			<div class="h-48">
				{#if timeseries.length === 0}
					<div class="flex items-center justify-center h-full text-base-content/20 text-sm">
						No activity yet
					</div>
				{:else}
					<canvas bind:this={activityCanvas}></canvas>
				{/if}
			</div>
		</div>
	</div>

	<div class="card bg-base-200 shadow">
		<div class="card-body p-4">
			<h3 class="text-xs font-semibold text-base-content/50 uppercase">Latency</h3>
			<div class="h-48">
				{#if timeseries.length === 0}
					<div class="flex items-center justify-center h-full text-base-content/20 text-sm">
						No activity yet
					</div>
				{:else}
					<canvas bind:this={latencyCanvas}></canvas>
				{/if}
			</div>
		</div>
	</div>
</div>
