-- Adds TOTP enrollment state to profiles.
-- The TOTP secret itself stays in Supabase Auth (auth.mfa_factors); we only
-- persist whether the user enabled TOTP and the hash of their recovery code.

alter table public.profiles
  add column totp_enabled boolean not null default false,
  add column totp_recovery_code_hash text;

-- The existing "read own profile" / "update own profile" policies already
-- cover these columns: users can only read and update their own row.
