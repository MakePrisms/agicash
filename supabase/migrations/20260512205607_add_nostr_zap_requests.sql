-- NIP-57 zap request persistence
--
-- Stores nostr zap requests captured during LNURL-pay callback so we can
-- publish kind:9735 zap receipts after the invoice is paid. Survives the
-- daily cleanup of cashu_receive_quotes / spark_receive_quotes by living in
-- its own table.
--
-- quote_type discriminates between cashu_receive_quotes.id and
-- spark_receive_quotes.id; no FK because the source row may be GC'd before
-- publish or after.
--
-- paid_at_unix_sec is captured the first time the invoice is observed paid
-- and re-used on every publish attempt so the event id stays stable
-- across retries (NIP-57: created_at must be the invoice paid time).

create table if not exists "wallet"."nostr_zap_requests" (
  "id" "uuid" default "gen_random_uuid"() not null primary key,
  "quote_id" "uuid" not null,
  "quote_type" "text" not null check ("quote_type" in ('cashu', 'spark')),
  "payment_hash" "text" not null,
  "zap_request_json" "text" not null,
  "relays" "text"[] not null,
  "paid_at_unix_sec" bigint,
  "created_at" timestamp with time zone default "now"() not null,
  "last_attempt_at" timestamp with time zone,
  "published_at" timestamp with time zone,
  "publish_error" "text"
);

create unique index "nostr_zap_requests_quote_unique"
  on "wallet"."nostr_zap_requests" ("quote_id", "quote_type");

create index "nostr_zap_requests_unpublished"
  on "wallet"."nostr_zap_requests" ("published_at", "created_at")
  where "published_at" is null;

-- RLS: server-only table. Service role bypasses RLS; no client roles need access.
alter table "wallet"."nostr_zap_requests" enable row level security;

-- Daily cleanup of receipts older than 7 days, paired with existing GC cron jobs.
select cron.schedule('cleanup-nostr-zap-requests', '0 0 * * *', $$
  delete from wallet.nostr_zap_requests
  where created_at < now() - interval '7 days';
$$);
