-- Run after migrate deploy against the populated synthetic 3.73.0 database.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM "AccountBalance" WHERE id='phase1-baseline-balance' AND value=1000 AND date='2026-01-01') THEN
    RAISE EXCEPTION 'Baseline cash snapshot changed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "Order" WHERE id='phase1-baseline-order' AND quantity=3 AND fee=2 AND "unitPrice"=10 AND type='BUY' AND "userId"='phase1-baseline-user') THEN
    RAISE EXCEPTION 'Baseline activity changed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "Account" WHERE id='phase1-baseline-account' AND currency='EUR' AND name='Synthetic baseline') THEN
    RAISE EXCEPTION 'Baseline account changed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "SymbolProfile" WHERE id='phase1-baseline-symbol' AND symbol='SYNTHETIC' AND currency='EUR') THEN
    RAISE EXCEPTION 'Baseline asset changed';
  END IF;
  IF EXISTS (SELECT 1 FROM "ExternalCashFlow") THEN
    RAISE EXCEPTION 'Migration invented flows';
  END IF;
END $$;
