import Link from "next/link";
import type { ReactNode } from "react";
import { cx, idx } from "./cx";

export type Column<T> = {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
  /** Hide below the sm breakpoint to keep the table readable on phones. */
  hideOnMobile?: boolean;
};

/** Hairline table with uppercase index-label headers and an optional 01/02/03 index column. */
export function DataTable<T>({ columns, rows, rowKey, empty = "Nothing here yet.", onRowClickHref, numbered = true }: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  empty?: ReactNode;
  onRowClickHref?: (row: T) => string;
  numbered?: boolean;
}) {
  const span = columns.length + (numbered ? 1 : 0);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-full border-collapse text-left text-body-sm">
        <thead>
          <tr className="border-b border-line">
            {numbered && <th className="hidden w-12 py-3 pl-4 pr-2 sm:table-cell text-label font-medium uppercase text-faint sm:pl-5">No.</th>}
            {columns.map((c, i) => (
              <th key={c.key} className={cx("px-3 py-3 text-label font-medium uppercase text-muted", i === 0 && "pl-4 sm:pl-3", c.hideOnMobile && "hidden sm:table-cell", c.className)}>{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={span} className="px-5 py-10 text-center text-muted">{empty}</td>
            </tr>
          )}
          {rows.map((row, r) => (
            <tr key={rowKey(row)} className="border-b border-line transition-colors duration-150 last:border-0 hover:bg-stone/50">
              {numbered && <td className="hidden py-4 pl-4 pr-2 align-top sm:table-cell text-label font-medium text-faint tnum sm:pl-5"><span className="relative top-[3px]">{idx(r + 1)}</span></td>}
              {columns.map((c, i) => (
                <td key={c.key} className={cx("px-3 py-3.5 align-middle", i === 0 && "pl-4 sm:pl-3", c.hideOnMobile && "hidden sm:table-cell", c.className)}>
                  {i === 0 && onRowClickHref ? (
                    <Link href={onRowClickHref(row)} className="block hover:underline">{c.cell(row)}</Link>
                  ) : c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
