import fs from "node:fs/promises";
import { parseNpiWorkbook } from "../src/services/excel.js";

const sourcePath = process.argv[2];
const bytes = await fs.readFile(sourcePath);
const result = await parseNpiWorkbook({
  name: "CL2636和2557项目进度推进表(1).xlsx",
  arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
});

const pfmea = result.definitions.find((definition) => definition.label === "PFMEA");
const byProject = Object.groupBy(result.materials, (material) => material.projectCode || "未识别");

if (result.definitions.length !== 18) throw new Error(`交付项数量错误：${result.definitions.length}`);
if (!pfmea) throw new Error("未将 PFM 映射为 PFMEA");
if ((byProject.CL2557?.length ?? 0) !== 7) throw new Error("CL2557 行数识别错误");
if ((byProject.CL2636?.length ?? 0) !== 1) throw new Error("CL2636 独立项目行识别错误");

console.log(JSON.stringify({
  sheetName: result.sheetName,
  projectCodeHint: result.projectCodeHint,
  definitionCount: result.definitions.length,
  pfmeaRole: pfmea.defaultRole,
  materialCount: result.materials.length,
  projectCounts: Object.fromEntries(Object.entries(byProject).map(([key, rows]) => [key, rows.length])),
  firstDueDate: result.materials[0].dueDate,
  warningCount: result.warnings.length,
}, null, 2));
