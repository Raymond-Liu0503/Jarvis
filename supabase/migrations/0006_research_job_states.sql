-- Enum changes must commit before later migrations can use the new values.
alter type public.research_job_status rename value 'failed' to 'dead_lettered';
alter type public.research_job_status add value if not exists 'retry_scheduled' after 'running';
-- PostgreSQL enum labels cannot be dropped in place; retain a non-dispatchable tombstone.
alter type public.research_job_kind rename value 'dashboard.refresh' to 'legacy.disabled';
