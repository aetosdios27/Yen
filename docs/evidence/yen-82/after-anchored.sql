SELECT DISTINCT CASE WHEN e.type = 'donation.verified' THEN bt.id ELSE ex.id END::text AS id
FROM anchors a
CROSS JOIN LATERAL (
  SELECT e.type, e.payload FROM fund_events e
  WHERE e.fund_id = a.fund_id AND e.seq BETWEEN a.from_seq AND a.to_seq
    AND e.type IN ('donation.verified', 'bank.debit_seen')
  OFFSET 0
) e
JOIN bank_transactions bt ON bt.id = (e.payload->>'bank_transaction_id')::uuid AND bt.fund_id = a.fund_id
LEFT JOIN donation_pledges dp ON dp.id = bt.matched_pledge_id AND dp.fund_id = bt.fund_id AND dp.status = 'verified'
LEFT JOIN expenses ex ON ex.id = bt.matched_expense_id AND ex.fund_id = bt.fund_id AND ex.status = 'reconciled'
WHERE a.fund_id = $1 AND a.status = 'confirmed' AND a.tx_hash IS NOT NULL
  AND ((e.type = 'donation.verified' AND bt.type = 'credit'
    AND bt.reconciliation_status IN ('matched', 'manually_matched')
    AND dp.id = (e.payload->>'donation_id')::uuid)
  OR (e.type = 'bank.debit_seen' AND bt.type = 'debit' AND ex.id IS NOT NULL
    AND (ex.expense_data->>'bankTransactionId')::uuid = bt.id
    AND (ex.expense_data->>'amountPaise')::bigint = bt.amount_paise));
