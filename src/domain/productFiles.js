export const PRODUCT_FILE_SCOPE = "product-file";

export function isProductFileRecord(record) {
  return record?.trackingScope === PRODUCT_FILE_SCOPE;
}
