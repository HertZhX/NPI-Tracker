import { useMemo } from "react";
import { PackagePlus, PencilLine, Trash2 } from "lucide-react";
import { calculateSelectWidth, productOptionLabel } from "../../components/layout/topbarSizing.js";

export function ProductSwitcher({
  products = [],
  currentProductId,
  onSelectProduct,
  onNewProduct,
  onRenameProduct,
  onDeleteProduct,
  canDeleteProduct = false,
}) {
  const selectStyle = useMemo(() => ({
    "--page-product-select-width": calculateSelectWidth(products.map(productOptionLabel), {
      minimum: 220,
      maximum: 420,
    }),
  }), [products]);

  return (
    <div className="page-product-switcher">
      <span className="page-product-switcher__label">当前产品</span>
      <label className="page-product-switcher__select" style={selectStyle}>
        <span className="sr-only">选择产品</span>
        <select value={currentProductId} onChange={(event) => onSelectProduct(event.target.value)}>
          {products.map((product) => (
            <option key={product.id} value={product.id}>{productOptionLabel(product)}</option>
          ))}
        </select>
      </label>
      {onNewProduct ? (
        <button
          className="icon-button page-product-switcher__create"
          type="button"
          onClick={onNewProduct}
          aria-label="向当前项目新增产品"
          title="新增产品"
        >
          <PackagePlus size={17} aria-hidden="true" />
        </button>
      ) : null}
      {onRenameProduct ? (
        <button
          className="icon-button page-product-switcher__rename"
          type="button"
          onClick={onRenameProduct}
          aria-label="重命名当前产品"
          title="重命名当前产品"
        >
          <PencilLine size={17} aria-hidden="true" />
        </button>
      ) : null}
      {onDeleteProduct ? (
        <button
          className="icon-button page-product-switcher__delete"
          type="button"
          onClick={onDeleteProduct}
          disabled={!canDeleteProduct}
          aria-label={canDeleteProduct ? "删除当前产品" : "项目至少需要保留一个产品"}
          title={canDeleteProduct ? "删除当前产品" : "项目至少需要保留一个产品"}
        >
          <Trash2 size={17} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

export default ProductSwitcher;
