import {
  Download,
  RefreshCw,
  Search,
  Upload,
  X,
} from "lucide-react";
import { STATUS_META, STATUS_OPTIONS } from "../../domain/statuses.js";

function getOptionValue(option) {
  if (typeof option === "string") {
    return option;
  }

  return option?.value ?? option?.code ?? option?.id ?? "";
}

function getOptionLabel(option, value) {
  if (typeof option !== "string" && option?.label) {
    return option.label;
  }

  return STATUS_META[value]?.label ?? value;
}

export function FilterBar({
  search = "",
  onSearchChange,
  abnormalOnly = false,
  onAbnormalChange,
  myOnly = false,
  onMyOnlyChange,
  status = "all",
  onStatusChange,
  onImport,
  onExport,
  onRefresh,
}) {
  const selectedStatus = status || "all";

  return (
    <section className="filter-bar" aria-label="矩阵筛选与数据操作">
      <div className="filter-bar__filters">
        <div className="filter-bar__search" role="search">
          <Search aria-hidden="true" size={18} />
          <input
            type="search"
            value={search}
            onChange={(event) => onSearchChange?.(event.target.value)}
            placeholder="搜索物料编码、名称或任务"
            aria-label="搜索物料编码、名称或任务"
            autoComplete="off"
          />
          {search ? (
            <button
              className="filter-bar__clear-search"
              type="button"
              onClick={() => onSearchChange?.("")}
              aria-label="清除搜索"
              title="清除搜索"
            >
              <X aria-hidden="true" size={16} />
            </button>
          ) : null}
        </div>

        <label className="filter-bar__toggle">
          <input
            className="filter-bar__toggle-input"
            type="checkbox"
            checked={Boolean(abnormalOnly)}
            onChange={(event) => onAbnormalChange?.(event.target.checked)}
          />
          <span className="filter-bar__toggle-control" aria-hidden="true" />
          <span>只看异常</span>
        </label>

        <label className="filter-bar__toggle">
          <input
            className="filter-bar__toggle-input"
            type="checkbox"
            checked={Boolean(myOnly)}
            onChange={(event) => onMyOnlyChange?.(event.target.checked)}
          />
          <span className="filter-bar__toggle-control" aria-hidden="true" />
          <span>我的任务</span>
        </label>

        <label className="filter-bar__status-filter">
          <span className="sr-only">按任务状态筛选</span>
          <select
            value={selectedStatus}
            onChange={(event) => onStatusChange?.(event.target.value)}
            aria-label="按任务状态筛选"
          >
            <option value="all">全部状态</option>
            {STATUS_OPTIONS.map((option) => {
              const value = getOptionValue(option);

              return (
                <option key={value} value={value}>
                  {getOptionLabel(option, value)}
                </option>
              );
            })}
          </select>
        </label>
      </div>

      <div className="filter-bar__actions" role="group" aria-label="数据操作">
        <button
          className="filter-bar__action"
          type="button"
          onClick={onRefresh}
          aria-label="刷新矩阵"
          title="刷新矩阵"
        >
          <RefreshCw aria-hidden="true" size={18} />
          <span className="sr-only">刷新</span>
        </button>
        {onImport ? (
          <button
            className="filter-bar__action"
            type="button"
            onClick={onImport}
            aria-label="导入数据"
            title="导入数据"
          >
            <Upload aria-hidden="true" size={18} />
            <span className="sr-only">导入</span>
          </button>
        ) : null}
        {onExport ? (
          <button
            className="filter-bar__action"
            type="button"
            onClick={onExport}
            aria-label="导出数据"
            title="导出数据"
          >
            <Download aria-hidden="true" size={18} />
            <span className="sr-only">导出</span>
          </button>
        ) : null}
      </div>
    </section>
  );
}

export default FilterBar;
