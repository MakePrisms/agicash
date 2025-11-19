-- Delete 500 cashu_proofs records where account_id is a49e8e93-69c9-4140-9d39-a99fff266d96

DELETE FROM wallet.cashu_proofs
WHERE id IN (
  SELECT id FROM wallet.cashu_proofs
  WHERE account_id = 'a49e8e93-69c9-4140-9d39-a99fff266d96'::uuid
  LIMIT 500
);


