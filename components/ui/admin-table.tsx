import { Card } from "./card";

export function AdminTable({ headers, rows, empty }: {
  headers: string[]; rows: React.ReactNode[][]; empty: string;
}) {
  if (rows.length === 0) {
    return <Card><p className="px-5 py-10 text-center text-sm text-muted">{empty}</p></Card>;
  }
  return (
    <Card className="max-h-[70dvh] overflow-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead className="sticky top-0 z-10">
          <tr className="border-b border-line bg-surface/95 text-left text-xs uppercase tracking-wide text-muted backdrop-blur">
            {headers.map((h) => <th key={h} className="px-5 py-3 font-medium">{h}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((cells, i) => (
            <tr key={i} className="transition-colors hover:bg-raised/60">
              {cells.map((c, j) => <td key={j} className="px-5 py-3">{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
