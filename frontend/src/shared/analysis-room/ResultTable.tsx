export interface ResultTableProps {
  columns: string[];
  rows: Record<string, unknown>[];
  maxRows?: number;
  caption?: string;
  className?: string;
}

/** Host supplies theme classes and a business caption; values remain escaped text. */
export function ResultTable({ columns, rows, maxRows = 80, caption = '查询结果', className }: ResultTableProps) {
  if (!columns.length) return null;
  const limit = Math.max(1, Math.min(500, maxRows));
  return <div className={className} tabIndex={0} role="region" aria-label={caption}>
    <table><caption>{caption}</caption><thead><tr>
      {columns.map((column, index) => <th scope="col" key={`${index}:${column}`}>{column}</th>)}
    </tr></thead><tbody>
      {rows.slice(0, limit).map((row, index) => <tr key={String(row.__row_id ?? index)}>
        {columns.map((column, columnIndex) => <td key={`${columnIndex}:${column}`}>{row[column] == null ? '—' : String(row[column])}</td>)}
      </tr>)}
    </tbody></table>
    {!rows.length && <p>暂无返回记录</p>}
    {rows.length > limit && <p>仅展示前 {limit} 行，共 {rows.length} 行</p>}
  </div>;
}
