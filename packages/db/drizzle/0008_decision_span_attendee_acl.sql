-- Attendee-gate on verbatim decision spans (D10/D13). Raw meeting speech is the confidentiality
-- boundary (§9.3/§12.3): visible ONLY to the meeting's snapshotted attendees, even to other workspace
-- members. Enforced at the DB layer (§12.9) as a RESTRICTIVE policy that ANDs with the existing tenant
-- policy from 0006: a SELECT returns a span only if a per-request app.user_id is set AND that user is in
-- the parent decision_record's participants snapshot. WRITES (system extraction, no viewer) are
-- unaffected — the policy is FOR SELECT only. Fail-closed: no viewer context -> zero spans, so every span
-- read MUST go through withViewer.
create policy decision_span_attendee_read on decision_span as restrictive for select
  using (
    nullif(current_setting('app.user_id', true), '') is not null
    and exists (
      select 1
      from decision_record dr
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(dr.participants) = 'array' then dr.participants else '[]'::jsonb end
      ) as p
      where dr.id = decision_span.decision_id
        and p->>'userId' = current_setting('app.user_id', true)
    )
  );
