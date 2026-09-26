#!/usr/bin/env bash
#
# GROVNEWS STAGE 4 — THE PUBLIC SEO LAYER, PROVEN ON A REAL POSTGRES.
#
# Migrations 0119 (the premium posts, verbatim) and 0124 (the public articles,
# verbatim) are loaded next to the helpers they depend on, cut out of the
# migrations that ship them (is_admin, touch_updated_at from 0002). So a pass
# here is the SQL itself: who can read a draft, what a published article hands
# an anonymous visitor, what the sitemap lists — not a TypeScript retelling.
#
# Local harness only (DEV does not carry this schema; PROD gets a rolled-back
# dry run instead):
#
#   bash scripts/pg-harness-up.sh && npm run test:grovnews4:sql
set -euo pipefail

PGSOCK="${PGSOCK:-/tmp/pgtest}"
PGPORT="${PGPORT:-5433}"
DB=grovnews4
PSQL0=(psql -h "$PGSOCK" -p "$PGPORT" -U postgres -v ON_ERROR_STOP=1 -X -q -t -A)
PSQL=("${PSQL0[@]}" -d "$DB")

if ! "${PSQL0[@]}" -d postgres -c 'select 1' >/dev/null 2>&1; then
  echo "grovnews4-sql: no harness on $PGSOCK:$PGPORT — run: bash scripts/pg-harness-up.sh" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
M=$ROOT/supabase/migrations
MIGRATION="${MIGRATION:-$M/0124_grovnews_public_articles.sql}"
for f in "$MIGRATION" "$M/0002_functions_and_triggers.sql" "$M/0119_grovnews.sql"; do
  [ -f "$f" ] || { echo "grovnews4-sql: $f not found" >&2; exit 2; }
done

extract() { # file, function name, end marker regex
  awk -v start="^create (or replace )?function public[.]$2[(]" -v stop="$3" \
    '$0 ~ start {on=1} on {print} on && $0 ~ stop {exit}' "$1"
}
IS_ADMIN=$(extract "$M/0002_functions_and_triggers.sql" is_admin '^[$][$];')
TOUCH=$(extract "$M/0002_functions_and_triggers.sql" touch_updated_at '^[$][$];')
for v in IS_ADMIN TOUCH; do
  [ -n "${!v}" ] || { echo "grovnews4-sql: could not extract $v" >&2; exit 2; }
done

"${PSQL0[@]}" -d postgres -c "drop database if exists $DB" >/dev/null
"${PSQL0[@]}" -d postgres -c "create database $DB" >/dev/null

fails=0
check() { # name, actual, expected
  if [ "$2" = "$3" ]; then echo "  ✓ $1"
  else echo "  ✗ $1 — got [$2], expected [$3]"; fails=$((fails+1)); fi
}
q() { "${PSQL[@]}" -c "$1"; }
# As a signed-in account (RLS and grants apply), or as an anonymous visitor.
as_user() { "${PSQL[@]}" -c "set role authenticated; set request.jwt.claim.sub = '$1'; $2"; }
as_anon() { "${PSQL[@]}" -c "set role anon; set request.jwt.claim.sub = ''; $1"; }
err_as() { "${PSQL[@]}" -c "set role $1; set request.jwt.claim.sub = '${3:-}'; $2" 2>&1 \
  | grep -oE 'permission denied|violates row-level security|duplicate key|violates check constraint' | head -1 || true; }

"${PSQL[@]}" >/dev/null <<SQL
set check_function_bodies = off;
create schema auth; create schema t;
do \$\$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end \$\$;
grant usage on schema public, auth to anon, authenticated;
-- Supabase's default: new tables in public are granted to the client roles, so
-- the migration's own REVOKE is what is being tested.
alter default privileges in schema public grant all on tables to anon, authenticated;
create function auth.uid() returns uuid language sql stable as
  \$f\$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid \$f\$;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade, role text not null default 'user');

$IS_ADMIN
$TOUCH

create function t.usr(p_email text) returns uuid language plpgsql as \$f\$
declare v uuid; begin
  insert into auth.users (email) values (p_email) returning id into v;
  insert into public.profiles (id) values (v);
  return v; end \$f\$;
SQL

"${PSQL[@]}" -f "$M/0119_grovnews.sql" >/dev/null
"${PSQL[@]}" -f "$MIGRATION" >/dev/null

ADMIN=$(q "select t.usr('admin@x.pl')"); q "update public.profiles set role = 'admin' where id = '$ADMIN'" >/dev/null
CUST=$(q "select t.usr('customer@x.pl')")
SUB=$(q "select t.usr('subscriber@x.pl')")
q "insert into public.grovnews_entitlements (user_id) values ('$SUB')" >/dev/null
CAT=$(q "select id from public.grovnews_categories where slug = 'allegro'")
PREMIUM=$(q "insert into public.grovnews_posts (slug, title, excerpt, content, status, published_at, category_id)
  values ('allegro-premium', 'Allegro premium', 'PREMIUM-EXCERPT-51c9', 'PREMIUM-SECRET-7f3a full premium analysis', 'PUBLISHED', now() - interval '1 hour', '$CAT')
  returning id")

# Articles are written the way the admin screens write them: as the admin.
art() { # slug, status, extra columns, extra values
  as_user "$ADMIN" "insert into public.grovnews_public_articles (slug, title, excerpt, content, status, published_at, category_id${3:+, $3})
    values ('$1', 'Title $1', 'Lead $1', 'Body $1', '$2', case when '$2' = 'DRAFT' then null else now() - interval '10 minutes' end, '$CAT'${4:+, $4})
    returning id"
}

echo
echo "A. ADMIN"
PUB=$(art pub PUBLISHED "source_grovnews_post_id, internal_note, faq, sources" \
  "'$PREMIUM', 'INTERNAL-NOTE-0d2e: premium angle', '[{\"q\":\"Co się zmienia?\",\"a\":\"Opłaty.\"}]'::jsonb, '[{\"url\":\"https://allegro.pl/x\",\"title\":\"Allegro\"}]'::jsonb")
check "A1 an admin creates a public draft" "$(art draft1 DRAFT | grep -c .)" "1"
check "A2 an admin creates a public article from a GrovNews post (the link is kept)" \
  "$(q "select source_grovnews_post_id from public.grovnews_public_articles where id = '$PUB'")" "$PREMIUM"
check "A2b one premium post has at most ONE public version" \
  "$(err_as authenticated "insert into public.grovnews_public_articles (slug, title, source_grovnews_post_id) values ('second', 'Second', '$PREMIUM')" "$ADMIN")" "duplicate key"
check "A3 a customer cannot create a public article" \
  "$(err_as authenticated "insert into public.grovnews_public_articles (slug, title) values ('c', 'C')" "$CUST")" "violates row-level security"
check "A3b an entitled subscriber cannot either" \
  "$(err_as authenticated "insert into public.grovnews_public_articles (slug, title) values ('s', 'S')" "$SUB")" "violates row-level security"
check "A3c an anonymous visitor holds no privilege on the table at all" \
  "$(err_as anon "insert into public.grovnews_public_articles (slug, title) values ('a', 'A')")|$(err_as anon "select 1 from public.grovnews_public_articles")" \
  "permission denied|permission denied"
check "A3d a customer cannot publish (update) anything — zero rows touched" \
  "$(as_user "$CUST" "with u as (update public.grovnews_public_articles set status = 'PUBLISHED', published_at = now() returning 1) select count(*) from u")" "0"
D2=$(art draft2 DRAFT)
check "A4 publish works: the draft becomes readable by anyone" \
  "$(as_anon "select public.grovnews_public_article('draft2') is null")|$(as_user "$ADMIN" "update public.grovnews_public_articles set status = 'PUBLISHED', published_at = now() where id = '$D2'")$(as_anon "select public.grovnews_public_article('draft2')->>'title'")" \
  "t|Title draft2"
check "A5 unpublish (back to draft) takes it off the site at once" \
  "$(as_user "$ADMIN" "update public.grovnews_public_articles set status = 'DRAFT' where id = '$D2'")$(as_anon "select public.grovnews_public_article('draft2') is null")" "t"
check "A6 archive takes it off the site and out of the sitemap" \
  "$(as_user "$ADMIN" "update public.grovnews_public_articles set status = 'PUBLISHED' where id = '$D2'; update public.grovnews_public_articles set status = 'ARCHIVED' where id = '$D2'")$(as_anon "select public.grovnews_public_article('draft2') is null")|$(as_anon "select count(*) from public.grovnews_public_sitemap() where slug = 'draft2'")" \
  "t|0"
check "A7 only an admin reads a draft directly (the admin preview); customers and subscribers see no row" \
  "$(as_user "$ADMIN" "select count(*) from public.grovnews_public_articles where slug = 'draft1'")|$(as_user "$CUST" "select count(*) from public.grovnews_public_articles")|$(as_user "$SUB" "select count(*) from public.grovnews_public_articles")" \
  "1|0|0"
check "A8 PUBLISHED needs a publication date" \
  "$(err_as authenticated "update public.grovnews_public_articles set status = 'PUBLISHED', published_at = null where slug = 'draft1'" "$ADMIN")" "violates check constraint"
check "A9 cover and canonical are https only" \
  "$(err_as authenticated "update public.grovnews_public_articles set cover_url = 'http://x.pl/a.jpg' where slug = 'draft1'" "$ADMIN")|$(err_as authenticated "update public.grovnews_public_articles set canonical_url = 'javascript:alert(1)' where slug = 'draft1'" "$ADMIN")" \
  "violates check constraint|violates check constraint"

echo
echo "P. PUBLIC CONTENT"
check "P1 a PUBLISHED article is readable anonymously" "$(as_anon "select public.grovnews_public_article('pub')->>'title'")" "Title pub"
check "P2 a DRAFT is not" "$(as_anon "select public.grovnews_public_article('draft1') is null")" "t"
check "P3 an ARCHIVED article is not" "$(as_anon "select public.grovnews_public_article('draft2') is null")" "t"
art future PUBLISHED >/dev/null
q "update public.grovnews_public_articles set published_at = now() + interval '1 day' where slug = 'future'" >/dev/null
check "P3b a publication date in the future is not public yet (article, feed, sitemap)" \
  "$(as_anon "select public.grovnews_public_article('future') is null")|$(as_anon "select public.grovnews_public_feed(100)::text like '%\"future\"%'")|$(as_anon "select count(*) from public.grovnews_public_sitemap() where slug = 'future'")" \
  "t|f|0"
ALL=$(as_anon "select concat(public.grovnews_public_article('pub')::text, public.grovnews_public_feed(100)::text, (select string_agg(s::text, '') from public.grovnews_public_sitemap() s))")
check "P4 no premium content in anything public (article, feed, sitemap)" \
  "$(echo "$ALL" | grep -cE 'PREMIUM-SECRET-7f3a|PREMIUM-EXCERPT-51c9|allegro-premium' || true)" "0"
check "P5 no internal note in the public article" "$(echo "$ALL" | grep -c 'INTERNAL-NOTE-0d2e' || true)" "0"
check "P6 the article carries exactly the page's columns — no provenance, author, status or research" \
  "$(as_anon "select string_agg(k, ',' order by k) from jsonb_object_keys(public.grovnews_public_article('pub')) k")" \
  "canonical_url,category,content,cover_alt,cover_url,excerpt,faq,language,noindex,og_description,og_title,published_at,read_minutes,related_slugs,schema_type,seo_description,seo_title,slug,sources,tags,title,updated_at"
check "P6b a feed card carries only the card's columns" \
  "$(as_anon "select string_agg(k, ',' order by k) from jsonb_object_keys((select public.grovnews_public_feed(1)->0)) k")" \
  "category,cover_alt,cover_url,excerpt,language,published_at,read_minutes,slug,title"
check "P7 the slug is unique" \
  "$(err_as authenticated "insert into public.grovnews_public_articles (slug, title) values ('pub', 'Again')" "$ADMIN")" "duplicate key"
check "P7b and a malformed slug is refused" \
  "$(err_as authenticated "insert into public.grovnews_public_articles (slug, title) values ('Bad Slug', 'x')" "$ADMIN")" "violates check constraint"
check "P8 the premium post stays unreadable to anon and to a non-entitled customer (untouched 0119 RLS)" \
  "$(as_anon "select count(*) from public.grovnews_posts")|$(as_user "$CUST" "select count(*) from public.grovnews_posts")|$(as_user "$SUB" "select count(*) from public.grovnews_posts")" "0|0|1"
check "P9 the feed filters by category and hides an inactive one" \
  "$(as_anon "select jsonb_array_length(public.grovnews_public_feed(100, 'allegro'))")|$(as_anon "select jsonb_array_length(public.grovnews_public_feed(100, 'olx'))")|$(q "update public.grovnews_categories set is_active = false where slug = 'allegro'")$(as_anon "select jsonb_array_length(public.grovnews_public_feed(100, 'allegro'))")|$(as_anon "select public.grovnews_public_article('pub')->'category' = 'null'::jsonb")" \
  "1|0|0|t"
q "update public.grovnews_categories set is_active = true where slug = 'allegro'" >/dev/null
check "P10 the feed limit is clamped (0 → 1, 10000 → at most 100)" \
  "$(as_anon "select jsonb_array_length(public.grovnews_public_feed(0))")|$(as_anon "select jsonb_array_length(public.grovnews_public_feed(10000)) <= 100")" "1|t"
check "P11 every public function is SECURITY DEFINER with a pinned search_path" \
  "$(q "select count(*) from pg_proc where proname in ('grovnews_public_feed','grovnews_public_article','grovnews_public_sitemap') and prosecdef and proconfig::text like '%search_path=public%'")" "3"
check "P12 deleting the premium post keeps the public article (the link is cleared, nothing cascades)" \
  "$(q "delete from public.grovnews_posts where id = '$PREMIUM'")$(q "select count(*) || ':' || count(source_grovnews_post_id) from public.grovnews_public_articles where slug = 'pub'")" "1:0"

echo
echo "S. SITEMAP"
art hidden PUBLISHED "noindex" "true" >/dev/null
SITEMAP=$(as_anon "select string_agg(slug, ',' order by slug) from public.grovnews_public_sitemap()")
check "S1 a published article is in the sitemap" "$(echo ",$SITEMAP," | grep -c ',pub,')" "1"
check "S2 a draft is not" "$(echo ",$SITEMAP," | grep -c ',draft1,' || true)" "0"
check "S3 an archived article is not" "$(echo ",$SITEMAP," | grep -c ',draft2,' || true)" "0"
check "S4 no premium post appears as a public article" "$(echo ",$SITEMAP," | grep -c 'allegro-premium' || true)" "0"
check "S5 a noindex article is out of the sitemap but still readable (its page says noindex)" \
  "$(echo ",$SITEMAP," | grep -c ',hidden,' || true)|$(as_anon "select public.grovnews_public_article('hidden')->>'noindex'")" "0|true"
check "S6 the sitemap's lastmod is the later of edit and publication" \
  "$(as_anon "select last_modified from public.grovnews_public_sitemap() where slug = 'pub'")" \
  "$(q "select greatest(updated_at, published_at) from public.grovnews_public_articles where slug = 'pub'")"

echo
if [ "$fails" -gt 0 ]; then echo "grovnews4-sql: $fails FAILED"; exit 1; fi
echo "grovnews4-sql: all passed"
