-- Shared sandbox prerequisite for the existing A/R Intake routes.
-- The schema-only bootstrap cannot represent Supabase Storage bucket rows.
-- This creates no report object and grants no browser-role Storage access.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('collections-ar-pdfs', 'collections-ar-pdfs', false, 26214400, array['application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = 26214400,
      allowed_mime_types = array['application/pdf'];

drop policy if exists collections_ar_pdf_service_only on storage.objects;
create policy collections_ar_pdf_service_only on storage.objects
  for all to service_role
  using (bucket_id = 'collections-ar-pdfs')
  with check (bucket_id = 'collections-ar-pdfs');
