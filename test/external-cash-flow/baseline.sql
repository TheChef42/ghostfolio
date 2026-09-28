-- Synthetic data only. Apply to a disposable database at tag 3.73.0 BEFORE
-- applying the Phase 1 migration. Identifiers are deliberately recognizable.
INSERT INTO "User" (id, "updatedAt") VALUES ('phase1-baseline-user', CURRENT_TIMESTAMP);
INSERT INTO "Account" (id,"userId",name,currency,"updatedAt") VALUES
('phase1-baseline-account','phase1-baseline-user','Synthetic baseline','EUR',CURRENT_TIMESTAMP);
INSERT INTO "AccountBalance" (id,"accountId","userId",date,value,"updatedAt") VALUES
('phase1-baseline-balance','phase1-baseline-account','phase1-baseline-user','2026-01-01',1000,CURRENT_TIMESTAMP);
INSERT INTO "SymbolProfile" (id,symbol,"dataSource",currency,"updatedAt") VALUES
('phase1-baseline-symbol','SYNTHETIC','MANUAL','EUR',CURRENT_TIMESTAMP);
INSERT INTO "Order" (id,"userId","accountId","accountUserId",date,fee,quantity,"unitPrice",type,"symbolProfileId","updatedAt") VALUES
('phase1-baseline-order','phase1-baseline-user','phase1-baseline-account','phase1-baseline-user','2026-01-02',2,3,10,'BUY','phase1-baseline-symbol',CURRENT_TIMESTAMP);
