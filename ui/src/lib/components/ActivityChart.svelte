<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import Chart from 'chart.js/auto';
	import { fetchTimeseries, type TimeseriesPoint } from '$lib/api';

	let canvas: HTMLCanvasElement;
	let chart: Chart | null = null;
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
		chart = createChart();
		updateChart();
		pollTimer = setInterval(async () => {
			timeseries = await fetchTimeseries();
			updateChart();
		}, 5000);
	});

	onDestroy(() => {
		if (pollTimer) clearInterval(pollTimer);
		chart?.destroy();
	});

	function updateChart() {
		if (!chart) return;
		const data = timeseries;

		if (data.length === 0) {
			chart.data.labels = [];
			chart.data.datasets = [];
			chart.update('none');
			return;
		}

		const BINS = 40;
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

		chart.data.labels = labels;
		chart.data.datasets = toolList.map((tool, i) => ({
			label: tool,
			data: stacked[tool],
			backgroundColor: colorFor(i) + 'D9',
			borderWidth: 0,
			borderRadius: 2,
		}));
		chart.update('none');
	}

	function createChart(): Chart {
		return new Chart(canvas, {
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
</script>

<div class="card bg-base-200 shadow">
	<div class="card-body p-4">
		<h3 class="text-xs font-semibold text-base-content/50 uppercase">Activity</h3>
		<div class="h-48">
			{#if timeseries.length === 0}
				<div class="flex items-center justify-center h-full text-base-content/20 text-sm">
					No activity yet
				</div>
			{:else}
				<canvas bind:this={canvas}></canvas>
			{/if}
		</div>
	</div>
</div>
