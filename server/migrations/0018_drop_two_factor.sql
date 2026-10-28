-- Sign-in codes (two-factor / OTP) are not coming back (decision D5, 28 Oct 2026). Sign-in stays password or cashier PIN, with the
-- per-account lockout. The column was added by 0010_login_parity.sql and nothing reads it any more.
ALTER TABLE users DROP COLUMN two_factor_enabled;
