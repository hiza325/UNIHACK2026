-- Additive: unique index to prevent duplicate competency credential issuance.
-- Only applies to competency-assessment source with non-null evaluation_id.
create unique index if not exists learning_credentials_competency_assessment_unique
  on public.learning_credentials (evaluation_id)
  where source = 'competency-assessment' and evaluation_id is not null and blockchain_status in ('confirmed', 'pending', 'submitting');
