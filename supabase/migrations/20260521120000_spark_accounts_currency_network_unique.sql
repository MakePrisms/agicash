-- Mirrors `cashu_accounts_user_currency_mint_url_unique` from the initial DB
-- migration: one spark account per (user, currency, network) tuple. Supports
-- the Spark USD (USDB) account work, where a single user may hold both a BTC
-- and a USD spark account on the same network but never two of the same kind.

create unique index "spark_accounts_user_currency_network_unique" on "wallet"."accounts" using "btree" ("user_id", "currency", (("details" ->> 'network'::"text"))) where ("type" = 'spark');
