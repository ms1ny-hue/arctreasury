-- Persist which signer executed and its provider-native ids/state, so a Circle
-- (or legacy) execution is fully auditable and reconcilable. No provider response
-- alone marks a proposal settled; these columns are evidence, not authority.
ALTER TABLE arc_transactions ADD COLUMN IF NOT EXISTS signer_provider text;
ALTER TABLE arc_transactions ADD COLUMN IF NOT EXISTS provider_tx_id  text;
ALTER TABLE arc_transactions ADD COLUMN IF NOT EXISTS provider_state  text;
ALTER TABLE arc_transactions ADD COLUMN IF NOT EXISTS circle_wallet_id text;
