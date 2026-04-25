-- Tighten the partial unique index on spark_send_quotes(user_id, payment_hash)
-- to also cover COMPLETED quotes. Previously only UNPAID and PENDING were
-- covered, which let a user create a fresh UNPAID quote for an invoice they
-- had already paid -- the second quote then hit Spark's AlreadyExists error
-- forever. FAILED stays excluded so a user can legitimately retry an invoice
-- whose previous attempt truly failed.

drop index if exists "wallet"."spark_send_quotes_payment_hash_active_unique";

create unique index "spark_send_quotes_payment_hash_active_unique"
  on "wallet"."spark_send_quotes" ("user_id", "payment_hash")
  where ("state" = any (array['UNPAID', 'PENDING', 'COMPLETED']::"wallet"."spark_send_quote_state"[]));
