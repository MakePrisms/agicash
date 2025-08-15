CREATE UNIQUE INDEX cashu_receive_quotes_quote_id_key ON wallet.cashu_receive_quotes USING btree (quote_id);

CREATE UNIQUE INDEX cashu_send_quotes_quote_id_key ON wallet.cashu_send_quotes USING btree (quote_id);

alter table "wallet"."cashu_receive_quotes" add constraint "cashu_receive_quotes_quote_id_key" UNIQUE using index "cashu_receive_quotes_quote_id_key";

alter table "wallet"."cashu_send_quotes" add constraint "cashu_send_quotes_quote_id_key" UNIQUE using index "cashu_send_quotes_quote_id_key";


