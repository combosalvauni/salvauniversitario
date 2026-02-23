-- Avatar column on profile
alter table public.profiles add column if not exists avatar_url text;

-- Public bucket for profile avatars
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "Avatar images are publicly accessible" on storage.objects;
drop policy if exists "Users can upload own avatar" on storage.objects;
drop policy if exists "Users can update own avatar" on storage.objects;
drop policy if exists "Users can delete own avatar" on storage.objects;

create policy "Avatar images are publicly accessible"
	on storage.objects for select
	using ( bucket_id = 'avatars' );

create policy "Users can upload own avatar"
	on storage.objects for insert
	to authenticated
	with check (
		bucket_id = 'avatars'
		and (storage.foldername(name))[1] = auth.uid()::text
	);

create policy "Users can update own avatar"
	on storage.objects for update
	to authenticated
	using (
		bucket_id = 'avatars'
		and (storage.foldername(name))[1] = auth.uid()::text
	)
	with check (
		bucket_id = 'avatars'
		and (storage.foldername(name))[1] = auth.uid()::text
	);

create policy "Users can delete own avatar"
	on storage.objects for delete
	to authenticated
	using (
		bucket_id = 'avatars'
		and (storage.foldername(name))[1] = auth.uid()::text
	);

notify pgrst, 'reload schema';
