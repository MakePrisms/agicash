-- =============================================================================
-- migration: drop-preimage-from-spark-sends
-- purpose: removes the payment_preimage column from spark_send_quotes table
-- affected tables: wallet.spark_send_quotes
-- affected functions: wallet.complete_spark_send_quote
--
-- this is a follow-up fix to 20251223184411_encrypt-all-sensitive-data.sql.
-- the payment_preimage column should have been dropped in that migration as
-- part of encrypting sensitive data, but it was overlooked.
-- =============================================================================

-- drop the payment_preimage column which is no longer needed since preimage
-- data is now stored encrypted in the encrypted_data column
alter table wallet.spark_send_quotes drop column payment_preimage;

-- drop the old function signature that included p_payment_preimage parameter
drop function if exists wallet.complete_spark_send_quote(uuid, text, text, text);

-- recreate the function without the payment_preimage parameter
create or replace function wallet.complete_spark_send_quote(
  p_quote_id uuid,
  p_encrypted_transaction_details text,
  p_encrypted_data text
)
returns wallet.spark_send_quotes
language plpgsql
as $function$
declare
  v_quote wallet.spark_send_quotes;
begin
  select * into v_quote
  from wallet.spark_send_quotes
  where id = p_quote_id
  for update;

  if v_quote is null then
    raise exception
      using
        hint = 'NOT_FOUND',
        message = format('Spark send quote with id %s not found.', p_quote_id);
  end if;

  if v_quote.state = 'COMPLETED' then
    return v_quote;
  end if;

  if v_quote.state not in ('UNPAID', 'PENDING') then
    raise exception
      using
        hint = 'INVALID_STATE',
        message = format('Failed to complete spark send quote with id %s.', v_quote.id),
        detail = format('Found state %s, but must be UNPAID or PENDING.', v_quote.state);
  end if;

  update wallet.spark_send_quotes
  set
    state = 'COMPLETED',
    encrypted_data = p_encrypted_data,
    version = version + 1
  where id = p_quote_id
  returning * into v_quote;

  update wallet.transactions
  set
    state = 'COMPLETED',
    acknowledgment_status = 'pending',
    completed_at = now(),
    encrypted_transaction_details = p_encrypted_transaction_details
  where id = v_quote.transaction_id;

  return v_quote;
end;
$function$;