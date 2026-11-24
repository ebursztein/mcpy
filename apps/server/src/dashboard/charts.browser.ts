/**
 * Browser bundle for the dashboard charts, never part of the Worker.
 * `npm run build -w @mcpy/server` bundles it with esbuild to
 * dist/public/dashboard/charts.js, which Cloudflare serves as a static asset
 * (wrangler.jsonc `assets`). As in deepmine (packages/ui echarts-mount), only
 * the pieces the pages use are registered, so the rest of ECharts never ships.
 * The page scripts read it as the global `echarts`.
 */

import * as echarts from "echarts/core";
import { BarChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { SVGRenderer } from "echarts/renderers";

echarts.use([BarChart, GridComponent, LegendComponent, TooltipComponent, SVGRenderer]);

Object.assign(globalThis, { echarts });
