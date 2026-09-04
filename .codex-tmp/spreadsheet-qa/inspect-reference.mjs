import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const [sourcePath, previewPath] = process.argv.slice(2);
if (!sourcePath || !previewPath) {
  throw new Error("Usage: inspect-reference.mjs <source.xlsx> <preview.png>");
}

const input = await FileBlob.load(sourcePath);
const workbook = await SpreadsheetFile.importXlsx(input);

const overview = await workbook.inspect({
  kind: "workbook,sheet,table",
  maxChars: 4000,
  tableMaxRows: 8,
  tableMaxCols: 12,
  tableMaxCellChars: 80,
});
console.log("OVERVIEW");
console.log(overview.ndjson);

const sheet = workbook.worksheets.getItem("产品");
const cells = sheet.getRange("A1:Z12").values;
console.log("CELLS");
console.log(JSON.stringify(cells));

const styles = await workbook.inspect({
  kind: "computedStyle",
  sheetId: "产品",
  range: "A1:Z6",
  maxChars: 3000,
});
console.log("STYLES");
console.log(styles.ndjson);

const preview = await workbook.render({
  sheetName: "产品",
  range: "A1:Z12",
  scale: 1,
  format: "png",
});
await fs.writeFile(previewPath, new Uint8Array(await preview.arrayBuffer()));
console.log(`PREVIEW=${previewPath}`);
