import JSZip from "jszip";
import * as XLSX from "xlsx";

/**
 * Small, valid Office files built in code for render tests: a workbook
 * with a column chart on one sheet, a two-slide deck and a one-page
 * document. SheetJS can't write charts, so the chart parts are added by
 * hand on top of a SheetJS workbook.
 */

const CONTENT_TYPES_NS =
  "http://schemas.openxmlformats.org/package/2006/content-types";
const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const OFFICE_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const DRAWING_NS =
  "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing";
const A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";
const C_NS = "http://schemas.openxmlformats.org/drawingml/2006/chart";
const P_NS = "http://schemas.openxmlformats.org/presentationml/2006/main";
const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function chartXml(sheet: string, rows: number): string {
  const last = rows + 1;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="${C_NS}" xmlns:a="${A_NS}" xmlns:r="${OFFICE_REL}"><c:chart>
<c:title><c:tx><c:rich><a:bodyPr/><a:p><a:r><a:t>Monthly revenue</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>
<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/>
<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>
<c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:strRef><c:f>${sheet}!$B$1</c:f></c:strRef></c:tx>
<c:cat><c:strRef><c:f>${sheet}!$A$2:$A$${last}</c:f></c:strRef></c:cat>
<c:val><c:numRef><c:f>${sheet}!$B$2:$B$${last}</c:f></c:numRef></c:val></c:ser>
<c:axId val="10"/><c:axId val="20"/></c:barChart>
<c:catAx><c:axId val="10"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="20"/></c:catAx>
<c:valAx><c:axId val="20"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:crossAx val="10"/></c:valAx>
</c:plotArea><c:legend><c:legendPos val="r"/></c:legend><c:plotVisOnly val="1"/></c:chart></c:chartSpace>`;
}

const DRAWING_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="${DRAWING_NS}" xmlns:a="${A_NS}"><xdr:twoCellAnchor>
<xdr:from><xdr:col>3</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
<xdr:to><xdr:col>11</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>18</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Chart 1"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>
<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>
<a:graphic><a:graphicData uri="${C_NS}"><c:chart xmlns:c="${C_NS}" xmlns:r="${OFFICE_REL}" r:id="rId1"/></a:graphicData></a:graphic>
</xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>`;

/**
 * Sheets: "Data" (rows of month/revenue, many pages when printed whole),
 * "Notes" (text, no drawing) and "Dashboard" (a chart over Data).
 */
export async function chartWorkbook(dataRows = 1200): Promise<Buffer> {
  const workbook = XLSX.utils.book_new();
  const data: Array<Array<string | number>> = [["month", "revenue"]];
  for (let row = 0; row < dataRows; row += 1) {
    data.push([`M${row + 1}`, 1000 + ((row * 37) % 500)]);
  }
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(data), "Data");
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([["Revenue grew in the second half."]]),
    "Notes",
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([["Dashboard"]]),
    "Dashboard",
  );
  const base = XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx",
  }) as Buffer;

  const zip = await JSZip.loadAsync(base);
  const sheetPath = "xl/worksheets/sheet3.xml";
  const sheet = (await zip.file(sheetPath)?.async("string")) ?? "";
  zip.file(
    sheetPath,
    sheet.replace("</worksheet>", '<drawing r:id="rId1"/></worksheet>'),
  );
  zip.file(
    "xl/worksheets/_rels/sheet3.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${OFFICE_REL}/drawing" Target="../drawings/drawing1.xml"/></Relationships>`,
  );
  zip.file("xl/drawings/drawing1.xml", DRAWING_XML);
  zip.file(
    "xl/drawings/_rels/drawing1.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${OFFICE_REL}/chart" Target="../charts/chart1.xml"/></Relationships>`,
  );
  zip.file("xl/charts/chart1.xml", chartXml("Data", dataRows));
  const types = (await zip.file("[Content_Types].xml")?.async("string")) ?? "";
  zip.file(
    "[Content_Types].xml",
    types.replace(
      "</Types>",
      '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/><Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/></Types>',
    ),
  );
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

/** A workbook with no drawing on any sheet. */
export function plainWorkbook(): Buffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["item", "qty"],
      ["apple", 3],
    ]),
    "Data",
  );
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function textBox(id: number, text: string, y: number): string {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Text ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="457200" y="${y}"/><a:ext cx="8229600" cy="1143000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="2800"/><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`;
}

const EMPTY_TREE = `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>`;

const THEME_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="${A_NS}" name="Plain"><a:themeElements>
<a:clrScheme name="Plain"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F497D"/></a:dk2><a:lt2><a:srgbClr val="EEECE1"/></a:lt2><a:accent1><a:srgbClr val="4F81BD"/></a:accent1><a:accent2><a:srgbClr val="C0504D"/></a:accent2><a:accent3><a:srgbClr val="9BBB59"/></a:accent3><a:accent4><a:srgbClr val="8064A2"/></a:accent4><a:accent5><a:srgbClr val="4BACC6"/></a:accent5><a:accent6><a:srgbClr val="F79646"/></a:accent6><a:hlink><a:srgbClr val="0000FF"/></a:hlink><a:folHlink><a:srgbClr val="800080"/></a:folHlink></a:clrScheme>
<a:fontScheme name="Plain"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>
<a:fmtScheme name="Plain"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
<a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>
</a:themeElements></a:theme>`;

/** A deck with one text slide per entry. */
export async function textDeck(slides: string[]): Promise<Buffer> {
  const zip = new JSZip();
  const ns = `xmlns:a="${A_NS}" xmlns:r="${OFFICE_REL}" xmlns:p="${P_NS}"`;
  const overrides = [
    `<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>`,
    `<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>`,
    `<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>`,
    `<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>`,
    ...slides.map(
      (_, index) =>
        `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
    ),
  ];
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="${CONTENT_TYPES_NS}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${overrides.join("")}</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${OFFICE_REL}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`,
  );
  const slideIds = slides
    .map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 3}"/>`)
    .join("");
  zip.file(
    "ppt/presentation.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation ${ns}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slideIds}</p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
  );
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${OFFICE_REL}/slideMaster" Target="slideMasters/slideMaster1.xml"/><Relationship Id="rId2" Type="${OFFICE_REL}/theme" Target="theme/theme1.xml"/>${slides
      .map(
        (_, index) =>
          `<Relationship Id="rId${index + 3}" Type="${OFFICE_REL}/slide" Target="slides/slide${index + 1}.xml"/>`,
      )
      .join("")}</Relationships>`,
  );
  zip.file(
    "ppt/slideMasters/slideMaster1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster ${ns}><p:cSld><p:spTree>${EMPTY_TREE}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`,
  );
  zip.file(
    "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${OFFICE_REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="${OFFICE_REL}/theme" Target="../theme/theme1.xml"/></Relationships>`,
  );
  zip.file(
    "ppt/slideLayouts/slideLayout1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout ${ns} type="blank"><p:cSld name="Blank"><p:spTree>${EMPTY_TREE}</p:spTree></p:cSld></p:sldLayout>`,
  );
  zip.file(
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${OFFICE_REL}/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`,
  );
  zip.file("ppt/theme/theme1.xml", THEME_XML);
  for (const [index, text] of slides.entries()) {
    zip.file(
      `ppt/slides/slide${index + 1}.xml`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld ${ns}><p:cSld><p:spTree>${EMPTY_TREE}${textBox(2, text, 2_286_000)}</p:spTree></p:cSld></p:sld>`,
    );
    zip.file(
      `ppt/slides/_rels/slide${index + 1}.xml.rels`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${OFFICE_REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`,
    );
  }
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

/** A one-paragraph-per-entry Word document. */
export async function textDocument(paragraphs: string[]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="${CONTENT_TYPES_NS}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${OFFICE_REL}/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W_NS}"><w:body>${paragraphs
      .map((text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`)
      .join("")}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
