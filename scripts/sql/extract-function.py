#!/usr/bin/env python3
"""Print one `create or replace function public.<name>(...)` from a migration,
verbatim (header, dollar-quoted body, closing semicolon), so a rehearsal runs
the exact SQL production holds instead of a retyped copy.

    python3 -I scripts/sql/extract-function.py supabase/migrations/0163_x.sql grovshot_srv_scope

The LAST definition in the file wins (a file may redefine a function).
"""
import re
import sys


def extract(sql: str, name: str) -> str:
    pattern = re.compile(r"create\s+(?:or\s+replace\s+)?function\s+public\." + re.escape(name) + r"\s*\(", re.I)
    starts = [m.start() for m in pattern.finditer(sql)]
    if not starts:
        raise SystemExit(f"extract-function: {name} not found")
    start = starts[-1]
    open_tag = re.compile(r"\$([A-Za-z_]*)\$").search(sql, start)
    if not open_tag:
        raise SystemExit(f"extract-function: no body for {name}")
    tag = open_tag.group(0)
    close = sql.find(tag, open_tag.end())
    if close < 0:
        raise SystemExit(f"extract-function: unterminated body for {name}")
    end = sql.find(";", close + len(tag))
    return sql[start:end + 1]


if __name__ == "__main__":
    path, name = sys.argv[1], sys.argv[2]
    with open(path, encoding="utf-8") as f:
        print(extract(f.read(), name))
