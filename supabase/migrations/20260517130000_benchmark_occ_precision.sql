-- Sprint 12 fix: benchmark_occ precision corrected from numeric(5,4) to numeric(5,2)
-- Applied directly via SQL editor during Sprint 12 AirDNA seed — capturing here for history
ALTER TABLE market_benchmarks ALTER COLUMN benchmark_occ TYPE numeric(5,2);
