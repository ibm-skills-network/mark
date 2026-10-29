import {
  decodeXmlEntities,
  openOfficeZip,
  parseRelationships,
} from "./zip-read";

/**
 * Chart summaries from xl/charts/*.xml: kind (column vs bar from barDir),
 * title, legend, axis titles, series names and ranges, and the sheet the
 * chart is drawn on. Regex over the XML: charts are small and regular.
 */

const CHART_KINDS: Record<string, string> = {
  bar: "bar",
  bar3D: "3-D bar",
  line: "line",
  line3D: "3-D line",
  pie: "pie",
  pie3D: "3-D pie",
  doughnut: "doughnut",
  area: "area",
  area3D: "3-D area",
  scatter: "scatter",
  radar: "radar",
  bubble: "bubble",
  stock: "stock",
  surface: "surface",
  surface3D: "3-D surface",
  ofPie: "pie-of-pie",
};

const CHART_ELEMENT =
  /<c:(bar|bar3D|line|line3D|pie|pie3D|doughnut|area|area3D|scatter|radar|bubble|stock|surface|surface3D|ofPie)Chart>([\S\s]*?)<\/c:\1Chart>/g;

function richText(fragment: string): string {
  const runs = [...fragment.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(
    (match) => match[1],
  );
  if (runs.length > 0) return decodeXmlEntities(runs.join("")).trim();
  const cached = [...fragment.matchAll(/<c:v>([^<]*)<\/c:v>/g)].map(
    (match) => match[1],
  );
  return decodeXmlEntities(cached.join(" ")).trim();
}

function block(fragment: string, tag: string): string | undefined {
  return new RegExp(`<c:${tag}>([\\S\\s]*?)</c:${tag}>`).exec(fragment)?.[1];
}

function formulaIn(fragment: string | undefined): string | undefined {
  if (!fragment) return undefined;
  return /<c:f>([^<]*)<\/c:f>/.exec(fragment)?.[1];
}

function chartKind(name: string, body: string): string {
  if (name === "bar" || name === "bar3D") {
    const direction = /<c:barDir val="(col|bar)"\/>/.exec(body)?.[1];
    const base = direction === "col" ? "column" : "bar";
    const kind = name === "bar3D" ? `3-D ${base}` : base;
    const grouping = /<c:grouping val="(\w+)"\/>/.exec(body)?.[1];
    return grouping && grouping !== "standard"
      ? `${kind} chart (${grouping})`
      : `${kind} chart`;
  }
  return `${CHART_KINDS[name] ?? name} chart`;
}

function axisTitle(xml: string, tag: string): string | undefined {
  const axis = block(xml, tag);
  if (axis === undefined) {
    return new RegExp(`<c:${tag}\\s*/>`).test(xml) ? "(none)" : undefined;
  }
  const title = block(axis, "title");
  return title ? richText(title) || "(none)" : "(none)";
}

export function describeChartXml(xml: string): string {
  const chart = block(xml, "chart") ?? xml;
  const plotArea = block(chart, "plotArea") ?? "";
  // The chart's own title sits in <c:chart> outside the plot area; axis
  // titles live inside it.
  const outside = chart.replace(plotArea, "");
  const titleBlock = block(outside, "title");
  const title = titleBlock ? richText(titleBlock) : "";

  const kinds: string[] = [];
  const series: string[] = [];
  for (const match of plotArea.matchAll(CHART_ELEMENT)) {
    kinds.push(chartKind(match[1], match[2]));
    for (const serMatch of match[2].matchAll(/<c:ser>([\S\s]*?)<\/c:ser>/g)) {
      const body = serMatch[1];
      const tx = block(body, "tx");
      const nameReference = formulaIn(tx);
      const name = tx ? richText(tx) : "";
      const categories = formulaIn(block(body, "cat") ?? block(body, "xVal"));
      const values = formulaIn(block(body, "val") ?? block(body, "yVal"));
      const label = name ? `"${name}"` : "(none)";
      series.push(
        `series ${series.length + 1}: name=${label}${nameReference ? ` (${nameReference})` : ""} categories=${categories ?? "(none)"} values=${values ?? "(none)"}`,
      );
    }
  }

  const legend =
    block(chart, "legend") ?? (/<c:legend\s*\/>/.test(chart) ? "" : undefined);
  const legendPosition = legend
    ? /<c:legendPos val="(\w+)"\/>/.exec(legend)?.[1]
    : undefined;
  const lines = [
    `type: ${kinds.length > 0 ? kinds.join(" + ") : "unknown"}`,
    `title: ${title || "(none)"}`,
    `legend: ${legend === undefined ? "no" : `yes${legendPosition ? ` (position ${legendPosition})` : ""}`}`,
  ];
  const categoryAxis =
    axisTitle(plotArea, "catAx") ?? axisTitle(plotArea, "dateAx");
  if (categoryAxis !== undefined)
    lines.push(`category axis title: ${categoryAxis}`);
  const valueAxes = [
    ...plotArea.matchAll(/<c:valAx>([\S\s]*?)<\/c:valAx>|<c:valAx\s*\/>()/g),
  ];
  for (const [index, axis] of valueAxes.entries()) {
    const titleText = block(axis[1] ?? "", "title");
    const label =
      valueAxes.length > 1
        ? `value axis ${index + 1} title`
        : "value axis title";
    lines.push(
      `${label}: ${titleText ? richText(titleText) || "(none)" : "(none)"}`,
    );
  }
  lines.push(...series);
  return lines.join("\n");
}

const MAX_CHARTS = 50;

function chartNumber(path: string): number {
  return Number(/chart(\d+)\.xml$/.exec(path)?.[1] ?? 0);
}

/** chart part path → name of the sheet whose drawing holds it. */
async function chartSheets(
  zip: Awaited<ReturnType<typeof openOfficeZip>>,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const workbook = await zip.text("xl/workbook.xml");
  const workbookRels = await zip.text("xl/_rels/workbook.xml.rels");
  if (!workbook || !workbookRels) return result;
  const rels = parseRelationships(workbookRels, "xl");
  for (const sheet of workbook.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const name = /\bname="([^"]*)"/.exec(sheet[1])?.[1];
    const id = /\br:id="([^"]*)"/.exec(sheet[1])?.[1];
    const sheetPath = id ? rels.get(id)?.target : undefined;
    if (!name || !sheetPath) continue;
    const folder = sheetPath.split("/").slice(0, -1).join("/");
    const file = sheetPath.split("/").pop() ?? "";
    const sheetRels = await zip.text(`${folder}/_rels/${file}.rels`);
    if (!sheetRels) continue;
    for (const drawing of parseRelationships(sheetRels, folder).values()) {
      if (!/drawing$/i.test(drawing.type)) continue;
      const drawingFolder = drawing.target.split("/").slice(0, -1).join("/");
      const drawingFile = drawing.target.split("/").pop() ?? "";
      const drawingRels = await zip.text(
        `${drawingFolder}/_rels/${drawingFile}.rels`,
      );
      if (!drawingRels) continue;
      for (const chart of parseRelationships(
        drawingRels,
        drawingFolder,
      ).values()) {
        if (/chart$/i.test(chart.type)) {
          result.set(chart.target, decodeXmlEntities(name));
        }
      }
    }
  }
  return result;
}

export async function describeWorkbookCharts(
  buffer: Buffer,
): Promise<string | undefined> {
  const zip = await openOfficeZip(buffer);
  const charts = zip.paths
    .filter((path) => /^xl\/charts\/chart\d+\.xml$/.test(path))
    .sort((a, b) => chartNumber(a) - chartNumber(b))
    .slice(0, MAX_CHARTS);
  if (charts.length === 0) return undefined;
  const sheets = await chartSheets(zip);
  const described: string[] = [];
  for (const path of charts) {
    const sheet = sheets.get(path);
    const heading = `chart ${chartNumber(path)} (${sheet ? `on sheet "${sheet}"` : "sheet unknown"})`;
    const xml = await zip.text(path);
    described.push(
      xml === undefined
        ? `${heading}\ntoo large to read`
        : `${heading}\n${describeChartXml(xml)}`,
    );
  }
  return described.join("\n\n");
}
