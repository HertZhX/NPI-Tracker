function textWidthUnits(value) {
  return [...String(value || "")].reduce((units, character) => (
    units + (/^[\u0000-\u00FF]$/.test(character) ? 1 : 1.75)
  ), 0);
}

export function projectOptionLabel(project) {
  const code = String(project?.code || "").trim();
  const name = String(project?.name || "").trim();
  return name || code;
}

export function productOptionLabel(product) {
  const partNumber = String(product?.partNumber || "").trim();
  const name = String(product?.name || "").trim();
  return partNumber ? `${partNumber} · ${name}` : name;
}

export function calculateSelectWidth(values, { minimum, maximum }) {
  const units = values.reduce((largest, value) => Math.max(largest, textWidthUnits(value)), 0);
  return `${Math.min(maximum, Math.max(minimum, Math.ceil(76 + units * 10)))}px`;
}
