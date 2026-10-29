import JSZip from "jszip";
import { describeChartXml, describeWorkbookCharts } from "./xlsx-charts";

const columnChart = `<c:chartSpace><c:chart>
<c:title><c:tx><c:rich><a:p><a:r><a:t>Monthly sales</a:t></a:r></a:p></c:rich></c:tx></c:title>
<c:autoTitleDeleted val="0"/>
<c:plotArea><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/>
<c:ser><c:idx val="0"/><c:tx><c:strRef><c:f>Data!$B$1</c:f><c:strCache><c:pt idx="0"><c:v>Revenue</c:v></c:pt></c:strCache></c:strRef></c:tx>
<c:cat><c:strRef><c:f>Data!$A$2:$A$13</c:f></c:strRef></c:cat>
<c:val><c:numRef><c:f>Data!$B$2:$B$13</c:f></c:numRef></c:val></c:ser>
<c:ser><c:idx val="1"/><c:tx><c:strRef><c:f>Data!$C$1</c:f><c:strCache><c:pt idx="0"><c:v>Cost</c:v></c:pt></c:strCache></c:strRef></c:tx>
<c:val><c:numRef><c:f>Data!$C$2:$C$13</c:f></c:numRef></c:val></c:ser>
</c:barChart>
<c:catAx><c:axId val="1"/><c:title><c:tx><c:rich><a:p><a:r><a:t>Month</a:t></a:r></a:p></c:rich></c:tx></c:title></c:catAx>
<c:valAx><c:axId val="2"/><c:title><c:tx><c:rich><a:p><a:r><a:t>USD</a:t></a:r></a:p></c:rich></c:tx></c:title></c:valAx>
</c:plotArea>
<c:legend><c:legendPos val="r"/></c:legend>
</c:chart></c:chartSpace>`;

const barChartNoLegend = `<c:chartSpace><c:chart><c:autoTitleDeleted val="1"/>
<c:plotArea><c:barChart><c:barDir val="bar"/>
<c:ser><c:tx><c:v>Score</c:v></c:tx><c:val><c:numRef><c:f>Sheet1!$B$2:$B$5</c:f></c:numRef></c:val></c:ser>
</c:barChart><c:catAx/><c:valAx/></c:plotArea></c:chart></c:chartSpace>`;

describe("describeChartXml", () => {
  it("calls a barDir=col bar chart a column chart, with title, axes, legend and series", () => {
    const text = describeChartXml(columnChart);
    expect(text).toContain("type: column chart (clustered)");
    expect(text).toContain("title: Monthly sales");
    expect(text).toContain("legend: yes (position r)");
    expect(text).toContain("category axis title: Month");
    expect(text).toContain("value axis title: USD");
    expect(text).toContain(
      'series 1: name="Revenue" (Data!$B$1) categories=Data!$A$2:$A$13 values=Data!$B$2:$B$13',
    );
    expect(text).toContain('series 2: name="Cost" (Data!$C$1)');
    expect(text.split("\n")[1]).toBe("title: Monthly sales");
  });

  it("calls a barDir=bar chart a bar chart and reports a missing legend and title", () => {
    const text = describeChartXml(barChartNoLegend);
    expect(text).toContain("type: bar chart");
    expect(text).not.toContain("column");
    expect(text).toContain("title: (none)");
    expect(text).toContain("legend: no");
    expect(text).toContain("category axis title: (none)");
    expect(text).toContain('series 1: name="Score"');
  });

  it("names other chart kinds", () => {
    expect(
      describeChartXml(
        "<c:chart><c:plotArea><c:pieChart></c:pieChart></c:plotArea></c:chart>",
      ),
    ).toContain("type: pie chart");
    expect(
      describeChartXml(
        '<c:chart><c:plotArea><c:lineChart></c:lineChart><c:barChart><c:barDir val="col"/></c:barChart></c:plotArea></c:chart>',
      ),
    ).toContain("type: line chart + column chart");
  });
});

describe("describeWorkbookCharts", () => {
  it("reports the sheet each chart is anchored on", async () => {
    const zip = new JSZip();
    zip.file(
      "xl/workbook.xml",
      `<workbook><sheets><sheet name="Data" sheetId="1" r:id="rId1"/><sheet name="Dashboard" sheetId="2" r:id="rId2"/></sheets></workbook>`,
    );
    zip.file(
      "xl/_rels/workbook.xml.rels",
      `<Relationships><Relationship Id="rId1" Type="x/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="x/worksheet" Target="/xl/worksheets/sheet2.xml"/></Relationships>`,
    );
    zip.file(
      "xl/worksheets/_rels/sheet2.xml.rels",
      `<Relationships><Relationship Id="rId1" Type="x/drawing" Target="../drawings/drawing1.xml"/></Relationships>`,
    );
    zip.file(
      "xl/drawings/_rels/drawing1.xml.rels",
      `<Relationships><Relationship Id="rId1" Type="x/chart" Target="../charts/chart1.xml"/></Relationships>`,
    );
    zip.file("xl/charts/chart1.xml", columnChart);
    zip.file("xl/charts/chart2.xml", barChartNoLegend);
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    const text = await describeWorkbookCharts(buffer);
    expect(text).toContain(
      'chart 1 (on sheet "Dashboard")\ntype: column chart',
    );
    expect(text).toContain("chart 2 (sheet unknown)\ntype: bar chart");
  });

  it("returns undefined for a workbook without charts", async () => {
    const zip = new JSZip();
    zip.file("xl/workbook.xml", "<workbook/>");
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    await expect(describeWorkbookCharts(buffer)).resolves.toBeUndefined();
  });
});
