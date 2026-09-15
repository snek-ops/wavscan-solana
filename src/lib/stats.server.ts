import { getSql } from "@/lib/db";

export async function bumpScanCount(): Promise<number> {
  const sql = await getSql();
  const rows = await sql<{ count: number }>`
    insert into scan_stats (id, count) values ('global', 1)
    on conflict (id) do update set count = scan_stats.count + 1
    returning count
  `;
  return Number(rows[0]?.count ?? 0);
}

export async function readScanCount(): Promise<number> {
  const sql = await getSql();
  const rows = await sql<{ count: number }>`
    select count from scan_stats where id = 'global'
  `;
  return Number(rows[0]?.count ?? 0);
}
