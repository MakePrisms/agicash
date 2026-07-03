create or replace function "wallet"."fail_cashu_receive_quote"(
  "p_quote_id" "uuid",
  "p_failure_reason" "text"
)
returns "wallet"."cashu_receive_quotes"
language plpgsql
security invoker
set search_path = ''
as $function$
declare
    v_quote wallet.cashu_receive_quotes;
begin
    select * into v_quote
    from wallet.cashu_receive_quotes
    where id = p_quote_id
    for update;

    if v_quote is null then
      raise exception
        using
          hint = 'NOT_FOUND',
          message = format('Quote with id %s not found.', p_quote_id);
    end if;

    if v_quote.state = 'FAILED' then
      return v_quote;
    end if;

    if v_quote.state != 'UNPAID' then
      raise exception
        using
          hint = 'INVALID_STATE',
          message = format('Cannot fail cashu receive quote with id %s.', p_quote_id),
          detail = format('Found state %s, but must be UNPAID.', v_quote.state);
    end if;

    update wallet.cashu_receive_quotes
    set state = 'FAILED',
        failure_reason = p_failure_reason,
        version = version + 1
    where id = v_quote.id
    returning * into v_quote;

    update wallet.transactions
    set state = 'FAILED',
        failed_at = now()
    where id = v_quote.transaction_id;

    return v_quote;
end;
$function$;
