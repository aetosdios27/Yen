SELECT DISTINCT CASE WHEN e.type = 'donation.verified' THEN bt.id::text
        ELSE ex.id::text END AS id
      FROM fund_events e
      JOIN bank_transactions bt ON bt.id::text = e.payload->>'bank_transaction_id'
        AND bt.fund_id = e.fund_id
      LEFT JOIN expenses ex ON ex.fund_id = e.fund_id AND ex.status = 'reconciled'
        AND ex.expense_data->>'bankTransactionId' = bt.id::text
      JOIN anchors a ON a.fund_id = e.fund_id AND e.seq BETWEEN a.from_seq AND a.to_seq
      WHERE e.fund_id = $1 AND a.status = 'confirmed' AND a.tx_hash IS NOT NULL
        AND (
          (e.type = 'donation.verified' AND bt.type = 'credit'
            AND bt.reconciliation_status IN ('matched', 'manually_matched')
            AND bt.matched_pledge_id::text = e.payload->>'donation_id'
            AND EXISTS (SELECT 1 FROM donation_pledges dp
              WHERE dp.id = bt.matched_pledge_id AND dp.fund_id = bt.fund_id AND dp.status = 'verified'))
          OR (e.type = 'bank.debit_seen' AND bt.type = 'debit' AND ex.id IS NOT NULL
            AND ex.expense_data->>'amountPaise' = bt.amount_paise::text)
        );
