import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const [sourcePath, previewPath] = process.argv.slice(2);
if (!sourcePath || !previewPath) {
  throw new Error("Usage: inspect-bom.mjs <source.xlsx> <preview.png>");
}

const input = await FileBlob.load(sourcePath);
const workbook = await SpreadsheetFile.importXlsx(input);

const overview = await workbook.inspect({
  kind: "workbook,sheet,table",
  maxChars: 6000,
  tableMaxRows: 10,
  tableMaxCols: 16,
  tableMaxCellChars: 100,
});
console.log("OVERVIEW");
console.log(overview.ndjson);

const parsedPreviewPath = path.parse(previewPath);
for (const sheetName of ["变更明细", "客户BOM", "厂内BOM"]) {
  const sheet = workbook.worksheets.getItem(sheetName);
  const values = sheet.getUsedRange().values;
  const materialRows = values.filter((row, index) => index >= 4 && row[1]);
  console.log(`SHEET=${sheetName}`);
  console.log(JSON.stringify({
    rowCount: values.length,
    columnCount: Math.max(...values.map((row) => row.length)),
    titleRows: values.slice(0, 3),
    headers: values[3] ?? [],
    materialCount: materialRows.length,
    firstMaterials: materialRows.slice(0, 3),
    lastMaterials: materialRows.slice(-3),
  }));

  const styles = await workbook.inspect({
    kind: "computedStyle",
    sheetId: sheetName,
    range: sheetName === "变更明细" ? "A1:G11" : "A1:T8",
    maxChars: 2400,
  });
  console.log(`STYLES_${sheetName}`);
  console.log(styles.ndjson);

  const preview = await workbook.render({
    sheetName,
    autoCrop: "all",
    scale: sheetName === "变更明细" ? 0.8 : 0.45,
    format: "png",
  });
  const sheetPreviewPath = path.join(
    parsedPreviewPath.dir,
    `${parsedPreviewPath.name}-${sheetName}${parsedPreviewPath.ext}`,
  );
  await fs.writeFile(sheetPreviewPath, new Uint8Array(await preview.arrayBuffer()));
  console.log(`PREVIEW_${sheetName}=${sheetPreviewPath}`);
}
